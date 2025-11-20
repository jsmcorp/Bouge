# Realtime Mark-as-Read Fix

## Problem
When viewing a chat and new messages arrive via realtime, they were NOT being marked as read. This caused the separator to show them as unread when closing and reopening the chat.

## Example Scenario
1. User opens Chat A (has 5 unread messages)
2. Separator shows above the 5 unread messages ✅
3. User stays in Chat A
4. 3 new messages arrive via realtime
5. User closes Chat A
6. User reopens Chat A
7. **Before fix**: Separator shows above all 8 messages (5 old + 3 new) ❌
8. **After fix**: Separator shows above the NEXT message that arrives after closing ✅

## Root Cause
The ChatArea component had two mark-as-read triggers:
1. **On open**: Marks all existing messages as read ✅
2. **On close**: Marks all messages as read ✅

But there was NO trigger for messages that arrive while viewing the chat.

## The Fix
Added a new effect that subscribes to the chat store and watches for new messages arriving in realtime.

### Implementation

```typescript
// REALTIME: Mark new messages as read instantly when they arrive while viewing
useEffect(() => {
  if (!activeGroup?.id) return;

  // Get initial message count
  const initialMessages = useChatStore.getState().messages;
  let lastMessageCount = initialMessages.length;
  let lastMessageId = initialMessages.length > 0 
    ? initialMessages[initialMessages.length - 1].id 
    : null;

  // Subscribe to store changes to detect new messages
  const unsubscribe = useChatStore.subscribe((state) => {
    // Only process if we're still on the same group
    if (state.activeGroup?.id !== activeGroup.id) return;

    const currentMessages = state.messages;
    const currentCount = currentMessages.length;

    // Check if new messages arrived
    if (currentCount > lastMessageCount && currentMessages.length > 0) {
      const latestMessage = currentMessages[currentMessages.length - 1];
      
      // Only mark as read if it's a different message (not just a state update)
      if (latestMessage.id !== lastMessageId && !latestMessage.id.startsWith('temp-')) {
        console.log('[unread] 📨 REALTIME: New message arrived while viewing, marking as read instantly');
        
        // Mark as read immediately
        const messageTimestamp = new Date(latestMessage.created_at).getTime();
        unreadTracker.markGroupAsRead(activeGroup.id, latestMessage.id, messageTimestamp)
          .catch(err => console.error('[unread] ❌ Realtime mark as read failed:', err));
        
        lastMessageId = latestMessage.id;
      }
    }

    lastMessageCount = currentCount;
  });

  return () => {
    unsubscribe();
  };
}, [activeGroup?.id]);
```

## How It Works

1. **Subscribe to store**: Watches for any changes to the messages array
2. **Detect new messages**: Compares current message count with previous count
3. **Verify it's a new message**: Checks if the last message ID changed (not just a state update)
4. **Mark as read instantly**: Calls `unreadTracker.markGroupAsRead()` with the new message
5. **Update tracking**: Stores the new message ID and count for next comparison

## Benefits

1. **WhatsApp-style behavior**: Messages are marked as read as soon as you see them
2. **Accurate separator**: Only shows unread messages that arrived AFTER you closed the chat
3. **No manual action needed**: Automatic, no need to scroll or click
4. **Works with realtime**: Handles messages from push notifications, other users, etc.

## Complete Mark-as-Read Flow

Now there are THREE triggers for marking messages as read:

1. **On open** (100ms delay)
   - Marks all existing messages as read
   - Clears unread badge in sidebar

2. **On realtime arrival** (instant)
   - Marks new messages as read while viewing
   - Prevents them from showing as unread later

3. **On close** (cleanup)
   - Final mark-as-read to ensure nothing is missed
   - Sets baseline for next open

## Testing

### Test 1: Realtime Messages While Viewing
1. Open Chat A (has unread messages)
2. Keep Chat A open
3. Send a message from another device/user
4. **Expected**: Message appears and is marked as read instantly
5. Close Chat A
6. Reopen Chat A
7. **Expected**: No separator (all messages were marked as read)

### Test 2: Multiple Realtime Messages
1. Open Chat A
2. Receive 5 messages while viewing
3. Close Chat A
4. Reopen Chat A
5. **Expected**: No separator (all 5 were marked as read)
6. Receive 2 more messages while closed
7. Reopen Chat A
8. **Expected**: Separator shows above the 2 new messages

### Test 3: Optimistic Messages
1. Open Chat A
2. Send a message (optimistic, temp ID)
3. **Expected**: Not marked as read (temp- ID is skipped)
4. Message gets real ID from server
5. **Expected**: Still not marked as read (it's your own message)

## Files Changed
- `src/components/dashboard/ChatArea.tsx` - Added realtime message subscription and mark-as-read logic

## Performance
- **Minimal overhead**: Only runs when chat is open
- **Efficient**: Only processes when message count changes
- **Clean**: Unsubscribes when chat closes
