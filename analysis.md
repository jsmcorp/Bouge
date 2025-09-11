### Backend architecture and current behavior (from logs + code)

- **Supabase client owner**: `src/lib/supabasePipeline.ts` centralizes client creation, auth/session, message send, outbox processing, and lifecycle hooks. It recreates the client on corruption/timeouts and rebinds listeners.
- **Realtime (chat) layer**: `src/store/chatstore_refactored/*`
  - `realtimeActions.ts`: creates the channel per group, manages reconnects and presence, and relies on the pipeline for auth/token.
  - `stateActions.ts`: wires resume/network events to the pipeline.
  - `offlineActions.ts`: unified outbox trigger/processing orchestration.
  - `fetchActions.ts`, `messageActions*.ts`: message fetch/sync flows.
- **Local storage (SQLite)**: `src/lib/sqliteServices_Refactored/*`
  - `database.ts`: opens encrypted DB, creates schema, applies additive migrations with `ALTER TABLE … ADD COLUMN …` guarded by `.catch(() => {})`, runs a self‑test insert/query.
  - Operations files implement CRUD for messages, groups, users, outbox, polls, reactions, etc. `created_at` columns are `INTEGER NOT NULL` (epoch ms).
- **Push**:
  - Client: `src/lib/push.ts` dynamically imports `@capacitor-firebase/messaging` to register an FCM token and upserts into `public.user_devices` via pipeline.
  - Server: `supabase/functions/push-fanout/index.ts` (Edge Function) reads recipients from DB and sends via FCM (v1 preferred, legacy fallback). Also supports draining `public.notification_queue` if invoked without JSON.
  - DB: `supabase/migrations/20250819_user_devices.sql` and `20250819_push_queue.sql` create `user_devices` and `notification_queue`, with a trigger to enqueue on message inserts.

---

### What the logs tell us

1) App startup works
- Supabase pipeline initializes and rehydrates auth.
- SQLite opens encrypted DB, creates tables, and self‑tests pass. The repeated "duplicate column" ALTER errors are expected because the code intentionally `catch(() => {})` on ALTERs.

2) First load and realtime subscribe also work
- Groups sync to local and UI updates. Realtime subscribes and receives events.

3) Local sync error (NOT NULL)
- During message sync, an insert into `users` fails: `Run: NOT NULL constraint failed: users.created_at`.
  - Evidence: attempt to save user "Bobby" with `created_at = null` triggers the constraint.
  - Impact: This doesn’t crash the app (caught), but it degrades local consistency and may short‑circuit parts of the sync.

4) Push function call fails due to CORS
- Preflight to `…/functions/v1/push-fanout` from `https://localhost` is blocked. No `Access-Control-Allow-Origin` in the Edge Function response.
  - Impact: Even though messages are saved server‑side, your direct fan‑out call fails. Unless the function is invoked some other way (cron/webhook), no notifications are sent.

5) Push plugin is not initialized
- `Push init skipped (plugin missing or error): Failed to resolve module specifier '@capacitor-firebase/messaging'`.
  - Impact: No device token is registered → no rows in `public.user_devices` → push fan‑out has nobody to notify.

6) After lock/unlock (resume) realtime breaks until restart
- Repeated patterns:
  - `getSession timed out after 2500ms` → pipeline schedules hard recreate → multiple client re‑inits → repeated `SIGNED_IN` events → force reconnects.
  - Realtime switches through `CLOSED/TIMED_OUT` and reconnect attempts, with outbox watchdog timeouts.
  - You often see "Multiple GoTrueClient instances" warnings, a sign of repeated client creation under the same storage key.
  - Practically, sends fall back to outbox and realtime doesn’t consistently deliver until a fresh app start.

---

### Root causes (ranked)

1) Lifecycle duplication + aggressive corruption handling → client thrash on resume
- Both `src/main.tsx` and `src/App.tsx` listen for `appStateChange`/`resume` and each causes a pipeline resume (directly or via `onWake` → `onAppResumeSimplified` → pipeline `onAppResume`).
- The pipeline’s health/corruption probes call `auth.getSession()` under strict timeouts in multiple places (`checkHealth`, `refreshSession`, resume/network handlers, realtime auth watcher). Concurrent timeouts schedule multiple hard recreates. Recreate tears down channels and rebinds auth listeners, which themselves trigger more activity.
- Net result: several interleaved resumes/reconnects, token refreshes, and client recreations cause realtime to flap (CLOSED/TIMED_OUT), and the system falls back to the outbox.

2) Push path is broken (two separate issues)
- Client side: FCM plugin is missing → no tokens stored.
- Server side: Edge function lacks CORS handling for `OPTIONS` and `Access-Control-Allow-Origin` → the direct fan‑out call from the app is blocked.
- Also, no clear scheduler to drain `notification_queue` when the direct call fails.

