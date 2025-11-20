# True Local-First Unread System - Implementation Guide

## The Correct Architecture

### Core Principle:
**LOCAL SQLite is the ONLY source of truth for unread counts and separator position**
**Supabase depends on local, NOT the other way around**

## The 4 Rules:

### 1. **When Opening Chat** → Mark ALL as Read INSTANTLY
```typescript
// In ChatArea.tsx
useEffect(() => {
  if (activeGroup?.id) {
    // Load messages
    fetchMessages(activeGroup.id);
    
    // Mark ALL messages as read INSTANTLY (100ms delay for messages to load)
    setTimeout(async () => {
      const lastMessage = messages[messages.length - 1];
      await unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id);
      // This updates LOCAL SQLite immediately
      // Syncs to Supabase in background
    }, 100);
  }
}, [activeGroup?.id]);
```

### 2. **While Chat is Open** → Skip/Ignore All Messages
```typescript
// Messages received while chat is open are automatically "read"
// because we mark as read when opening and when closing
```

### 3. **On Dashboard/Background** → Track Unread Count Locally
```typescript
// When push notification arrives:
// 1. Increment LOCAL unread count
// 2. Show badge based on LOCAL count
// 3. Sync to Supabase in background (optional)
```

### 4. **Separator Calculation** → LOCAL ONLY
```typescript
// In fetchActions.ts
const calculateFirstUnreadLocal = async () => {
  // Get last_read_at from LOCAL SQLite (NO Supabase fetch)
  const localLastReadAt = await sqliteService.getLocalLastReadAt(groupId, userId);
  
  // If null → User never opened this chat → Show all as unread
  // If has value → Show messages after that timestamp as unread
  
  const unreadMessages = messages.filter(msg => 
    msg.created_at > localLastReadAt && msg.user_id !== userId
  );
  
  return { firstUnreadId: unreadMessages[0]?.id, unreadCount: unreadMessages.length };
};
```

## Data Flow

### Opening a Chat:
```
1. User clicks on chat
2. Load messages from LOCAL SQLite (instant)
3. Calculate separator from LOCAL last_read_at (instant)
4. Show separator above unread messages
5. Mark ALL messages as read in LOCAL SQLite (instant)
6. Sync to Supabase in background (non-blocking)
```

### Receiving a Message (Dashboard/Background):
```
1. Push notification arrives
2. Increment LOCAL unread count for that group
3. Show badge with LOCAL count
4. (Optional) Sync to Supabase in background
```

### Closing a Chat:
```
1. User navigates away
2. Mark as read in LOCAL SQLite (if not already done)
3. Save last_read_at = timestamp of last message
4. Sync to Supabase in background
```

## Implementation Checklist

### ✅ Done:
- [x] Separator calculated from LOCAL SQLite only
- [x] Mark as read updates LOCAL first
- [x] Background sync to Supabase
- [x] No Supabase dependency for separator

### ⏳ TODO:
- [ ] Remove Supabase sync from separator calculation (DONE in code, needs testing)
- [ ] Ensure group_members row exists in LOCAL before calculating
- [ ] Handle case where LOCAL has no data (first time user)
- [ ] Test with app in background receiving notifications

## Key Files

1. **src/components/dashboard/ChatArea.tsx**
   - Marks as read when opening chat (100ms delay)
   - Marks as read when closing chat (unmount)

2. **src/store/chatstore_refactored/fetchActions.ts**
   - Calculates separator from LOCAL SQLite only
   - NO Supabase fetch for separator

3. **src/lib/unreadTracker.ts**
   - Updates LOCAL SQLite first
   - Syncs to Supabase in background

4. **src/lib/sqliteServices_Refactored/memberOperations.ts**
   - `getLocalLastReadAt()` - Returns LOCAL value only
   - `updateLocalLastReadAt()` - Updates LOCAL immediately
   - `calculateFirstUnreadLocal()` - Calculates from LOCAL data

## Testing Scenarios

### Scenario 1: First Time Opening Chat
```
Expected:
- LOCAL last_read_at: null
- Separator: Shows all messages from others as unread
- After opening: Marks all as read locally
```

### Scenario 2: Returning to Chat with Unread Messages
```
Expected:
- LOCAL last_read_at: 2025-11-20 10:00:00
- New messages: 2025-11-20 10:05:00, 10:10:00
- Separator: Shows above 10:05:00 message
- After opening: Marks all as read locally
```

### Scenario 3: Receiving Message While Chat is Open
```
Expected:
- Message arrives
- No separator (chat is open)
- Message is "read" because we mark as read when closing
```

### Scenario 4: Receiving Message While on Dashboard
```
Expected:
- Message arrives via push
- LOCAL unread count increments
- Badge shows LOCAL count
- When opening chat: Separator shows above new message
```

## Current Issues to Fix

### Issue 1: Separator Showing Wrong Position
**Problem:** Showing 30+ messages as unread when only 1 is unread
**Cause:** LOCAL last_read_at is null or 0
**Fix:** Ensure group_members row exists with correct last_read_at

### Issue 2: Depending on Supabase
**Problem:** Code still fetches from Supabase for separator
**Fix:** Remove all Supabase fetches from separator calculation (DONE)

### Issue 3: Not Marking as Read Instantly
**Problem:** Waiting for async operations before marking as read
**Fix:** Mark as read immediately when opening (100ms delay for messages to load)

## Next Steps

1. **Verify group_members table** has correct schema in LOCAL SQLite
2. **Ensure row exists** for each group user is a member of
3. **Initialize last_read_at** to 0 or null when user first joins group
4. **Test separator** shows correct position based on LOCAL data only
5. **Remove all Supabase dependencies** from separator calculation

## Success Criteria

✅ Separator shows correct position (matches LOCAL unread count)
✅ Separator calculated instantly (no network wait)
✅ Mark as read happens instantly (no network wait)
✅ Supabase sync happens in background (non-blocking)
✅ Works offline (uses LOCAL data only)
✅ Unread count based on LOCAL data (not Supabase RPC)

