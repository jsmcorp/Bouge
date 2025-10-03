# Quick Test Guide - FCM Dashboard Fix

## 🚀 What Was Fixed

### The Problem
- When on dashboard, FCM notifications arrived but were completely ignored
- No unread badge updates
- No in-app notifications
- Had to manually open groups to see new messages

### The Solution
- Added proper FCM notification listener
- Messages now fetch and store in SQLite immediately when FCM arrives
- Unread badges update instantly from local data
- In-app toast notifications show when on dashboard
- No longer dependent on realtime subscription

---

## 📱 How to Test

### Prerequisites
1. Build the app: `npm run build && npx cap sync`
2. Install on Device B (test device)
3. Have Device A ready to send messages

---

## Test 1: Dashboard Real-Time Updates ⭐ MOST IMPORTANT

**This is the main fix - test this first!**

### Steps:
1. Open app on Device B
2. Stay on **dashboard** (do NOT open any chat)
3. Send a message from Device A to a group

### Expected Results:
✅ **Unread badge appears instantly** on the group card  
✅ **In-app toast notification** pops up at the top  
✅ Toast shows: group name and "Tap to view"  
✅ Clicking "View" button navigates to that group  

### What to Look For in Logs:
```
[push] PushNotifications.pushNotificationReceived: {...}
[bg-sync] Fetching message <id> for group <group_id>
[bg-sync] ✅ Message <id> stored successfully
[unread] Triggered callbacks for group <group_id>, count=1
```

### If It Doesn't Work:
- Check if notification permission is granted
- Check logs for "No listeners found for event notificationReceived"
- If you see that error, the fix didn't apply - rebuild and sync

---

## Test 2: Instant Message Loading

### Steps:
1. **Close app completely** on Device B (swipe away from recent apps)
2. Send 5 messages from Device A
3. Wait 5 seconds
4. Open app on Device B
5. Navigate to dashboard
6. Open the chat screen

### Expected Results:
✅ Messages appear **instantly** (<100ms)  
✅ **Green "UNREAD MESSAGES" separator** line visible  
✅ Auto-scrolls to first unread message  
✅ No "Connecting..." delay  

### What to Look For in Logs:
```
📦 Loading 50 messages from SQLite for group <group_id>
✅ Loaded 45 messages from SQLite in <100ms
🔍 MessageList: firstUnreadMessageId=<id>, unreadCount=5
```

---

## Test 3: Notification Tap

### Steps:
1. Lock Device B (press power button)
2. Send message from Device A
3. Wait for notification to appear on lock screen
4. Unlock Device B
5. Tap the notification

### Expected Results:
✅ App opens to dashboard  
✅ Unread badge **already visible** on group card  
✅ Open chat shows message instantly  
✅ Unread separator visible  

---

## 🔍 Debugging

### Check Logs for These Patterns

**✅ Good - FCM Listener Working:**
```
[push] PushNotifications.pushNotificationReceived: {...}
[push] Notification received, reason=data
[push] Fetching message <id> in background
[bg-sync] ✅ Message <id> stored successfully
[unread] Triggered callbacks for group <group_id>, count=1
```

**❌ Bad - FCM Listener Not Working:**
```
Capacitor/...gingPlugin: Notifying listeners for event notificationReceived
Capacitor/...gingPlugin: No listeners found for event notificationReceived
```

If you see the "No listeners found" error:
1. Rebuild: `npm run build`
2. Sync: `npx cap sync`
3. Reinstall app on device
4. Test again

---

## 📊 Performance Expectations

### Before Fix:
- Dashboard: No updates when messages arrive
- Message load time: 4-5 seconds (Supabase fetch)
- Unread separator: Not working

### After Fix:
- Dashboard: Instant badge updates (<100ms)
- Message load time: <100ms (SQLite)
- Unread separator: Working correctly
- In-app notifications: Shown immediately

---

## 🎯 Key Success Indicators

1. **No more "No listeners found" errors** in logs
2. **Dashboard badges update** when app is on dashboard
3. **In-app toast notifications** appear
4. **Messages load instantly** from SQLite
5. **Unread separator** shows correctly

---

## 🐛 Common Issues

### Issue: Still seeing "No listeners found"
**Solution**: 
- Make sure you rebuilt: `npm run build`
- Make sure you synced: `npx cap sync`
- Reinstall the app

### Issue: Toast notification not showing
**Solution**:
- Check if you're in the active chat (toast only shows when NOT in active chat)
- Check logs for "Show in-app notification if not in active chat"

### Issue: Unread badge not updating
**Solution**:
- Check logs for "[unread] Triggered callbacks"
- Check if SQLite is ready: look for "SQLite initialized successfully"

### Issue: Messages still loading slowly
**Solution**:
- Check if messages are being stored: look for "[bg-sync] ✅ Message stored"
- Check SQLite logs: "Loading messages from SQLite"

---

## 📝 What Changed

### Files Modified:
1. `src/lib/push.ts` - Added FCM notification listeners
2. `src/lib/backgroundMessageSync.ts` - Returns success/failure, triggers callbacks
3. `src/lib/unreadTracker.ts` - Added triggerCallbacks() method

### Architecture Change:
**Old**: Dashboard → Realtime Subscription → Supabase → Update UI  
**New**: FCM → SQLite → Update UI (instant!)

---

## ✅ Final Checklist

Before reporting success:
- [ ] Test 1 passed: Dashboard badges update in real-time
- [ ] Test 1 passed: In-app toast notification shown
- [ ] Test 2 passed: Messages load instantly (<100ms)
- [ ] Test 2 passed: Unread separator visible
- [ ] Test 3 passed: Notification tap works correctly
- [ ] No "No listeners found" errors in logs
- [ ] Build completed successfully

---

## 🎉 Success!

If all tests pass, the fix is working correctly! The app now:
- ✅ Updates dashboard badges in real-time via FCM
- ✅ Shows in-app notifications when on dashboard
- ✅ Loads messages instantly from SQLite
- ✅ Shows unread separator correctly
- ✅ Works like WhatsApp!

**No longer dependent on realtime subscription for dashboard updates!** 🚀

