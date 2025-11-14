# Testing Instant Background Delivery

## Prerequisites
- Two Android devices (Device A and Device B)
- Both devices logged into the app
- Both devices in the same group
- ADB connected to Device A for log viewing

## Test 1: Background Delivery (Primary Test)

**Goal**: Verify message is stored in SQLite while app is backgrounded

### Steps:
1. **Device A**: Open the app and navigate to a group chat
2. **Device A**: Press home button to background the app (don't kill it)
3. **Device B**: Send a message to the same group
4. **Device A**: Check ADB logs immediately (don't open app yet)

### Expected Logs (Device A):
```
[push] 🔔 Notification received, reason=data
[push] ⚡ FAST PATH: FCM payload contains full message, writing directly to SQLite
[push] ✅ Message <id> stored in SQLite in 67ms (fast path)
[push] 📢 Local notification shown
[push] 🏁 Fast path complete in 112ms
```

### Expected Behavior:
- ✅ Local notification appears on Device A
- ✅ Notification shows message preview
- ✅ Total time < 150ms

5. **Device A**: Tap the local notification
6. **Device A**: App opens to the group chat

### Expected:
- ✅ Message is already visible (loaded from SQLite)
- ✅ No loading spinner
- ✅ No delay

---

## Test 2: Foreground Delivery

**Goal**: Verify fast-path works when app is open

### Steps:
1. **Device A**: Open the app and stay in the group chat
2. **Device B**: Send a message
3. **Device A**: Watch the chat screen

### Expected Logs (Device A):
```
[push] 🔔 Notification received, reason=data
[push] ⚡ FAST PATH: FCM payload contains full message, writing directly to SQLite
[push] ✅ Message <id> stored in SQLite in 67ms (fast path)
[push] ✅ UI updated from SQLite in 45ms
[push] 📍 Auto-scrolled to bottom
[push] 🏁 Fast path complete in 112ms
```

### Expected Behavior:
- ✅ Message appears instantly (<150ms)
- ✅ Auto-scrolls to show new message
- ✅ No local notification (already in chat)

---

## Test 3: Multiple Background Messages

**Goal**: Verify multiple messages are all stored while backgrounded

### Steps:
1. **Device A**: Background the app
2. **Device B**: Send 3 messages quickly (within 5 seconds)
3. **Device A**: Check ADB logs

### Expected Logs (Device A):
```
[push] 🔔 Notification received, reason=data (message 1)
[push] ⚡ FAST PATH: FCM payload contains full message, writing directly to SQLite
[push] ✅ Message <id1> stored in SQLite in 67ms (fast path)
[push] 📢 Local notification shown
[push] 🏁 Fast path complete in 112ms

[push] 🔔 Notification received, reason=data (message 2)
[push] ⚡ FAST PATH: FCM payload contains full message, writing directly to SQLite
[push] ✅ Message <id2> stored in SQLite in 71ms (fast path)
[push] 📢 Local notification shown
[push] 🏁 Fast path complete in 118ms

[push] 🔔 Notification received, reason=data (message 3)
[push] ⚡ FAST PATH: FCM payload contains full message, writing directly to SQLite
[push] ✅ Message <id3> stored in SQLite in 69ms (fast path)
[push] 📢 Local notification shown
[push] 🏁 Fast path complete in 115ms
```

4. **Device A**: Open the app

### Expected:
- ✅ All 3 messages are visible
- ✅ Messages are in correct order
- ✅ No duplicates

---

## Test 4: Cross-Group Notification

**Goal**: Verify local notification appears for non-active group

### Steps:
1. **Device A**: Open the app and stay in Group 1
2. **Device B**: Send a message to Group 2 (different group)
3. **Device A**: Watch for notification

### Expected:
- ✅ Local notification appears
- ✅ Notification shows "New message"
- ✅ Message preview visible
- ✅ Tapping notification navigates to Group 2
- ✅ Message is already visible in Group 2

---

## Test 5: Killed App (Cold Start)

**Goal**: Verify background delivery works even when app is killed

### Steps:
1. **Device A**: Kill the app (swipe away from recent apps)
2. **Device B**: Send a message
3. **Device A**: Wait 5 seconds, check for notification
4. **Device A**: Open the app

### Expected:
- ✅ Local notification appears (may take 5-10 seconds)
- ✅ Message is visible when app opens
- ✅ No empty state or loading

---

## Test 6: Fallback to REST Fetch

**Goal**: Verify fallback works if fast-path fails

### Steps:
1. Temporarily modify server to send incomplete FCM payload (remove `content` field)
2. **Device A**: Background the app
3. **Device B**: Send a message
4. **Device A**: Check logs

### Expected Logs:
```
[push] 🔔 Notification received, reason=data
[push] 📥 Starting direct REST fetch for message <id>
[bg-sync] ✅ Message <id> stored successfully in 234ms
[push] 🏁 Push-first fast path complete in 301ms
```

### Expected:
- ✅ Message still appears (via REST fetch)
- ✅ Takes longer (~300ms vs ~100ms)
- ✅ Local notification still shown

---

## Test 7: Long Message

**Goal**: Verify long messages work (test FCM 4KB limit)

### Steps:
1. **Device A**: Background the app
2. **Device B**: Send a very long message (2000+ characters)
3. **Device A**: Check logs and notification

### Expected:
- ✅ Message stored successfully
- ✅ Local notification shows truncated preview (first 100 chars)
- ✅ Full message visible when opening app

---

## Test 8: Image Message

**Goal**: Verify image messages work with fast-path

### Steps:
1. **Device A**: Background the app
2. **Device B**: Send an image message
3. **Device A**: Check logs

### Expected:
- ✅ Message stored with `image_url`
- ✅ Local notification shows "New message"
- ✅ Image visible when opening app

---

## ADB Log Commands

### View real-time logs:
```bash
adb logcat | grep -E "\[push\]|\[bg-sync\]"
```

### View logs with timestamps:
```bash
adb logcat -v time | grep -E "\[push\]|\[bg-sync\]"
```

### Clear logs before test:
```bash
adb logcat -c
```

### Save logs to file:
```bash
adb logcat | grep -E "\[push\]|\[bg-sync\]" > test_logs.txt
```

---

## Success Criteria

### Fast-Path Success:
- ✅ Logs show "FAST PATH: FCM payload contains full message"
- ✅ Storage time < 150ms
- ✅ Total time < 200ms
- ✅ Local notification appears
- ✅ Message visible immediately when opening app

### Fallback Success:
- ✅ Logs show "Starting direct REST fetch"
- ✅ Storage time 200-400ms
- ✅ Message still appears correctly

### Overall Success:
- ✅ No "notificationReceived listener not firing" errors
- ✅ No "SQLite not ready" errors
- ✅ No duplicate messages
- ✅ Messages appear in correct order
- ✅ Unread counts update correctly

---

## Troubleshooting

### If no logs appear:
1. Check FCM token is registered: Look for `[push] token received(firebase)`
2. Check edge function logs in Supabase dashboard
3. Verify device has internet connection
4. Check notification permissions are granted

### If "SQLite not ready" appears:
1. Wait 5 seconds after app start
2. Check SQLite initialization logs
3. Restart app and try again

### If fallback always triggers:
1. Check edge function logs for message fetch errors
2. Verify message exists in database
3. Check FCM payload in edge function logs

### If local notification doesn't appear:
1. Check notification permissions: `adb shell dumpsys notification_listener`
2. Verify LocalNotifications plugin is installed
3. Check for errors in notification scheduling

---

## Performance Benchmarks

| Scenario | Target | Acceptable |
|----------|--------|------------|
| Fast-path storage | <100ms | <150ms |
| Fast-path total | <150ms | <200ms |
| Fallback storage | <300ms | <500ms |
| Background wake | <200ms | <500ms |
| UI refresh | <50ms | <100ms |

---

## Next Steps After Testing

1. ✅ Verify all tests pass
2. ✅ Check performance meets targets
3. ✅ Monitor edge function logs for errors
4. ✅ Test on multiple Android versions
5. ✅ Test with poor network conditions
6. ✅ Test with battery saver enabled
7. ✅ Monitor for any crashes or ANRs

---

**Status**: Ready for testing
**Priority**: High - Core feature for background message delivery
**Risk**: Low - Fallback to REST fetch ensures reliability
