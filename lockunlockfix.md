# Mobile lock/unlock first-send timeout — Technical Post‑Mortem (Supabase + Capacitor WebView)

Date: 2025‑09‑22
Owner: Confessr mobile/web client
Scope: First REST upsert after short device lock/unlock on Android/iOS WebViews

## 1) Root Cause Analysis

Symptoms
- After device unlock (short lock), reconnection manager consistently chose fast‑path (no reconnect):
  - “Reconnection decision: fast-path (no reconnect)”
  - “Channel already subscribed (fast path)”
- Realtime stayed healthy (no teardown or re‑subscribe churn), but the first message send via PostgREST upsert stalled for ~15s, then hit our guard: “Direct send timeout after 15000ms”.

Exact culprit
- In this build of the Supabase JS SDK, the PostgREST path did not expose a `rest.auth(token)` helper (logs: `postgrest present=true hasAuthFn=false`).
- Without a synchronous way to apply the Bearer token to the PostgREST client, the first `from('messages').upsert(...)` after fast‑path resume was internally gated by GoTrue session/refresh state inside the SDK (i.e., pre‑request auth preflight/mutex), which can be slow or stuck transiently right after app resume in mobile WebViews.
- Result: The first REST request did not leave the WebView immediately, causing the 15‑second timeout despite a healthy realtime channel.

Why realtime was fine while REST hung
- Realtime token had already been applied (“Token applied; channel healthy, no reconnect”), so the websocket stayed up.
- The REST client, however, awaited internal auth/session readiness because it could not be synchronously primed with the cached Bearer token in this SDK variant (no `rest.auth`).

Key proof in final successful run
- Logs showed: `postgrest present=true hasAuthFn=false` followed by our fast‑path fallback: `fast-path: no rest.auth - using direct REST upsert` and success in ~130ms.

## 2) Complete Change Log

All changes were surgical and preserve the working fast‑path reconnection behavior.

Primary fixes (behavioral)
1) src/lib/supabasePipeline.ts
   - Added fast‑path direct REST upsert that bypasses SDK auth preflight:
     - New private method: `fastPathDirectUpsert(message, dbgLabel)`
     - Performs `fetch` to `${SUPABASE_URL}/rest/v1/messages?on_conflict=dedupe_key&select=...` with headers:
       - `Authorization: Bearer <cached access token>`
       - `apikey: <anon key>`
       - `Prefer: resolution=merge-duplicates,return=representation`
     - Uses `AbortController` with the existing `sendTimeoutMs` for safety.
   - In `sendMessageInternal(...)`:
     - If fast‑path is active and `client.rest.auth` is missing on attempt 1, call `fastPathDirectUpsert(...)` instead of the SDK `.upsert(...)`. Return on success.
   - Cached the environment values on class (`supabaseUrl`, `supabaseAnonKey`) for direct REST calls.

Diagnostics and observability (non‑behavioral)
1) src/lib/supabasePipeline.ts
   - During client creation, added a `global.fetch` instrumentation hook to log outbound requests (`[fetch] <METHOD> <URL>`). This helped verify whether requests actually left the WebView.
   - In the send path, added logging for PostgREST capability detection: `postgrest present=... hasAuthFn=...`.
   - Retained our previous log lines that time each attempt and total send duration.
2) src/store/chatstore_refactored/realtimeActions.ts (earlier in this effort)
   - Clarified fast‑path log line to: “Channel already subscribed (fast path)”.
   - No behavior change.

Auth path cleanups (minor)
- Eliminated lingering `getSession()` in non‑first‑send fanout (push notification edge function) to avoid unnecessary auth calls around resume. It now uses the cached token; this was not the root cause but reduces contention.

No changes to reconnection manager logic
- We did not alter the fast‑path decisioning or reconnect flows. They already worked correctly.

## 3) Technical Flow — Working Behavior After Fix

High‑level sequence (short lock/unlock)
1) Reconnection manager assesses:
   - WebView ready → SQLite encryption validated → network stable
   - Realtime token applied; channel healthy → “fast‑path (no reconnect)”
   - “Channel already subscribed (fast path)”
2) User presses send → pipeline enters direct send path.

Detailed send flow
- Health check
  - Uses cached access token; avoids any session refresh in the hot path.
- Client selection and capability check
  - `fastPathNoAuth` true when `lastKnownAccessToken === lastRealtimeAuthToken`.
  - Direct client is used (no costly gates). We log `postgrest present` and `hasAuthFn`.
