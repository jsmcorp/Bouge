# FCM UI Refresh Fix - Root Cause & Solution

## Problem Summary
Messages received via FCM were being fetched from Supabase and stored in SQLite successfully, but they weren't appearing in the UI until the app restarted. The logs showed:

1. ✅ FCM notification received
2. ✅ Background fetch completed (got 1 message)
3. ✅ SQLite INSERT successful
4. ❌ UI update skipped with "Skipping stale set for group..."

## Root Cause
The issue was in `src/lib/backgroundMessageSync.ts`. When a message was stored in SQLite after FCM delivery, the code called `chatStore.fetchMessages(groupId)` to refresh the UI. However, this created a **new fetchToken**, which caused the subsequent UI update to be marked as "stale" by the `stillCurrent()` check in `fetchActions.ts` and skipped.

The stale-check logic in `fetchActions.ts`:
```typescript
const stillCurrent = () => {
  const st = get();
  return st.activeGroup?.id === groupId && st.fetchToken === localToken;
};
const setSafely = (partial: any) => {
  if (stillCurrent()) {
    set(partial);
  } else {
    console.log(`⏭️ Skipping stale set for group ${groupId}`);
  }
};
```

When `fetchMessages()` was called from background sync, it created a new token, making the previous token "stale" and causing the UI update to be skipped.

## Solution
Instead of calling `fetchMessages()` which triggers a full fetch cycle with a new token, we now **directly load from SQLite and update the Zustand state** using `useChatStore.setState()`. This bypasses the fetchToken check entirely and ensures the UI updates immediately.

### Changes Made
Modified three locations in `src/lib/backgroundMessageSync.ts`:

1. **After successful message fetch** (line ~293)
2. **After retry fetch** (line ~399)  
3. **After missed messages fetch** (line ~595)

All three now:
- Load messages directly from SQLite
- Convert to Message format with user info
- Update state directly: `useChatStore.setState({ messages })`
- Skip the fetchToken validation entirely

## Why This Works
- **No fetchToken conflict**: We bypass the stale-check mechanism entirely
- **Immediate UI update**: State updates happen synchronously after SQLite load
- **Minimal change**: Only modified the background sync service, no changes to core fetch logic
- **Safe**: Only updates when the group is still active (`isActiveGroup` check remains)

## Testing
After this fix, messages should appear immediately in the UI when:
1. FCM notification arrives while app is open
2. User opens app after receiving notifications
3. Background sync completes for missed messages

The logs should show:
```
[bg-sync] ✅ Message stored successfully
[bg-sync] 🔄 Loading new message from SQLite to update UI
[bg-sync] ✅ UI updated with X messages from SQLite
```

No more "Skipping stale set" messages for background-synced messages.
