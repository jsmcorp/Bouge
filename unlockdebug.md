### Unlock/Resume Message Send Plan (WhatsApp-style)

Objective
- WhatsApp-like responsiveness with reliable delivery after lock/unlock: instant UI feedback, non-blocking health, smart client self-heal, fast-fail to outbox, and minimal delays.

Current Status (from logs and code)
- Client init is idempotent and fast; resume/network handlers are debounced.
- `checkHealth()` and `refreshSession()` now have timeout wrappers (3s/5s respectively) — implemented.
- After resume, `getSession()` timeouts are fail-open (good), but direct DB upserts still hang and hit 6s timeouts — indicates broader client corruption.
- Outbox pipeline triggers correctly; SQLite ready; fallback works.

Plan (Phased) — WhatsApp-Style Send and Robustness

Phase 1 — Optimistic UI and Fast-Fail Timeouts
- Optimistic UI: show message instantly with status "sending"; non-blocking background send.
- Quick health: 1s budgeted `quickHealthCheck()` that never blocks UI. If it times out, treat as unhealthy for this attempt.
- Direct send: time-box to 3s; on timeout/failure, immediately fallback to outbox and keep UI as sending until confirmed.

Phase 2 — Smart Client Corruption Detection & Background Recreation
- Track `consecutiveFailures` and `lastHealthyAt` across auth/DB calls.
- If ≥2 consecutive timeouts within 60s, trigger `recreateClientInBackground()` (non-blocking), preserving session.
- Reset counters on first success; avoid churn.

Phase 3 — Outbox Reliability with New Client
- Ensure outbox uses the same fast-fail semantics; retries benefit from healed client.
- Keep immediate trigger after fallback and on reconnect/auth refresh.

Phase 4 — Telemetry & Monitoring
- Log counts/timers for health, direct send attempts, timeouts, recreations, and outbox outcomes to verify success metrics.


Root Cause (from latest logs)
- `client.auth.getSession()` hangs post-resume (we now fail-open in 3s), and DB upserts time out at 6s — consistent with client corruption after lifecycle events.

Specific Code Changes (planned) — `src/lib/supabasePipeline.ts`
1) Optimistic UI hooks
   - Add callbacks/hooks to update UI without tight coupling:
     - `private updateMessageStatus(messageId: string, status: 'sending' | 'sent' | 'failed'): void`
     - `private displayMessageInUI(message: Message): void`
     - Or emit events the UI/store can subscribe to.

2) Quick health check
   - `private async quickHealthCheck(): Promise<boolean>`
   - 1s timeout around `auth.getSession()` (no DB call) to avoid cascading stalls; return false on timeout.

3) Fast-fail background send
   - `private async sendMessageInBackground(message: Message): Promise<void>`
   - Use `quickHealthCheck()`; if healthy, attempt direct upsert with 3s timeout; else immediate outbox fallback.
   - Update UI based on outcome; keep message visible instantly.

4) Client corruption detection & recreation
   - Fields: `private consecutiveFailures = 0; private lastHealthyAt = Date.now();`
   - `private isClientCorrupted(): boolean` (e.g., ≥2 timeouts within 60s).
   - `private async recreateClientInBackground(): Promise<void>` — non-blocking; preserve session; reset counters.

5) Wrap DB operations for detection
   - Apply timeout + failure tracking to DB ops used by sends/outbox (keep existing 6s for general ops; 3s for send path).

What’s Already Implemented
- [x] Idempotent client initialize guard; no forced reset on resume.
- [x] Unlock gating removed; sends not blocked after unlock.
- [x] Resume debounce and background session freshness.
- [x] `checkHealth()` fail-open on `getSession()` timeout (3s).
- [x] `refreshSession()` timeout wrapper (5s).
- [x] Direct send retries with timeout (currently 6s) and outbox fallback.
- [x] Outbox pipeline with immediate triggers and backoff.
- [x] Detailed logging and timings across send/outbox/init.

Still To Do (prioritized)
- [ ] Add optimistic UI hooks/events for instant display and status updates.
- [ ] Implement `quickHealthCheck()` (1s) and use it in the send path.
- [ ] Reduce direct send timeout to 3s for the send path; keep 6s elsewhere.
- [ ] Add corruption detection counters and `recreateClientInBackground()`.
- [ ] Apply timeout + failure tracking wrapper to DB ops in send/outbox for detection.
- [ ] Telemetry/monitoring for timeouts, recreations, outbox outcomes.

Success Metrics
- Messages appear in UI within <100ms after send button.
- Health checks finish in <1s (never block UI).
- Direct sends: success in <3s or fast-fall to outbox.
- Background client recreation never blocks UI and restores direct sends.

Todos
- [x] Wrap `auth.getSession()` with 3s timeout (fail-open) in `checkHealth()`.
- [x] Wrap `auth.refreshSession()` with 5s timeout.
- [ ] Implement optimistic UI hooks/events in pipeline integration.
- [ ] Add `quickHealthCheck()` (1s) and wire to send path.
- [ ] Lower send-path upsert timeout to 3s; keep others 6s.
- [ ] Add corruption detection + background client recreation.
- [ ] Add telemetry and monitor logs post-release.