- If PostgREST exposes `rest.auth(token)` (not in this build):
  - We set it synchronously, then proceed with `.from('messages').upsert(...).select(...).single()` guarded by a timeout.
- If `rest.auth` is absent (this build):
  - We bypass the SDK for the first attempt:
    - Call `fastPathDirectUpsert(...)` which performs a direct `fetch` with Bearer and apikey headers.
    - This eliminates any GoTrue preflight/mutex and sends immediately.
- Success path
  - The insert completes in ~130ms (from logs), and realtime broadcasts the row (messages table is enrolled in Postgres Changes), updating the UI cache.
- Fallbacks
  - If health is bad or retries exhaust, we fall back to outbox storage with later processing (unchanged behavior).

Why this preserves fast‑path reconnection
- We did not touch the websocket/channel state machine; only ensured the first REST call has Authorization synchronously.
- The direct REST path is invoked only when the SDK cannot be primed (`rest.auth` missing). If/when the SDK exposes `rest.auth`, we use it and keep the normal `.upsert(...)` call.

## 4) Future Prevention Strategy

Potential failure points and mitigations

- SDK surface changes
  - Risk: Future Supabase JS versions change or remove/rename `client.rest` or re‑introduce hidden auth preflight waits.
  - Mitigation: Keep the capability check (`hasAuthFn`) and the direct REST fallback. Add a CI smoke test that asserts the first send after a mocked "resume" triggers either `rest.auth` or direct REST.

- Token skew or cache staleness
  - Risk: Cached access token expires between resume and first send (HTTP 401), causing the direct REST to fail.
  - Mitigation: On 401 from the direct REST upsert, trigger a lightweight token refresh path and retry once; log a distinct metric. Keep retries bounded to avoid re‑introducing a 15s stall.

- Postgres Changes subscription or RLS policies
  - Risk: Table not enrolled in Postgres Changes or RLS rule changes stop broadcasts, causing UI not to update despite successful insert.
  - Mitigation: Add startup assert/health probe verifying the `messages` table is subscribed for changes in the active schema; monitor realtime insert receipts after a send.

- WebView/network quirks
  - Risk: Platform/network blocks or throttles the first network call after resume.
  - Mitigation: Preserve `AbortController` timeout and telemetry; alert if first‑send > 3s. The fetch instrumentation is already in place to confirm when the request actually leaves the app.

- Env/Config regressions
  - Risk: Missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` prevents the fallback from forming the direct URL.
  - Mitigation: We now cache these at client init; add an init‑time assert and metric if absent.

Operational telemetry to keep
- Keep `[fetch] <METHOD> <URL>` instrumentation until we have confidence across devices; it’s cheap and decisive.
- Track metrics:
  - Time to first send after resume
  - Count when direct REST fallback is used vs. SDK upsert path
  - 401/403 error rates from direct REST

## 5) Evidence (final, successful run excerpts)

- Fast‑path reconnection maintained:
  - “Reconnection decision: fast-path (no reconnect)”
  - “Channel already subscribed (fast path)”
- Send path elected direct REST due to missing `rest.auth`:
  - “[send‑…] postgrest present=true hasAuthFn=false”
  - “[send‑…] fast-path: no rest.auth - using direct REST upsert”
  - “[send‑…] fast-path: direct REST upsert successful” (~130ms)
- Realtime broadcast confirmed:
  - “MessageCache updated … after realtime insert”

## 6) Acceptance Criteria — Status

- Healthy short lock/unlock → first send succeeds immediately, no 15s timeout, no auth calls in the send path.
  - Met: First attempt completed in ~130ms and used cached token.
- Logs show: “fast-path (no reconnect)”, “Channel already subscribed (fast path)”.
  - Met.
- If channel unhealthy/unsubscribed → “Creating channel …” → “SUBSCRIBED” before sends; single‑flight, no limbo.
  - Behavior preserved (unchanged by this fix).

---

If we see this regress (timeouts on first send after resume), check the logs in this order:
1) Confirm fast‑path reconnection is chosen and channel is subscribed.
2) Look for `postgrest present=... hasAuthFn=...` in the send path.
3) If `hasAuthFn=false`, ensure the direct REST upsert lines appear immediately.
4) If the direct REST returns 401/403, investigate token freshness and RLS.
5) If no `[fetch] ... /rest/v1/messages` appears, the request is being gated before fetch — re‑examine auth preflight and capability checks.

