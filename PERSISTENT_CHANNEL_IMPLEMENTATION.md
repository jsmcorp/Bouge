# Persistent Realtime Channel Implementation

## Overview
Successfully implemented a persistent WebSocket channel manager that eliminates the need to recreate channels on every group switch, significantly improving realtime message delivery reliability.

## Key Changes

### 1. Core Module: `src/lib/realtimeActive.ts`
- **Token Guard Pattern**: Uses a token-based guard system where old handlers become no-ops instead of being removed
- **Single Channel**: Creates ONE channel per user session and never recreates it
- **Dynamic Binding**: Attaches new handlers for each group switch without tearing down the WebSocket
- **Correct Column Name**: Uses `groupid` (database column) in postgres_changes filter

### 2. Realtime Actions: `src/store/chatstore_refactored/realtimeActions.ts`
- **New Method `setupPersistentRealtimeSubscription()`**: Uses the persistent channel manager
- **New Method `switchActiveGroup()`**: Handles group transitions without reconnecting
- **Updated `cleanupRealtimeSubscription()`**: Lazy cleanup that only unbinds handlers, keeps channel alive
- **New Method `cleanupPersistentChannel()`**: Full cleanup only on logout/session expiration
- **Active vs Background Messages**: Properly handles messages for active group (UI update) vs background groups (SQLite only)

### 3. Feature Flag: `src/lib/supabase.ts`
- Added `USE_PERSISTENT_CHANNEL` feature flag (default: disabled for gradual rollout)
- Set `VITE_USE_PERSISTENT_CHANNEL=true` in environment to enable

### 4. Dashboard Integration: `src/pages/DashboardPage.tsx`
- Added event listener for `message:background` custom events
- Automatically refreshes group list when background messages arrive
- Updates unread count badges in real-time

### 5. Group Navigation: `src/components/dashboard/Sidebar.tsx`
- Updated `handleGroupClick()` to call `switchActiveGroup()` when persistent channel is enabled
- Ensures smooth transitions between groups without UI flicker

### 6. Logout Flow: `src/store/authStore.ts`
- Added call to `cleanupPersistentChannel()` before logout
- Ensures all handlers are removed and no memory leaks

## Benefits

1. **No Missed Messages**: Eliminates WebSocket rejoin timing windows where events could be missed
2. **Faster Group Switching**: No need to wait for channel recreation and subscription
3. **Better Resource Usage**: Single persistent connection instead of multiple short-lived connections
4. **Improved Reliability**: Token guard ensures old handlers don't process stale events
5. **Background Message Support**: Messages for non-active groups are saved to SQLite and trigger unread count updates

## How It Works

### Channel Lifecycle
1. **App Init**: Channel is created on first group access
2. **Group Switch**: Old handler is invalidated via token, new handler is attached
3. **Dashboard Navigation**: Handler is unbound but channel stays alive
4. **Logout**: Channel is fully cleaned up and removed

### Token Guard Pattern
```typescript
const handlerToken = newToken;
channel.on('postgres_changes', { ... }, (payload) => {
  // Token guard: ignore if this handler is stale
  if (this.state.currentToken !== handlerToken) {
    return; // No-op
  }
  // Process event
  onInsert(payload);
});
```

### Message Routing
- **Active Group**: Message → `attachMessageToState()` → UI update + SQLite
- **Background Group**: Message → SQLite only + `message:background` event → Dashboard refresh

## Testing

To enable the persistent channel:
1. Set environment variable: `VITE_USE_PERSISTENT_CHANNEL=true`
2. Restart the app
3. Test group switching - should be instant with no reconnection logs
4. Test background messages - should see unread counts update in real-time
5. Test logout - should see `[realtime-active]` cleanup logs

## Rollback Plan

If issues arise, simply set `VITE_USE_PERSISTENT_CHANNEL=false` or remove the environment variable. The app will fall back to the legacy multi-group subscription approach.

## Next Steps (Optional)

- Task 8: Write unit tests for persistent channel manager
- Task 9: Write integration tests for message flow
- Task 10: Manual testing and validation across different network conditions

## Diagnostic Logging

All persistent channel operations are logged with `[realtime-active]` prefix for easy filtering:
- Channel creation and subscription
- Handler attachment and detachment
- Message INSERT events with active/background status
- Token invalidation
- Cleanup operations

Use browser console filter: `[realtime-active]` or `[persistent]`
