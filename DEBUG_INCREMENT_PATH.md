# Debug Guide: Increment Path Not Firing

## Problem

The logs show that `incrementUnreadForGroup` is never being called, which means:
- Badges only update after RPC refresh (restart or explicit refresh)
- Badges don't update in realtime when messages arrive
- The increment code path is not being reached

## New Debug Logging Added

### 1. Instance ID Tracking

**Purpose:** Detect if multiple unreadTracker instances exist

**Logs to look for:**
```
[unread] 🆔 Tracker instance created, id=abc123
[Sidebar] 🔔 Subscribing to unread count updates (tracker instance=abc123)
[unread] 🔵 incrementUnreadForGroup CALLED (instance=abc123)
```

**What to check:**
- All logs should show the SAME instance ID
- If you see different IDs, there are multiple instances (module bundling issue)

### 2. Realtime Path Debug

**Logs to look for:**
```
[realtime-v2] 📨 Message NOT attached to state: id=...
[realtime-debug] 🔍 Checking unread increment: userId=..., row.user_id=..., isOwnMessage=false
[realtime-debug] ✅ BEFORE incrementUnreadForGroup for <groupId>
[unread] 🔵 incrementUnreadForGroup CALLED
[unread] 📊 Current count: 0, Next count: 1, Listeners: 1
[unread] 📢 About to notify 1 listeners
[Sidebar] 🔔 Unread callback fired: count=1
[realtime-debug] ✅ AFTER incrementUnreadForGroup for <groupId>
```

**What to check:**
- If you DON'T see `Message NOT attached to state` → Realtime subscription not working
- If you see `Message NOT attached` but NOT `Checking unread increment` → Code path not reached
- If you see `isOwnMessage=true` → Testing with same user (expected behavior)
- If you see `BEFORE` but NOT `incrementUnreadForGroup CALLED` → Import/instance issue

### 3. FCM Path Debug

**Logs to look for:**
```
[push] 🔔 Notification received
[push] ✅ Message stored in SQLite
[push-debug] 🔍 FCM notification payload: {messageId, groupId, fromUserId, ...}
[push-debug] 🔍 Increment check: isOwnMessage=false, isActiveGroup=false
[push-debug] ✅ BEFORE incrementUnreadForGroup for <groupId>
[unread] 🔵 incrementUnreadForGroup CALLED
[unread] 📊 Current count: 0, Next count: 1, Listeners: 1
[unread] 📢 About to notify 1 listeners
[Sidebar] 🔔 Unread callback fired: count=1
[push-debug] ✅ AFTER incrementUnreadForGroup for <groupId>
```

**What to check:**
- If you DON'T see `Notification received` → FCM not working
- If you see `Notification received` but NOT `FCM notification payload` → Wrong code path
- If you see `isOwnMessage=true` → Testing with same user (expected behavior)
- If you see `isActiveGroup=true` → Currently viewing that group (expected behavior)
- If you see `BEFORE` but NOT `incrementUnreadForGroup CALLED` → Import/instance issue

### 4. Increment Function Debug

**Logs to look for:**
```
[unread] 🔵 incrementUnreadForGroup CALLED for group <groupId> (instance=abc123)
[unread] 📊 Current count: 0, Next count: 1, Listeners: 1
[unread] ✅ Cache updated
[unread] 📢 About to notify 1 listeners
[unread] ✅ incrementUnreadForGroup COMPLETED for group <groupId>
```

**What to check:**
- If `Listeners: 0` → Sidebar not subscribed yet
- If you see this but NOT `Unread callback fired` → Different instance or subscription issue

## Test Scenarios

### Test 1: Two Different Users (REQUIRED)

**Setup:**
- Device A: Login as User A, stay on dashboard
- Device B: Login as User B, send message to shared group

**Expected Logs on Device A:**
```
# Realtime or FCM receives message
[realtime-debug] 🔍 Checking unread increment: userId=userA, row.user_id=userB, isOwnMessage=false
[realtime-debug] ✅ BEFORE incrementUnreadForGroup
[unread] 🔵 incrementUnreadForGroup CALLED (instance=abc123)
[unread] 📊 Current count: 0, Next count: 1, Listeners: 1
[Sidebar] 🔔 Unread callback fired: count=1 (instance=abc123)
[SidebarRow] Rendering badge: count=1
```

**If you DON'T see these logs:**
- Check if realtime subscription is active
- Check if FCM is configured correctly
- Check if message is being received at all

### Test 2: Same User (Should NOT Increment)

