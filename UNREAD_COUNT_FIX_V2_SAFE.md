# Unread Count Fix V2 - Safe Implementation

## What Was Wrong With V1

The first fix broke FCM and realtime because:

1. **Cleanup effect ran on every message** - `messages` in dependency array
2. **Blocked the main thread** - Synchronous database writes
3. **Race conditions with FCM** - Interfered with message writing
4. **SQLite lock contention** - Multiple writes competing

## V2 Solution - Non-Blocking, Ref-Based

### Key Changes

#### 1. Use Refs Instead of State Dependencies

**Before (V1 - BROKEN)**:
```typescript
useEffect(() => {
  // Cleanup runs EVERY TIME messages changes!
  return () => {
    if (activeGroup?.id && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id);
    }
  };
}, [activeGroup?.id, messages]); // ← messages causes constant re-runs
```

**After (V2 - SAFE)**:
```typescript
const lastMessageIdRef = useRef<string | null>(null);

// Update ref when messages change (doesn't trigger effect)
useEffect(() => {
  if (messages.length > 0) {
    lastMessageIdRef.current = messages[messages.length - 1].id;
  }
}, [messages]);

// Cleanup only runs when activeGroup changes (navigation)
useEffect(() => {
  return () => {
    if (activeGroup?.id && lastMessageIdRef.current) {
      // Fire and forget - don't block
      unreadTracker.markGroupAsRead(activeGroup.id, lastMessageIdRef.current)
        .catch(err => console.error('Failed to mark as read:', err));
    }
  };
}, [activeGroup?.id]); // Only activeGroup, NOT messages
```

#### 2. Fire and Forget - Non-Blocking

**Before (V1 - BLOCKING)**:
```typescript
// This blocks the cleanup phase
unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id);
```

**After (V2 - NON-BLOCKING)**:
```typescript
// Fire and forget - doesn't block navigation or message processing
unreadTracker.markGroupAsRead(activeGroup.id, lastMessageIdRef.current)
  .catch(err => console.error('Failed to mark as read:', err));
```

#### 3. Debounced Dashboard Refresh

**Before (V1 - IMMEDIATE)**:
```typescript
useEffect(() => {
  if (!activeGroup && groups.length > 0) {
    // Runs immediately, could spam database
    unreadTracker.getAllUnreadCounts(true).then(counts => {
      setUnreadCounts(counts);
    });
  }
}, [activeGroup, groups.length]);
```

**After (V2 - DEBOUNCED)**:
```typescript
const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  if (!activeGroup && groups.length > 0) {
    // Clear any pending refresh
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    
    // Wait 500ms before refreshing (debounce)
    refreshTimeoutRef.current = setTimeout(() => {
      unreadTracker.getAllUnreadCounts().then(counts => {
        setUnreadCounts(counts);
      }).catch(err => {
        console.error('Failed to refresh unread counts:', err);
      });
    }, 500);
  }

  return () => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
  };
}, [activeGroup, groups.length]);
```

## How V2 Works

### Scenario 1: User Opens Chat and Stays

1. User opens group with unread messages
2. `lastMessageIdRef` updates as messages load
3. After 2 seconds of viewing, mark-as-read timer fires
4. Messages marked as read (non-blocking)
5. Unread tracker notifies listeners
6. Dashboard badge updates

### Scenario 2: User Opens Chat and Quickly Leaves

1. User opens group with unread messages
2. `lastMessageIdRef` updates with last message ID
3. User navigates back to dashboard (< 2 seconds)
4. ChatArea unmounts
5. Cleanup effect runs (only once, on unmount)
6. Marks as read using ref value (non-blocking)
7. Sidebar detects no active group
8. After 500ms debounce, refreshes unread counts
9. Dashboard badge updates

### Scenario 3: Rapid Message Arrivals (FCM/Realtime)

1. Messages arrive via FCM
2. FCM writes to SQLite
3. `refreshUIFromSQLite()` updates messages array
4. `lastMessageIdRef` updates (doesn't trigger cleanup)
5. Mark-as-read timer resets (2 second delay)
6. FCM continues processing without interference
7. After messages stop arriving, timer fires
8. Marks as read (non-blocking)

## Why V2 Won't Break FCM/Realtime

### 1. No Interference with Message Processing

- Refs don't trigger re-renders
- Cleanup only runs on unmount (navigation)
- All database operations are non-blocking
- No race conditions with FCM writes

### 2. Proper Separation of Concerns

- **FCM**: Writes messages to SQLite
- **Realtime**: Updates UI from SQLite
- **Unread Tracker**: Marks as read independently
- No blocking dependencies between them

### 3. Debouncing Prevents Spam

- Dashboard refresh waits 500ms
- Multiple rapid navigations coalesce into one refresh
- Database not overwhelmed with requests

### 4. Fire and Forget Pattern

- `markGroupAsRead` returns immediately
- Promise rejection handled gracefully
- Doesn't block navigation or message processing

## Testing Checklist

### Basic Functionality
- [ ] Open app, see unread counts
- [ ] Open group, wait 2 seconds, badge updates
- [ ] Open group, immediately go back, badge updates
- [ ] Multiple groups work independently

### FCM Integration
- [ ] Receive FCM notification
- [ ] Message appears in chat
- [ ] Badge increments correctly
- [ ] Open chat, badge goes to 0
- [ ] Rapid messages don't break anything

### Realtime Integration
- [ ] Realtime messages appear instantly
- [ ] No lag or delays
- [ ] Badge updates correctly
- [ ] No console errors

### Performance
- [ ] No excessive database writes
- [ ] No UI blocking
- [ ] Smooth navigation
- [ ] No memory leaks

## Monitoring

### Success Indicators
```
✅ Marked group ... as read up to message ...
📊 Dashboard visible - refreshing unread counts
[unread] Triggered callbacks for group ..., count=0
```

### Warning Signs
```
❌ Failed to mark as read: ...
❌ Failed to refresh unread counts: ...
⚠️ Multiple rapid mark-as-read calls (should be rare)
```

## Rollback Plan

If V2 still causes issues:

1. Revert both files to original state
2. Use alternative approach: Page Visibility API
3. Mark as read only when page becomes hidden
4. Don't use any effects in ChatArea

## Files Modified

1. `src/components/dashboard/ChatArea.tsx`
   - Added refs for non-blocking mark-as-read
   - Separated message tracking from effect triggers
   - Fire-and-forget pattern for database writes

2. `src/components/dashboard/Sidebar.tsx`
   - Added debounced dashboard refresh
   - 500ms delay to prevent spam
   - Proper cleanup of timers

## Key Differences from V1

| Aspect | V1 (Broken) | V2 (Safe) |
|--------|-------------|-----------|
| Cleanup trigger | Every message | Only on unmount |
| Blocking | Yes | No (fire and forget) |
| Database writes | Constant | Minimal |
| FCM interference | Yes | No |
| Debouncing | No | Yes (500ms) |
| Refs usage | No | Yes |
| Error handling | None | Catch and log |

## Why This Should Work

1. **Refs don't trigger re-renders** - No effect spam
2. **Cleanup only on unmount** - Predictable behavior
3. **Non-blocking operations** - No thread blocking
4. **Debounced refreshes** - No database spam
5. **Proper error handling** - Graceful failures
6. **Respects existing flows** - No FCM/realtime interference

The key insight: **Don't fight the framework**. Use refs for values that shouldn't trigger effects, and make all database operations non-blocking.
