# FCM Push Notification - Realtime UI Refresh Fix

## Problem
Messages received via FCM push notifications were being stored in SQLite successfully but **not appearing in the chat screen** until the user navigated away and back to the chat.

## Root Cause
The `backgroundMessageSync` service was fetching and storing messages in SQLite when FCM notifications arrived, but it **never notified the chat store to refresh the UI**. 

The flow was:
1. ✅ FCM notification arrives with `message_id`
2. ✅ Background sync fetches message from Supabase
3. ✅ Message stored in SQLite
4. ❌ **Chat UI never updated** - user sees old cached messages
5. ✅ When user navigates away and back, `fetchMessages()` is called and new messages appear

## Solution
Added UI refresh logic to `backgroundMessageSync.ts` after storing messages:

### 1. Single Message Fetch (`fetchAndStoreMessage`)
After storing a message, check if it's for the active group:
- **Active group**: Call `chatStore.fetchMessages(groupId)` to refresh UI immediately
- **Other groups**: Dispatch `message:background` event for dashboard badge updates

### 2. Missed Messages Fetch (`fetchMissedMessages`)
After syncing missed messages, refresh the active group's UI if any messages were stored.

## Code Changes

### File: `src/lib/backgroundMessageSync.ts`

Added after message storage (3 locations):

```typescript
// CRITICAL FIX: Notify chat store to refresh UI if this is the active group
try {
  const { useChatStore } = await import('@/store/chatStore');
  const chatStore = useChatStore.getState();
  const isActiveGroup = chatStore.activeGroup?.id === groupId;
  
  if (isActiveGroup) {
    console.log(`[bg-sync] 🔄 Refreshing active group ${groupId} to show new message`);
    await chatStore.fetchMessages(groupId);
    
    // CRITICAL FIX: Force scroll to bottom after refresh to show new message
    setTimeout(() => {
      const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
        console.log(`[bg-sync] 📍 Auto-scrolled to bottom to show new message`);
      }
    }, 100);
  } else {
    console.log(`[bg-sync] 📨 Message for non-active group ${groupId}, dispatching background event`);
    // Dispatch event for dashboard to show badge
    window.dispatchEvent(new CustomEvent('message:background', {
      detail: { groupId, messageId }
    }));
  }
} catch (error) {
  console.warn('[bg-sync] ⚠️ Failed to refresh chat store:', error);
}
```

### Key Points:
1. **UI Refresh**: Calls `fetchMessages()` to reload messages from SQLite
2. **Auto-scroll**: Forces scroll to bottom with 100ms delay to ensure DOM is updated
3. **Viewport Detection**: Uses Radix UI's scroll area viewport selector
4. **Non-blocking**: Uses `setTimeout` to avoid blocking the sync operation

## Expected Behavior After Fix

### Scenario 1: User in Chat Screen
1. FCM notification arrives for current chat
2. Background sync fetches and stores message
3. **Chat UI refreshes immediately** - message appears instantly
4. **Auto-scrolls to bottom** - new message is fully visible (not hidden behind input)
5. User sees new message without any action

### Scenario 2: User in Dashboard
1. FCM notification arrives for any group
2. Background sync fetches and stores message
3. Dashboard badge updates via `message:background` event
4. When user opens that chat, messages are already loaded from SQLite

### Scenario 3: App Resume After Background
1. Multiple FCM notifications arrived while app was backgrounded
2. Fallback sync fetches all missed messages
3. **Active group UI refreshes** to show all new messages
4. Other groups show updated badges

## Testing Checklist

- [ ] Send message from another device while viewing chat - appears immediately
- [ ] **New message is fully visible** - not hidden behind input area
- [ ] **Chat auto-scrolls to bottom** - shows the latest message
- [ ] Send message from another device while on dashboard - badge updates
- [ ] Send multiple messages while app is backgrounded - all appear on resume
- [ ] Verify no duplicate messages in UI
- [ ] Verify messages appear in correct chronological order
- [ ] Check console logs show `[bg-sync] 🔄 Refreshing active group...`
- [ ] Check console logs show `[bg-sync] 📍 Auto-scrolled to bottom...`

## Performance Impact
- Minimal: Only calls `fetchMessages()` for the active group
- Other groups just dispatch a lightweight event
- No unnecessary re-renders or data fetching

## Related Issues
- LOG12: Messages not appearing in realtime until navigation
- Previous fix: Realtime INSERT events work correctly
- This fix: FCM push notification path now matches realtime behavior
