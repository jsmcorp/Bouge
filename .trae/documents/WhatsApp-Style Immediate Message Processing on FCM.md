## Findings
- FCM handling is in `src/lib/push.ts:219` (handler) with a fast path only if payload has full message fields; otherwise it performs a REST fetch (`src/lib/push.ts:309-378`).
- SQLite write helper exists: `src/lib/sqliteServices_Refactored/sqliteService.ts:88-101` and `messageOperations.saveMessage` (`src/lib/sqliteServices_Refactored/messageOperations.ts:7-30`).
- UI refresh is available via `useChatStore.onWake` and `refreshUIFromSQLite` (`src/store/chatstore_refactored/stateActions.ts:216-299`).
- Logs in `/d:/Bouge from git/Bouge/log13.txt` show repeated fallback REST fetches on `notificationReceived` with partial payload and no immediate local render. Example receipts and fetch attempts: lines 524–529, 570–575, 614–619, 703–708.
- Background sync path is heavy (`src/lib/backgroundMessageSync.ts:1-120, 640-712`) and can time out, delaying first paint.

## Root Cause
- On background push with partial payload, the handler blocks on REST verification before writing/painting, so the UI waits on network. This violates the WhatsApp rule “render immediately from local data on push; reconcile later”.

## Objectives
- Process and render within 500ms of FCM receipt, independent of network/app state.
- Write to SQLite and update UI atomically from the client perspective.
- Maintain ordering, dedupe, and reconcile full details later via realtime/REST.
- Add end-to-end latency logging for FCM → DB → UI.

## Implementation
### Fast Path for Partial Payloads
- In `src/lib/push.ts:219`:
  - When `type==='new_message'` and payload lacks `content`, build a temporary `Message` with: `id = message_id` (use server id), `content = '…'`, `category = 'placeholder'`, `created_at = payload.created_at`, `message_type='text'`, `is_ghost=0`, plus known fields.
  - Immediately `sqliteService.saveMessage(temp)` and then `useChatStore.getState().onWake('push', group_id)`.
  - Log timestamps: `receivedAt`, `dbWriteAt`, `uiPaintStart`, `uiPaintEnd`.
  - Start a non-blocking verification task that uses `backgroundMessageSync.fetchAndStoreMessage(message_id, group_id)`; no delay for UI.

### Store Append and Dedupe
- Add a small helper in store actions to append with dedupe and stable sort by `created_at`:
  - API: `appendMessageWithDedupe(message)` → if message id exists, patch; else append, sort ascending by timestamp; cap list at 50.
  - Use `set((s)=>...)` and preserve scroll-at-bottom behavior; if user at bottom, auto-scroll.

### Reconciliation
- In `backgroundMessageSync.fetchAndStoreMessage` and realtime handlers:
  - After full message arrives, upsert to SQLite then `updateMessage(id, { content, category: null, ... })` in store.
  - Emit logs `[reconcile] coalesced id=<id> source=realtime|rest`.
  - Keep id mapping simple (server id used from start), so no tempId→serverId rewrite needed.
  - Add cleanup of any mismatched temp artifacts (already present via `cleanupTempMessages`), adapt to `category='placeholder'` if used.

### Atomicity (Client Perspective)
- Treat DB write + UI update as one operation:
  - Wrap in a microtask: await `saveMessage` → immediately call `onWake(groupId)` which internally calls `refreshUIFromSQLite(groupId)`.
  - This guarantees local DB and UI move together; no network involved.

### Logging & Metrics
- Add structured logs:
  - `[fcm] received ts=<iso> id=<msg> group=<g>` at the start of `handleNotificationReceived`.
  - `[db] write id=<msg> dur=<ms>` around `sqliteService.saveMessage`.
  - `[ui] refresh group=<g> dur=<ms> mode=fast-path|reconcile` around `refreshUIFromSQLite`.
  - `[reconcile] coalesced id=<id> source=<realtime|rest> dur=<ms>`.
  - `[bottleneck] ...` when any step exceeds thresholds (e.g., >100ms DB, >200ms UI).
  - Persist optional counters via `sync_state` if needed.

### Background Execution Policy
- Keep background work short and local:
  - Do not start REST fetch under Doze immediately; schedule verification with small delay or let resume complete it.
  - Use existing `onWake` and `onAppResumeSimplified` to refresh UI instantly and resume subscriptions.
  - If verification doesn’t arrive in 30–60s, retry quietly with backoff; never remove the bubble—mark as `category='placeholder'` or UI “syncing”.

### Edge Cases
- Multiple pushes quickly: dedupe by id; only one verification in flight.
- App not yet initialized / SQLite not ready: queue temp write; upon ready, flush queue then `refreshUIFromSQLite`.
- Network flaps: verification runs only when online; UI already shows local bubble.
- Active vs background group: if active, refresh immediately; else just update unread and toast.

## Files to Change
- `src/lib/push.ts` (fast-path for partial payloads, non-blocking verify, latency logs).
- `src/store/chatstore_refactored/stateActions.ts` (new `appendMessageWithDedupe`, slight `onWake` tweak to treat placeholder as normal messages, add UI latency logs).
- `src/lib/backgroundMessageSync.ts` (reconcile logs, ensure store patching instead of re-fetching UI list; keep operations short when backgrounded).
- `src/lib/sqliteServices_Refactored/messageOperations.ts` (no schema changes; rely on `category='placeholder'`).

## Performance Targets
- First local write ≤ 50–100ms.
- UI paint from SQLite ≤ 50–150ms.
- End-to-end receipt→paint ≤ 200–300ms (budget 500ms).

## Validation
- Simulate pushes while app is backgrounded; capture logs and measure latencies.
- Verify ordering and dedupe with rapid sequential pushes.
- Confirm resume path paints instantly and reconciliation replaces placeholder content without flicker.

## Rollout
- Ship code behind `FEATURES_PUSH.fastPathPlaceholders=true` flag to allow quick rollback.
- Enable detailed logging for one build; after verification, reduce noise to warning/bottleneck logs only.