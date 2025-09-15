### Mission: Find and Fix Supabase Client Corruption (Android lifecycle)

Status: fix deployed; monitoring

Root-cause hypothesis (per issue #36046 and local logs)
- Supabase client shares internal state across auth, database, and Realtime.
- Android pause/resume corrupts/desynchronizes this shared state; `auth.getSession()` can hang and Realtime breaks.
- All operations fail until the client is recreated and listeners rebound.

Findings in this codebase
- Single client owner in `src/lib/supabasePipeline.ts` created via `createClient(...)`, exported singleton and auto-initialized on import.
- Multiple auth listeners: `authStore.initializeAuthListener`, `push.initPush`, and Realtime store had a direct `client.auth.onAuthStateChange`.
- Realtime uses `client.realtime.setAuth(token)` in several places but didn’t centrally rebind after client recreation.
- Lifecycle resume hooks call `supabasePipeline.onAppResume()`; no hard client rebuild on resume.

Decisive Fix implemented
1) Pipeline-managed auth listeners registry
   - `supabasePipeline.onAuthStateChange()` now registers callbacks in a registry and binds/unbinds across recreations.
2) Corruption probe and hard recreation
   - `isClientCorrupted(timeout)` probes `auth.getSession()` with a bounded timeout.
   - `hardRecreateClient()` tears down Realtime, drops client, recreates, reapplies session token to Realtime, and rebinds listeners.
   - `onAppResume()` now probes and hard-recreates if corrupted.
3) Listener source-of-truth
   - Realtime store `setupAuthListener()` switched to use pipeline `onAuthStateChange()` (no direct client binding).
4) Full corruption detector & auto-heal
   - Added 5 fast checks: authSessionNull, databaseHang, realtimeDesync, promiseQueue hang, rpc timeout.
   - `getClient()` performs a throttled detector pass and auto-heals with `ensureRecreated()` if any check trips.
   - Health-check and refresh pre-check treat timeouts as corruption and trigger rebuild.
   - Direct send timeout also schedules a rebuild in the background.

Why this fixes the root cause
- If Android suspends timers/sockets causing internal queues to hang, the probe detects it and we rebuild the entire client atomically, preserving session and rebinding listeners.
- We eliminate divergent auth-listener state across clients by letting the pipeline own the listeners.

Verification plan
- Lock/unlock device repeatedly; observe that sends and Realtime connect immediately after resume (no 3–5s delays).
- Confirm logs: "🧪 Resume: client appears corrupted; performing hard recreate" only when needed.
- Ensure push-driven wakeups still re-connect and process outbox promptly.

Log verdict (2025-08-22 sample)
- Resume occurred; Realtime reconnected and outbox ran promptly.
- Later: health check showed getSession timeout, direct send upsert timed out at 6s on attempt 1 → indicates auth client hang while DB remained reachable.
- New behavior added: health-check getSession timeout now triggers a background hard client rebuild and marks client unhealthy to avoid direct sends during rebuild, pushing to outbox if needed.

Additional safeguards implemented
- Coalesced hard-recreate calls to avoid redundant rebuilds during flurries (single recreatePromise).
- On network reconnect, probe for corruption and hard-recreate if needed.
 - After hard recreate, realtime store is nudged to reconnect the active group.

Next follow-ups (if needed)
- If direct sends still occasionally time out right after a timeout-based rebuild, schedule a rebuild on first direct-send timeout as well.
 - Consider short-term disable of RPC check if your instance lacks `pg_sleep`.

Open TODOs
- Wire any other direct `client.auth.onAuthStateChange` usages to pipeline (none remaining after edits).
- Consider applying `hardRecreateClient` on network flip if corruption also occurs there.


