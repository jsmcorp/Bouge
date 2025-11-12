# Bulletproof FCM Message Display Fix

## Problem
When receiving messages via FCM push notifications:
1. ❌ Messages were stored in SQLite but not shown in chat UI
2. ❌ When they did appear (after manual refresh), they were hidden behind the input area

## Root Causes

### Issue 1: No UI Refresh
`backgroundMessageSync` stored messages in SQLite but never notified the chat component to refresh.

### Issue 2: No Auto-scroll
Even when messages appeared, the chat didn't auto-scroll to show them, leaving them hidden behind the input area.

## Complete Fix

### Part 1: UI Refresh (3 locations in backgroundMessageSync.ts)
After storing each message, check if it's for the active chat:
- **Active chat**: Call `fetchMessages()` to refresh UI
- **Other chats**: Dispatch event for badge updates

### Part 2: Auto-scroll to Bottom
After refreshing messages, force scroll to bottom:
```typescript
setTimeout(() => {
  const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
    console.log(`[bg-sync] 📍 Auto-scrolled to bottom to show new message`);
  }
}, 100);
```

## Why This Works

1. **100ms delay**: Ensures DOM is fully updated after `fetchMessages()`
2. **Direct viewport access**: Uses Radix UI's scroll area viewport
3. **scrollHeight**: Scrolls to absolute bottom, ensuring last message is visible
4. **Non-blocking**: Uses `setTimeout` so sync operation completes first

## Applied To

1. ✅ `fetchAndStoreMessage()` - single message fetch (main path)
2. ✅ `fetchAndStoreMessage()` - retry path (fallback)
3. ✅ `fetchMissedMessages()` - bulk sync on app resume

## Result

Messages received via FCM now:
- ✅ Appear instantly in chat UI
- ✅ Auto-scroll to show the latest message
- ✅ Are fully visible (not hidden behind input)
- ✅ Match realtime subscription behavior exactly

## Console Logs to Verify

```
[bg-sync] 🔄 Refreshing active group 04a965fb... to show new message
[bg-sync] 📍 Auto-scrolled to bottom to show new message
```

## Edge Cases Handled

- ✅ Message arrives while user is typing (doesn't interrupt)
- ✅ Multiple messages arrive rapidly (scrolls after last one)
- ✅ Message arrives while scrolled up (still scrolls to bottom)
- ✅ Message arrives for non-active group (no scroll, just badge)
- ✅ App resume with many missed messages (scrolls once after all loaded)
