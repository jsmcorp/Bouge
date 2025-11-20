# Test: FCM Unread Count Increment

## Goal
Verify that unread counts increment when FCM notifications arrive while on dashboard.

## Prerequisites

✅ Clean implementation is in place  
✅ Sidebar has `__incrementUnreadCount` helper  
✅ FCM handler calls the helper  
✅ Build succeeds  

## Test Setup

**Required:**
- Two different users (User A and User B)
- User A on Android mobile
- User B on web or another device

**Why two different users?**
- Own messages don't increment unread count (by design)
- Testing with same user will show `isOwnMessage=true` and skip increment

## Test Scenario 1: FCM Increment on Dashboard

### Steps

1. **User A (Mobile):**
   - Open app
   - Stay on dashboard
   - Note current unread count for a group (e.g., "Admin" group)

2. **User B (Web):**
   - Open same group
   - Send a message

3. **User A (Mobile):**
   - Should receive FCM notification
   - Badge should increment immediately
   - Check logs

### Expected Logs (User A)

```
[push] 🔔 Notification received, reason=data
[push] ⚡ FAST PATH: FCM payload contains full message
[push] ✅ Message <messageId> stored in SQLite in XXms (fast path)
[unread] Incrementing for group: <groupId>
[unread] Incrementing count for: <groupId>
[unread] <groupId>: 0 → 1
```

### Expected Behavior

✅ Badge increments from 0 to 1  
✅ No app restart needed  
✅ Happens immediately (< 1 second)  

### If It Doesn't Work

**Check 1: Is FCM notification received?**
- Look for `[push] 🔔 Notification received`
- If missing → FCM not configured correctly

**Check 2: Is message stored?**
- Look for `[push] ✅ Message stored in SQLite`
- If missing → FCM payload issue or SQLite issue

**Check 3: Is increment called?**
- Look for `[unread] Incrementing for group`
- If missing → Check `isOwnMessage` and `isActiveGroup` values

**Check 4: Is helper available?**
- Look for `typeof (window as any).__incrementUnreadCount === 'function'`
- If false → Sidebar not mounted or helper not exposed

## Test Scenario 2: Multiple Messages

### Steps

1. **User A:** Stay on dashboard
2. **User B:** Send 3 messages quickly
3. **User A:** Badge should increment 3 times (0→1→2→3)

### Expected Logs

```
[unread] <groupId>: 0 → 1
[unread] <groupId>: 1 → 2
[unread] <groupId>: 2 → 3
```

### Expected Behavior

✅ Badge shows 3  
✅ Each message increments by 1  

## Test Scenario 3: Own Message (Should NOT Increment)

### Steps

1. **User A:** Stay on dashboard
2. **User A:** Send message from web browser
3. **User A (Mobile):** Should receive FCM but badge should NOT increment

### Expected Logs

```
[push] 🔔 Notification received
[unread] Skipping increment (own message or active group)
```

### Expected Behavior

✅ Badge does NOT increment  
✅ Log shows "own message"  

## Test Scenario 4: Active Group (Should NOT Increment)

### Steps

1. **User A:** Open Group X (viewing messages)
2. **User B:** Send message to Group X
3. **User A:** Should receive FCM but badge should NOT increment

### Expected Logs

```
[push] 🔔 Notification received
[push] ✅ UI updated from SQLite
[unread] Skipping increment (own message or active group)
```

### Expected Behavior

✅ Message appears in chat  
✅ Badge does NOT increment  
✅ Badge should go to 0 (mark as read)  

## Test Scenario 5: App Backgrounded

### Steps

1. **User A:** Open app, then minimize (home button)
2. **User B:** Send message
3. **User A:** Open app again
4. **User A:** Badge should show correct count

### Expected Logs

```
[push] 🔔 Notification received
[push] ✅ Message stored in SQLite
[unread] Incrementing for group: <groupId>
```

### Expected Behavior

✅ Badge shows correct count when app reopens  
✅ Count persists  

## Test Scenario 6: Verify Persistence

### Steps

1. **User A:** Receive messages (badge shows 3)
2. **User A:** Kill app completely
3. **User A:** Restart app
4. **User A:** Badge should still show 3

### Expected Logs

```
[unread] Fetching counts for X groups
[unread] Got counts: [[groupId, 3]]
```

### Expected Behavior

✅ Badge shows 3 (from Supabase)  
✅ Count persisted correctly  

## Debugging Guide

### Issue: No FCM Notification Received

**Symptoms:**
- No `[push] 🔔 Notification received` log
- Badge doesn't update

**Possible Causes:**
1. FCM not configured
2. Token not registered
3. Notification permissions denied
4. Network issue

**Solution:**
- Check FCM configuration in Firebase Console
- Check notification permissions on device
- Verify token is registered

### Issue: FCM Received But No Increment

**Symptoms:**
- See `[push] 🔔 Notification received`
- Don't see `[unread] Incrementing for group`

**Possible Causes:**
1. `isOwnMessage=true` (testing with same user)
2. `isActiveGroup=true` (viewing that group)
3. Helper not available

**Solution:**
- Use two different users
- Ensure on dashboard (not in any group)
- Check if Sidebar is mounted

### Issue: Increment Called But Badge Doesn't Update

**Symptoms:**
- See `[unread] Incrementing for group`
- See `[unread] <groupId>: 0 → 1`
- Badge doesn't change

**Possible Causes:**
1. Sidebar not re-rendering
2. Badge reading from wrong state
3. React state not updating

**Solution:**
- Check if `unreadCounts state changed` log appears
- Verify badge is reading from `unreadCounts` Map
- Check React DevTools for state

## Success Criteria

After all tests pass:

✅ Badge increments when FCM arrives (User A on dashboard, User B sends)  
✅ Badge increments multiple times for multiple messages  
✅ Badge does NOT increment for own messages  
✅ Badge does NOT increment for active group  
✅ Badge persists after app restart  
✅ All happens without manual refresh  

## Next Steps

Once FCM increment works:
1. ✅ Test all scenarios above
2. ✅ Verify logs show correct flow
3. ✅ Verify badge updates immediately
4. 🔄 Move to realtime increment (next phase)

## Current Implementation Status

✅ **Step 1:** RPC-only system (DONE)  
✅ **Step 2:** Mark as read with immediate update (DONE)  
🔄 **Step 3:** FCM increment (TESTING NOW)  
⏳ **Step 4:** Realtime increment (NEXT)  

---

**Note:** We're intentionally testing FCM first before realtime because:
- FCM is simpler (one code path)
- FCM works even when app is closed
- If FCM works, realtime will be similar
- Easier to debug one thing at a time
