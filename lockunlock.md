### Lock/Unlock Stability Plan (WhatsApp-style)

Problem
- Supabase client is recreated on every resume/network event, causing multiple GoTrue instances, auth refresh timeouts, and unnecessary outbox fallbacks.
- Unlock grace forces messages to outbox for 8s after resume, delaying delivery.
- Duplicate resume triggers lead to repeated resets and token churn.

Objectives
- Keep a single long-lived Supabase client instance across app lifecycle.
- Avoid resets on every resume; only refresh tokens in background when needed.
- Ensure session is available immediately after resume; no blocking refresh.
- Remove unlock-based outbox gating so direct send works instantly.
- Debounce resume handling to prevent duplicate work.

Implementation
1) Make client init idempotent and guarded
   - Add initializePromise guard; skip destroying existing client when already initialized.
   - Prevent concurrent inits/resets.

2) Remove forced reset on resume/network
   - Replace with lightweight ensureSession() that checks local session and background refresh if near expiry or missing.
   - Keep realtime handling outside pipeline; pipeline will not tear channels on resume.

3) Remove unlock grace outbox gating
   - Set unlockGracePeriodMs to 0 and remove direct-send skip on resume.

4) Soften health/refresh behavior
   - checkHealth() uses local session presence/freshness; no network race timeouts.
   - refreshSession() is non-blocking and without artificial timeout.

5) Debounce resume
   - Ignore duplicate resume events within ~1.5s.

Expected Outcome
- No more "Multiple GoTrueClient instances" logs.
- No periodic session refresh timeouts on resume.
- Direct message sends proceed immediately post-resume; outbox used only on real failures.
- Faster, WhatsApp-like responsiveness on lock/unlock cycles.

Todos
- [x] Create this plan document
- [ ] Make Supabase client singleton with idempotent initialize and init lock
- [ ] Remove forced client reset on resume/network; add resume debounce & background session verify
- [ ] Remove unlock grace outbox gating; soften health check and refresh behavior
- [ ] Harden resetConnection to avoid re-create; keep tokens; non-blocking refresh
- [ ] Verify direct send path works on resume and outbox remains fallback


