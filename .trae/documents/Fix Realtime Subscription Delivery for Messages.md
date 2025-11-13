## Objectives
- Maintain realtime processing for `messages` INSERT when connected
- Use FCM fallback only when realtime is unavailable
- Add diagnostics to detect silent failures and race/timing issues

## Verification & Instrumentation
1. Add explicit logs for channel status transitions (SUBSCRIBED/ERROR/CLOSED)
2. Log the active group filter and channel name on subscribe
3. Count INSERTs per minute and report heartbeat health
4. Add error boundary around the INSERT handler and log exceptions

## Server-side Realtime Publication
1. Ensure `messages` table is in `supabase_realtime` publication
2. Set `REPLICA IDENTITY FULL` on `messages`
3. Restart realtime service and verify events via a test insert

## Client Subscription Hardening
1. Use multi-group channel with `group_id=in.(…)` filter
2. Gate handler by active group, but persist all inserts to SQLite
3. Avoid tearing down channel; use fast-path reuse
4. Add zombie detection and forced resubscribe on missed heartbeats

## Message Handling Pipeline
1. Build message and attach to state with dedupe
2. Persist to SQLite before UI updates; update unread counters
3. Wrap handler in try/catch; validate payload fields and row types
4. Emit metrics for handled vs skipped messages and reasons

## Fallback Policy
1. If realtime is SUBSCRIBED and INSERTs are flowing, skip REST fetch
2. If realtime is SUBSCRIBED but no INSERTs in N seconds, trigger `fetchMissedMessages()`
3. If FCM payload has full message, write to SQLite fast-path
4. Use cached token REST with timeouts; retry on transient errors

## Race Condition Guards
1. Remove token-mismatch discard in handler (already done)
2. Add timeout to cross-group existence check in background sync
3. Bound session refresh with cached tokens applied to realtime
4. Serialize per-message background fetch to avoid lock contention

## Test Matrix
- Connected, realtime working: expect INSERT handler paths only
- Connected, realtime subscribed but no INSERTs: expect missed-message fetch, no duplicates
- Disconnected: expect FCM fast-path or REST fallback
- Rapid reconnects and group switches: ensure no duplicate inserts and stable UI
- High-volume burst: assert dedupe, SQLite persistence, and heartbeat stability

## Acceptance Criteria
- Observed realtime INSERTs for new messages in subscribed groups
- FCM fallback only used when realtime is not delivering INSERTs
- No duplicate messages; consistent SQLite/UI state
- Clear logs/metrics for status and failures