# Current Status: FCM Unread Increment Ready

## What We've Accomplished

### ✅ Phase 1: Clean Foundation (COMPLETE)
- Removed all complex caching, timers, listeners
- Simple `unreadTracker` with just RPC wrappers
- Clean Sidebar state management
- Direct mark-as-read in ChatArea

### ✅ Phase 2: Basic Flow (COMPLETE)
- App start → Fetch counts from Supabase → Show badges
- Open chat → Mark as read → Badge goes to 0
- Restart app → Counts persist correctly

### 🔄 Phase 3: FCM Increment (READY TO TEST)
- FCM handler checks if own message
- FCM handler checks if active group
- FCM handler calls `__incrementUnreadCount()`
- Sidebar helper increments state
- Badge updates immediately

### ⏳ Phase 4: Realtime Increment (NEXT)
- Will add after FCM works
- Similar logic to FCM
- Test separately

## Current Implementation

### File: `src/lib/push.ts`

**FCM Handler:**
```typescript
// When FCM notification arrives
const isOwnMessage = data.user_id === currentUser?.id;
const isActiveGroup = activeGroupId === data.group_id;

if (!isOwnMessage && !isActiveGroup) {
  // Increment unread count
  if (typeof (window as any).__incrementUnreadCount === 'function') {
    (window as any).__incrementUnreadCount(data.group_id);
  }
}
```

**Logging:**
- Shows increment check details
- Shows helper availability
- Shows why increment was skipped (if applicable)

### File: `src/components/dashboard/Sidebar.tsx`

**Increment Helper:**
```typescript
const incrementUnreadCount = useCallback((groupId: string) => {
  setUnreadCounts(prev => {
    const current = prev.get(groupId) || 0;
    const next = current + 1;
    const newCounts = new Map(prev);
    newCounts.set(groupId, next);
    return newCounts;
  });
}, []);

// Exposed globally
(window as any).__incrementUnreadCount = incrementUnreadCount;
```

**Logging:**
- Shows when helper is called
- Shows current → next count
- Shows updated state

### File: `src/components/dashboard/ChatArea.tsx`

**Mark as Read:**
```typescript
useEffect(() => {
  if (activeGroup?.id && messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    
    unreadTracker.markGroupAsRead(activeGroup.id, lastMessage.id).then(success => {
      if (success) {
        // Update Sidebar count to 0
        if (typeof (window as any).__updateUnreadCount === 'function') {
          (window as any).__updateUnreadCount(activeGroup.id, 0);
        }
      }
    });
  }
}, [activeGroup?.id, messages.length]);
```

## How to Test

### Quick Test (10 minutes)

1. **Setup:**
   - User A: Mobile (Android)
   - User B: Web browser
   - Must be different users!

2. **Test:**
   - User A: Stay on dashboard
   - User B: Send message
   - User A: Badge should increment immediately

3. **Verify:**
   - Check logs for increment flow
   - Badge shows correct count
   - No restart needed

**See:** `QUICK_TEST_GUIDE.md` for detailed steps

## Expected Log Flow

### When FCM Arrives

```
1. [push] 🔔 Notification received, reason=data
2. [push] ⚡ FAST PATH: FCM payload contains full message
3. [push] ✅ Message stored in SQLite in XXms
4. [unread] FCM increment check: {
     groupId: "...",
     isOwnMessage: false,
     isActiveGroup: false,
     helperAvailable: true
   }
5. [unread] ✅ Incrementing for group: <groupId>
6. [unread] ✅ Increment helper called
7. [unread] 📈 incrementUnreadCount called for: <groupId>
8. [unread] 📊 <groupId>: 0 → 1
9. [unread] ✅ State updated, new counts: [[groupId, 1]]
```

### When Opening Chat

```
1. [unread] Marking as read: <groupId>
2. [unread] ✅ Marked as read, updating UI
3. [unread] Updating count: <groupId> → 0
```

## Common Issues & Solutions

### Issue 1: Helper Not Available

**Symptom:** `helperAvailable: false`

**Cause:** Sidebar not mounted yet

**Solution:** Wait for app to fully load, or restart app

### Issue 2: isOwnMessage=true

**Symptom:** `⏭️ Skipping increment (own message)`

**Cause:** Testing with same user on both devices

**Solution:** Use two different users

### Issue 3: isActiveGroup=true

**Symptom:** `⏭️ Skipping increment (active group)`

**Cause:** Viewing that group when message arrives

**Solution:** Stay on dashboard, not in any group

## Success Criteria

Before moving to Phase 4 (Realtime):

- [ ] FCM notification received
- [ ] Message stored in SQLite
- [ ] Increment helper called
- [ ] Badge increments immediately
- [ ] Badge shows correct count
- [ ] Badge persists after restart
- [ ] All logs show correct flow

## Next Steps

### If FCM Works ✅

1. Test all scenarios in `TEST_FCM_UNREAD_INCREMENT.md`
2. Verify edge cases (own message, active group)
3. Move to Phase 4: Add realtime increment

### If FCM Doesn't Work ❌

1. Check logs against expected flow
2. Identify where flow breaks
3. Fix that specific issue
4. Test again

## Phase 4 Preview: Realtime Increment

Once FCM works, we'll add similar logic to realtime handler:

**File:** `src/store/chatstore_refactored/realtimeActions.ts`

```typescript
// When realtime INSERT arrives
const isOwnMessage = row.user_id === user?.id;
const isActiveGroup = activeGroup?.id === row.group_id;

if (!isOwnMessage && !isActiveGroup) {
  if (typeof (window as any).__incrementUnreadCount === 'function') {
    (window as any).__incrementUnreadCount(row.group_id);
  }
}
```

**Why separate phases?**
- FCM is simpler (one code path)
- FCM works even when app closed
- If FCM works, realtime will work too
- Easier to debug one thing at a time

## Build Status

✅ All TypeScript errors fixed  
✅ All diagnostics clean  
✅ Ready to build and test  

## Documentation

- `QUICK_TEST_GUIDE.md` - Fast testing guide (10 min)
- `TEST_FCM_UNREAD_INCREMENT.md` - Detailed test scenarios
- `CLEAN_IMPLEMENTATION_COMPLETE.md` - Implementation details
- `UNREAD_CLEAN_IMPLEMENTATION_PLAN.md` - Overall plan

---

**Current Phase:** 3 of 4 (FCM Increment - Ready to Test)  
**Next Phase:** 4 of 4 (Realtime Increment)  
**Estimated Time to Complete:** 30 minutes (if FCM works)