3) Local sync bug: user `created_at` can be null/NaN
- The SQLite schema requires `users.created_at INTEGER NOT NULL`.
- Converters pass `new Date(x).getTime()`, which becomes `NaN` when `x` is missing/invalid; many SQLite bindings coerce `NaN` → `null` → constraint failure.

4) Extra complexity increases the surface for races
- Multiple heartbeat/watchdog/timer layers (pipeline health checks + realtime watchdog + unified outbox watchdog + background preloading + cache), all firing around resume/network changes, amplify timing races.

---

### What to fix first (minimum changes to get stability)

1) Single lifecycle owner (eliminate duplicate resume handlers)
- Keep only one: either `src/main.tsx` or `src/App.tsx`, not both. All resume/network events should flow to a single place that calls the pipeline once.
- Make resume idempotent: ensure only one resume sequence can run at a time (guarded promise) with a 2–3s lockout. The pipeline already has `lastResumeAt` debouncing; duplication bypasses this.

2) Stop recreating the client aggressively
- Remove/disable the multi‑probe corruption detection on resume/network and reduce `getSession` timeout thrash. Prefer a single `initialize(false)` and a single bounded `getSession()` check; only hard‑recreate when absolutely necessary (e.g., repeated failures over several seconds).
- De‑duplicate `getSession` callers: centralize session fetch in the pipeline and let others rely on the in‑memory last known session (already tracked as `lastKnown*`).

3) Fix SQLite user.created_at writes
- When persisting users, coerce `created_at` safely:
  - If source is missing/invalid → use `Date.now()`.
  - Always pass a finite integer to satisfy `NOT NULL`.
- This will remove the recurring local sync error and avoid aborting related sync steps.

4) Make push reliable
- Install and configure `@capacitor-firebase/messaging` so the app actually registers tokens.
- Add CORS handling to the Edge Function (reply to `OPTIONS`; set `Access-Control-Allow-Origin: *` or your allowed origins) so client invocations succeed.
- Alternatively (recommended for simplicity), don’t call the function from the client at all. Rely on the `notification_queue` trigger and set a Supabase Scheduled Function (cron) to invoke `push-fanout` every few seconds to drain the queue. This decouples push from client state and CORS entirely.

---

### Simplify to reduce race surface (suggested refactor plan)

- **Lifecycle**:
  - One handler in `src/main.tsx` for `appStateChange` and `resume`, and one for `networkStatusChange`. Remove the parallel handler in `src/App.tsx`.
  - Route both to a single `pipeline.onAppResume()` call guarded internally against reentry.

- **Pipeline**:
  - Keep a single, long‑lived `createClient`; avoid frequent hard recreates.
  - Reduce `getSession` timeouts and calls. Do not call `getSession` from heartbeat/watchdog paths; use cached session unless an operation actually needs a fresh token.
  - On resume: do at most one bounded `getSession` (or `getUser`) and, if present, set `realtime.setAuth(accessToken)` and reconnect the single channel.

- **Realtime**:
  - Keep the simplified connection (already implemented) but rely on the pipeline to feed a token; remove extra force‑reconnects on every auth event. Prefer single "forceReconnect" on resume and on explicit token refresh.

- **Outbox**:
  - The unified trigger system is fine; ensure only the active processing run exists (the code does that) and reduce external triggers to: (a) resume, (b) realtime CONNECTED, (c) auth token refreshed, (d) new message enqueued. Avoid scheduling additional triggers from health/heartbeat paths.

- **SQLite**:
  - Keep the current additive migrations; the duplicate column errors are benign due to `.catch(() => {})`.
  - Fix `users.created_at` write path as above.

- **Push** (recommended path):
  - Register tokens via plugin → store in `public.user_devices`.
  - Stop calling `push-fanout` from the app; schedule the function to drain `notification_queue` every 10–15s, or trigger server‑side after insert.

---

### Evidence in code (key spots)

- Pipeline creates client and rebinds listeners on initialize (potentially many times):
```116:151:src/lib/supabasePipeline.ts
public async initialize(force: boolean = false): Promise<void> {
  …
  if (!this.client || force) {
    this.client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    … // bindAuthListenersToClient()
  }
}
```

- Resume does corruption probe + possible hard recreation, then triggers outbox:
```1376:1412:src/lib/supabasePipeline.ts
public async onAppResume(): Promise<void> {
  this.log('📱 App resume detected');
  …
  const corrupted = await this.isClientCorrupted(2500);
  if (corrupted) await this.hardRecreateClient('app-resume-corruption');
  else {
    await this.initialize(false);
    this.ensureSessionFreshness().catch(() => {});
  }
  this.triggerOutboxProcessing('app-resume');
}
```

