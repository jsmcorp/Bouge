## Findings
- In log18 excerpt (lines 540–587), delivery flows through background REST sync and onWake; no "Realtime INSERT received" or diagnostic INSERT logs are present, indicating the INSERT handler still does not fire.
- Channel health logs (wake, skip missed fetch) appear, but there are no subscription or INSERT events in that slice; fallback is effectively doing the work.
- This supports moving to an active-only subscription model and relying on push+REST for inactive chats, per your goal.

## Approach
- Maintain a single Supabase client/socket for the app lifetime.
- Subscribe only to the currently open chat using an `eq` filter and attach handlers BEFORE `subscribe()`.
- Remove/replace the multi-group channel and reconnection logic with a simple bind/unbind flow.
- Keep push fallback for inactive chats and add SQLite existence checks to avoid duplicates.
- Implement a periodic/batched chat-list refresh for unread counts and last-message previews.

## Implementation Steps
1. Single Client
- Create `src/lib/supabaseClient.ts` exporting a singleton `supabase` from `createClient(...)`.
- Add `setRealtimeAuth(token)` helper applied on auth changes.

2. Active Subscription Bind/Unbind
- Add `src/lib/realtimeActive.ts` with `bindActive(groupId, onInsert)` and `unbindActive()` using channel name `active-<groupId>`.
- Attach `on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'group_id=eq.<id>' }, handler)` BEFORE `subscribe()`; await `subscribe()` and log `SUBSCRIBED`.
- Ensure `unbindActive()` calls `supabase.removeChannel(activeChan)` safely.

3. Store Integration
- In `src/store/chatstore_refactored/stateActions.ts` `setActiveGroup(group)`: call `unbindActive()` then `bindActive(group.id, onInsert)`.
- `onInsert(row)`: build message → attach if active → persist to SQLite → update unread.
- Remove multi-group subscription setup paths and zombie/heartbeat logic tied to multi-group; retain minimal connection status tracking.

4. Push Handler
- In `src/lib/push.ts`: if `group_id === activeGroup.id`, skip REST fetch.
- Always check `sqliteService.messageExists(message_id)`; skip fetch when true.
- Keep REST fallback for inactive chats; after storing, refresh chat list preview/unread.

5. Chat List Refresh
- Add `src/lib/chatListRefresh.ts` for batched `rpcGetAllUnreadCounts()` and `fetchLastMessagesForGroups([...groupIds])`; merge into list.
- Trigger on resume/visibility changes.

6. Diagnostics
- Log lifecycle: channel remove success/failure, handler registration, `SUBSCRIBED`, INSERT payload (id/group_id), and any handler exceptions.
- Push: log "Push fetch fallback used" when fetching inactive chat message; log skip reason when avoiding duplicates.

## Validation
- Open a chat → send/receive → observe: `SUBSCRIBED` then "Realtime INSERT received" only for that chat.
- Switch chats → old channel removed, new bound; inserts only fire for the new active group.
- Receive push for inactive chat → logs "Push fetch fallback used"; chat list updates reflect unread and preview.
- SQLite existence prevents duplicate REST fetches during active realtime.

## Notes
- Keep the singleton client; do not recreate per screen.
- Ensure filter uses `group_id=eq.<id>`; avoid custom multi-group filters.
- Attach handlers before subscribing to avoid missing early events.

## Next
- I will implement the active-only bind/unbind, update the store and push handler, and add the chat-list refresh and diagnostics, then run a test to confirm realtime inserts for the open chat.