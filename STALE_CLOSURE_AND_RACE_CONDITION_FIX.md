# Stale Closure + Race Condition Fix

## Root Cause Analysis

You have TWO separate bugs causing the unread separator to reappear:

### Bug 1: Stale Closure in Cleanup (FIXED ✅)
The cleanup function in ChatArea was capturing a stale snapshot of messages when the effect was created. When you closed the chat, it would mark the OLD last message as read, reverting your progress.

**Fix Applied:** Use `useRef` to track the latest messages, so the cleanup function always sees the current state.

### Bug 2: Race Condition on Chat Open (NEEDS FIX ❌)
When you open a chat, the sequence is:

1. `fetchMessages()` is called
2. `fetchMessages()` reads `last_read_at` from SQLite → Gets OLD value (`586d4f9d`)
3. `fetchMessages()` calculates separator using OLD value → Shows unread line
4. 100ms later: `markGroupAsRead()` is called → Updates to NEW value (`8199d9a9`)
5. But the separator was already calculated with the OLD value!

**Evidence from log31.txt:**
```
Line 523: [unread] 📱 LOCAL-FIRST: last_read_at=2025-11-21T13:02:35.997Z  ← OLD timestamp
Line 559: [unread] 📊 Last read message "586d4f9d" found at index: 48  ← OLD message
Line 562: [unread] 📊 Separator will show BELOW message: 586d4f9d  ← WRONG!
Line 563: [unread] 📊 First unread message: 8199d9a9  ← Should be no unread!
```

Then later:
```
Line 571: [unread] ⚡ REALTIME: Marking as read instantly  ← Too late!
Line 595: [unread] 📊 Last read message "8199d9a9" found at index: 80  ← Correct now
Line 597: [unread] 📊 No unread messages after last read  ← Fixed!
```

## The Fix

### Option 1: Mark as Read BEFORE fetchMessages (Recommended)

Change the order in ChatArea.tsx so we mark as read FIRST, then fetch messages:

```typescript
useEffect(() => {
  if (activeGroup?.id) {
    console.log(`💬 ChatArea: Opening chat for group ${activeGroup.id}`);
    
    // INSTANT: Clear sidebar badge
    if (typeof (window as any).__updateUnreadCount === 'function') {
      (window as any).__updateUnreadCount(activeGroup.id, 0);
    }
    
    // STEP 1: Mark as read FIRST (before fetching messages)
    // This ensures the separator calculation uses the LATEST read status
    const markAsReadFirst = async () => {
      // Get the last message from SQLite to mark as read
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { sqliteService } = await import('@/lib/sqliteService');
        const isReady = await sqliteService.isReady();
        if (isReady) {
          // Get the last message for this group
          const lastMessage = await sqliteService.getLastMessageForGroup(activeGroup.id);
          if (lastMessage) {
            console.log('[unread] ⚡ PRE-FETCH: Marking as read before loading messages');
            const messageTimestamp = new Date(lastMessage.created_at).getTime();
            await unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id, messageTimestamp);
            console.log('[unread] ✅ PRE-FETCH: Marked as read');
          }
        }
      }
    };
    
    // STEP 2: Then fetch messages (separator will use updated read status)
    markAsReadFirst().then(() => {
      return fetchMessages(activeGroup.id);
    }).then(() => {
      console.log(`💬 ChatArea: Messages loaded`);
    });
  }
}, [activeGroup?.id, fetchMessages]);
```

### Option 2: Recalculate Separator After Mark-as-Read

Keep the current order but force a separator recalculation after marking as read:

```typescript
useEffect(() => {
  if (activeGroup?.id) {
    // Load messages first
    fetchMessages(activeGroup.id);
    
    // Then mark as read and recalculate separator
    setTimeout(async () => {
      const currentMessages = useChatStore.getState().messages;
      if (currentMessages.length > 0) {
        const lastRealMessage = [...currentMessages].reverse().find(msg => 
          msg.id && !msg.id.startsWith('temp-')
        );
        
        if (lastRealMessage) {
          // Mark as read
          const messageTimestamp = new Date(lastRealMessage.created_at).getTime();
          await unreadTracker.markGroupAsRead(activeGroup.id, lastRealMessage.id, messageTimestamp);
          
          // CRITICAL: Force separator recalculation with updated read status
          await useChatStore.getState().recalculateSeparator(activeGroup.id);
        }
      }
    }, 100);
  }
}, [activeGroup?.id, fetchMessages]);
```

## Recommendation

Use **Option 1** because it's cleaner and avoids the race condition entirely. The separator will be calculated correctly the first time because the read status is already updated.

## Implementation Steps

1. Add `getLastMessageForGroup()` method to sqliteService
2. Update ChatArea.tsx to mark as read BEFORE fetchMessages
3. Remove the 100ms setTimeout (no longer needed)
4. Test: Open chat → No separator should appear

## Expected Log Output After Fix

```
[unread] ⚡ PRE-FETCH: Marking as read before loading messages
[unread] ✅ PRE-FETCH: Marked as read
💬 ChatArea: Opening chat for group...
[unread] 📱 LOCAL-FIRST: last_read_at=2025-11-21T13:03:35.184Z  ← NEW timestamp
[unread] 📊 Last read message "8199d9a9" found at index: 80  ← CORRECT!
[unread] 📊 No unread messages after last read  ← CORRECT!
```

No separator appears because the read status was updated BEFORE the separator calculation.