**Setup:**
- Device A: Login as User A, stay on dashboard
- Device B: Login as User A, send message to group

**Expected Logs on Device A:**
```
[realtime-debug] 🔍 Checking unread increment: userId=userA, row.user_id=userA, isOwnMessage=true
[realtime-debug] ⏭️ Skipping increment (own message)
```

**This is CORRECT behavior** - own messages don't increment unread count

### Test 3: Active Group (Should NOT Increment)

**Setup:**
- Device A: Login as User A, viewing Group X
- Device B: Login as User B, send message to Group X

**Expected Logs on Device A:**
```
[realtime-v2] 📨 Message attached to state (active group)
# No increment logs - message is for active group
```

**This is CORRECT behavior** - active group messages are marked as read immediately

## Diagnostic Checklist

### ✅ Check 1: Instance ID Consistency
- [ ] Find `Tracker instance created, id=XXXXX`
- [ ] Find `Subscribing to unread count updates (tracker instance=XXXXX)`
- [ ] Verify both show the SAME ID
- [ ] If different IDs → Multiple instances problem

### ✅ Check 2: Realtime Subscription Active
- [ ] Find `Setting up multi-group realtime subscription`
- [ ] Find `Subscribing to messages with filter`
- [ ] Find `Realtime INSERT received` when message arrives
- [ ] If missing → Realtime not working

### ✅ Check 3: FCM Working
- [ ] Find `Notification received` when message arrives
- [ ] Find `Message stored in SQLite`
- [ ] Find `FCM notification payload` debug log
- [ ] If missing → FCM not configured or not firing

### ✅ Check 4: Increment Path Reached
- [ ] Find `BEFORE incrementUnreadForGroup` in logs
- [ ] Find `incrementUnreadForGroup CALLED` right after
- [ ] If BEFORE but no CALLED → Import/instance issue
- [ ] If neither → Code path not reached

### ✅ Check 5: Callback Fires
- [ ] Find `incrementUnreadForGroup COMPLETED`
- [ ] Find `Unread callback fired` right after
- [ ] Find `Updated unreadCounts map`
- [ ] If increment completes but no callback → Subscription issue

### ✅ Check 6: Badge Updates
- [ ] Find `Rendering badge: count=X` after callback
- [ ] Verify count matches expected value
- [ ] If callback fires but badge doesn't update → UI issue

## Common Issues and Solutions

### Issue 1: No Increment Logs at All

**Symptoms:**
- No `BEFORE incrementUnreadForGroup` logs
- No `incrementUnreadForGroup CALLED` logs
- Badge only updates after restart

**Possible Causes:**
1. Testing with same user on both devices
2. Realtime subscription not active
3. FCM not configured
4. Message not being received

**Solution:**
- Use two different users
- Check realtime subscription logs
- Check FCM configuration
- Verify message arrives (check SQLite)

### Issue 2: BEFORE Log But No CALLED Log

**Symptoms:**
- See `BEFORE incrementUnreadForGroup`
- Don't see `incrementUnreadForGroup CALLED`

**Cause:**
- Multiple unreadTracker instances
- Import resolving to different module

**Solution:**
- Check instance IDs match
- Ensure single import path for unreadTracker
- Check build configuration

### Issue 3: Increment Completes But No Callback

**Symptoms:**
- See `incrementUnreadForGroup COMPLETED`
- Don't see `Unread callback fired`

**Cause:**
- Sidebar not subscribed yet
- Different instance
- Subscription cleaned up

**Solution:**
- Check `Listeners: X` in increment log (should be > 0)
- Verify instance IDs match
- Check Sidebar subscription logs

### Issue 4: Callback Fires But Badge Doesn't Update

**Symptoms:**
- See `Unread callback fired`
- See `Updated unreadCounts map`
- Don't see `Rendering badge` or badge doesn't change

**Cause:**
- UI not re-rendering
- Map mutation instead of replacement
- Badge component memoized

**Solution:**
- Check if `unreadCounts state changed` log appears
- Verify new Map is created in callback
- Check badge rendering logic

## Next Steps

1. **Run Test 1** (two different users)
2. **Capture complete logs** from app start to message arrival
3. **Check each diagnostic item** in order
4. **Share logs** with focus on:
   - Instance IDs
   - Whether `BEFORE incrementUnreadForGroup` appears
   - Whether `incrementUnreadForGroup CALLED` appears
   - Whether `Unread callback fired` appears

The comprehensive logging will show exactly where the flow breaks!
