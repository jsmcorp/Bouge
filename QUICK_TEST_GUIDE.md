# Quick Test Guide - FCM Unread Increment

## Setup (5 minutes)

1. **Two Users Required:**
   - User A: Your mobile device (Android)
   - User B: Web browser or another device
   - ⚠️ MUST be different users (not same account)

2. **User A (Mobile):**
   - Open app
   - Go to dashboard
   - Keep app in foreground

3. **User B (Web):**
   - Open same app
   - Join same group as User A

## Quick Test (2 minutes)

### Test 1: Basic Increment

**Steps:**
1. User A: Note current badge count (e.g., 0)
2. User B: Send message to group
3. User A: Watch badge

**Expected:**
- Badge increments immediately (0 → 1)
- No restart needed

**Logs to check:**
```
[push] 🔔 Notification received
[unread] ✅ Incrementing for group: <groupId>
[unread] 📈 incrementUnreadCount called
[unread] 📊 <groupId>: 0 → 1
```

**If it works:** ✅ Move to Test 2  
**If it doesn't:** See Troubleshooting below

### Test 2: Multiple Messages

**Steps:**
1. User B: Send 3 messages quickly
2. User A: Watch badge

**Expected:**
- Badge: 1 → 2 → 3

**Logs:**
```
[unread] 📊 <groupId>: 0 → 1
[unread] 📊 <groupId>: 1 → 2
[unread] 📊 <groupId>: 2 → 3
```

### Test 3: Mark as Read

**Steps:**
1. User A: Open the group (badge shows 3)
2. User A: Wait 1 second
3. User A: Go back to dashboard

**Expected:**
- Badge goes to 0

**Logs:**
```
[unread] Marking as read: <groupId>
[unread] ✅ Marked as read, updating UI
[unread] Updating count: <groupId> → 0
```

### Test 4: Persistence

**Steps:**
1. User A: Kill app
2. User A: Restart app
3. User A: Check badge

**Expected:**
- Badge shows 0 (persisted from mark as read)

## Troubleshooting

### ❌ Badge Doesn't Increment

**Check 1: FCM Received?**
```
Look for: [push] 🔔 Notification received
```
- ✅ Found → Go to Check 2
- ❌ Not found → FCM not working, check Firebase config

**Check 2: Message Stored?**
```
Look for: [push] ✅ Message stored in SQLite
```
- ✅ Found → Go to Check 3
- ❌ Not found → SQLite issue

**Check 3: Increment Called?**
```
Look for: [unread] ✅ Incrementing for group
```
- ✅ Found → Go to Check 4
- ❌ Not found → Check if using same user (see Check 5)

**Check 4: Helper Available?**
```
Look for: helperAvailable: true
```
- ✅ true → Go to Check 6
- ❌ false → Sidebar not mounted, restart app

**Check 5: Same User?**
```
Look for: isOwnMessage: true
```
- ✅ true → **Use different users!**
- ❌ false → Continue investigating

**Check 6: State Updated?**
```
Look for: [unread] ✅ State updated, new counts: [[groupId, 1]]
```
- ✅ Found → UI rendering issue
- ❌ Not found → State update failed

### ❌ Badge Increments But Shows Wrong Number

**Check:** Are you testing with multiple devices as same user?
- Own messages don't increment (by design)
- Use different users

### ❌ Badge Doesn't Persist After Restart

**Check:** Did mark as read work?
```
Look for: [unread] ✅ Marked as read
```
- If missing → Mark as read not working
- If present → Check Supabase RPC

## Success Checklist

- [ ] Badge increments when User B sends message
- [ ] Badge increments multiple times for multiple messages
- [ ] Badge goes to 0 when opening chat
- [ ] Badge stays at 0 after restart
- [ ] All logs show correct flow

## Next Phase

Once all tests pass:
- ✅ FCM increment works
- 🔄 Add realtime increment (similar logic)
- 🔄 Test realtime increment
- ✅ Complete!

## Quick Commands

**View logs (Android):**
```bash
adb logcat | grep -E "\[unread\]|\[push\]"
```

**Clear app data (fresh start):**
```bash
adb shell pm clear com.confessr.app
```

---

**Estimated Time:** 10 minutes total
- Setup: 5 min
- Testing: 5 min

**Current Status:** Ready to test FCM increment