- Realtime subscription sets token then subscribes; on CLOSED/TIMED_OUT it schedules reconnect and can refresh session again:
```456:505:src/store/chatstore_refactored/realtimeActions.ts
setupSimplifiedRealtimeSubscription: async (groupId: string) => {
  …
  const accessToken = await getAccessTokenBounded(FEATURES_PUSH.auth.refreshTimeoutMs);
  (await supabasePipeline.getDirectClient()).realtime?.setAuth?.(accessToken || undefined);
  … subscribe( status => { … if (status === 'CLOSED'|'TIMED_OUT') { scheduleReconnect(groupId) } })
}
```

- Local sync of users uses `created_at` from Supabase rows and can pass invalid timestamps:
```690:709:src/store/chatstore_refactored/fetchActions.ts
await sqliteService.saveUser({
  …
  created_at: new Date(msg.users.created_at).getTime() // ⇒ NaN → coerced to null → NOT NULL failure
});
```

- Edge Function lacks CORS handling for preflight/allow‑origin (only returns plain Responses).
```170:222:supabase/functions/push-fanout/index.ts
serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  … return new Response('ok'); // No CORS headers; no OPTIONS handling
});
```

- App wires resume in more than one place (duplicated lifecycle):
```21:33:src/main.tsx
CapApp.addListener('appStateChange', ({ isActive }) => {
  if (isActive) { useChatStore.getState().onWake?.('resume'); }
});
CapApp.addListener('resume', () => { useChatStore.getState().onWake?.('resume'); });
```
```47:120:src/App.tsx
CapacitorApp.addListener('appStateChange', handleAppStateChange);
… if (isActive) { setTimeout(() => { onAppResume(); }, 500); }
```

---

### Concrete fix plan (ordered)

1) Lifecycle and resumability
- Remove duplicate `appStateChange`/`resume` listeners so only one path calls `pipeline.onAppResume()`.
- Inside the pipeline, guard `onAppResume()` with a single in‑flight promise; skip if it ran within the last ~2–3s.
- Do not run `detectCorruption()` on every resume; keep a cheap check (single `getSession` call with a relaxed timeout, or skip entirely and rely on reconnection when needed).

2) Reduce session calls and recreations
- Ensure only one `getSession` call can be active; cache result for a short window and reuse across listeners.
- Recreate the client only upon clear, persistent failure (e.g., several consecutive subscribe failures or a token operation that errors, not just a timeout once).

3) SQLite safety
- When saving users: `const ts = Number.isFinite(new Date(src).getTime()) ? new Date(src).getTime() : Date.now();`
- Consider relaxing the column to `INTEGER` (nullable) if you don’t strictly require non‑null in local cache.

4) Push reliability
- Install and configure `@capacitor-firebase/messaging`; verify `FirebaseMessaging.getToken()` works on device. Ensure `google-services.json` is present (it is) and Gradle is wired.
- Add CORS headers and `OPTIONS` preflight handling to `push-fanout`, or avoid CORS entirely by using a Scheduled Function to drain `notification_queue`.
- Prefer the server‑driven push path for consistency even when the app is backgrounded or killed.

5) Optional simplifications to lower complexity
- Stick to one cache strategy (keep `messageCache`, but drop multi‑layer preload/heartbeat timers).
- Keep unified outbox (it’s useful), but restrict triggers to the four key events and remove secondary health triggers.
- Reduce logging volume in production; keep debug tags behind a feature flag.

---

### How this addresses your three issues

1) "Lock/unlock → no realtime; must restart"
- A single resumability path + fewer recreations/session calls prevents the thrash that leaves Realtime in CLOSED/TIMED_OUT.
- Token is applied once via `realtime.setAuth()` and a single `forceReconnect()` is issued.

2) "First open works well"
- This will remain unchanged; the simplification targets only resume/network transitions.

3) "No notifications when app closed/background"
- With the plugin installed, tokens are stored.
- With CORS fixed or (better) a scheduled server‑side drain, pushes are sent regardless of client state, so background delivery works.

---

### Validation checklist after changes

- Resume the app 10× in a row; ensure:
  - At most one `onAppResume` run per resume.
  - Realtime channel reaches SUBSCRIBED within ~3–5s; no loops of CLOSED/TIMED_OUT.
  - No repeated `Multiple GoTrueClient instances` warnings.
- Send message while network toggles offline→online; confirm outbox delivers and UI refreshes within a second after reconnect.
- Verify `users.created_at` never fails by inspecting recent logs.
- Receive a push while the app is backgrounded and when it is killed.

---

### Quick wins (can be done independently)

- Add CORS to `push-fanout` and an `OPTIONS` handler.
- Install the FCM plugin and confirm token registration flow (look for `[push] token:registered`).
- Fix `users.created_at` write path.
- Remove one of the two resume listeners.

These four alone will remove the biggest current blockers (push + resume thrash + SQLite sync error). After that, you can further trim corruption/health logic to simplify the codebase.

