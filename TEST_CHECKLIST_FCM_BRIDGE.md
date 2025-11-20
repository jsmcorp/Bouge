# FCM Bridge Fix - Test Checklist

## Issue Fixed
**Native FCM service was not notifying JavaScript layer when app was in foreground with different group active.**

## Changes Made

### ✅ Native Layer (MyFirebaseMessagingService.java)
- Added `NativeEventsPlugin.notifyNewMessage()` call for foreground + different group case
- Added logging: `✅ JS layer notified for unread increment`

### ✅ JavaScript Layer (push.ts)
- Added unread count increment in `nativeNewMessage` listener for non-active groups
- Added logging: `[push] 📬 Native event for non-active group, incrementing unread count`

## Test Steps

### 1. Build and Deploy
```bash
npm run build
npx cap sync android
npx cap run android
```

### 2. Setup Test Scenario
- **Device A:** Open app, stay on dashboard (do NOT open any chat)
- **Device B:** Send a message to a shared group

### 3. Check Native Logs (adb logcat)

**Look for these logs in sequence:**
```
✅ 🚨🚨🚨 FCM MESSAGE RECEIVED IN NATIVE SERVICE 🚨🚨🚨
✅ ✅ Valid message data: messageId=..., groupId=...
✅ ✅ Message inserted successfully
✅ 📊 State: appForeground=true, activeGroup=null, isActiveGroup=false
✅ ✅ Notification shown (app in foreground, different group)
✅ ✅ JS layer notified for unread increment  ← CRITICAL NEW LOG
```

**If you see:** `❌ Failed to notify JS layer: ...`
- **Problem:** NativeEventsPlugin not initialized
- **Solution:** Check if plugin is registered in MainActivity

### 4. Check JavaScript Logs (Chrome DevTools / React Native Debugger)

**Look for these logs in sequence:**
```
✅ [push] 🔔 Native new message event received: {groupId: "...", messageId: "..."}
✅ [push] 📬 Native event for non-active group, incrementing unread count
✅ [push] ✅ Unread count incremented for group: ...
✅ [unread] 📈 incrementUnreadCount called for: ...
✅ [unread] 04a965fb-...: 3 → 4
✅ [SidebarRow] Rendering badge for Admin: count=4
```

**If you see:** `[push] ⚠️ __incrementUnreadCount not available`
- **Problem:** Sidebar component not mounted or helpers not exposed
- **Solution:** Check if Sidebar is rendered and `useEffect` ran

### 5. Check UI

**Expected Behavior:**
- ✅ System notification appears
- ✅ Badge count increases immediately (e.g., 3 → 4)
- ✅ Badge shows on correct group row
- ✅ No app restart needed

**If badge doesn't update:**
- Check if `[SidebarRow] Rendering badge` logs appear
- Check React DevTools for state changes in Sidebar component
- Verify `unreadCounts` state in Sidebar

## Success Criteria

### ✅ All Must Pass

1. **Native logs show:** `✅ JS layer notified for unread increment`
2. **JavaScript logs show:** `[push] 🔔 Native new message event received`
3. **JavaScript logs show:** `[push] ✅ Unread count incremented for group`
4. **Unread logs show:** `[unread] 📈 incrementUnreadCount called`
5. **UI badge updates immediately** (visible count increase)
6. **No errors** in native or JavaScript logs

## Failure Scenarios

### Scenario A: Native Logs Stop at "Notification shown"
**Symptoms:**
- Native logs show notification but no "JS layer notified"
- JavaScript logs completely silent

**Possible Causes:**
- NativeEventsPlugin not initialized
- Exception thrown in `notifyNewMessage()` call

**Debug:**
- Check for `❌ Failed to notify JS layer:` in native logs
- Verify NativeEventsPlugin is registered in MainActivity
- Check if `instance` is null in NativeEventsPlugin

### Scenario B: JavaScript Logs Show "ignoring"
**Symptoms:**
- Native logs show "JS layer notified"
- JavaScript logs show `[push] ⚠️ Native event for non-active group, ignoring`
- Badge doesn't update

**Possible Causes:**
- Old version of push.ts still running
- Build didn't include latest changes

**Debug:**
- Force rebuild: `npm run build && npx cap sync android`
- Clear app data and reinstall
- Check if push.ts has the new increment code

### Scenario C: JavaScript Logs Show "__incrementUnreadCount not available"
**Symptoms:**
- Native logs OK
- JavaScript logs show event received
- Warning: `__incrementUnreadCount not available`
- Badge doesn't update

**Possible Causes:**
- Sidebar component not mounted
- `useEffect` in Sidebar didn't run
- Helpers not exposed to window object

**Debug:**
- Check if Sidebar is rendered: `console.log('Sidebar mounted')`
- Check window object: `console.log(typeof window.__incrementUnreadCount)`
- Verify Sidebar's `useEffect` ran

### Scenario D: Increment Called But Badge Doesn't Update
**Symptoms:**
- All logs appear correctly
- `[unread] 04a965fb-...: 3 → 4` shows
- Badge still shows old count

**Possible Causes:**
- React state not updating
- Badge component not re-rendering
- Wrong group ID

**Debug:**
- Check React DevTools for Sidebar state
- Verify `unreadCounts` object has correct group ID
- Check if `[SidebarRow] Rendering badge` logs appear

## Quick Debug Commands

### Check if helpers are available:
```javascript
// In browser console
console.log('updateUnreadCount:', typeof window.__updateUnreadCount);
console.log('incrementUnreadCount:', typeof window.__incrementUnreadCount);
```

### Manually test increment:
```javascript
// Manually increment for testing
if (typeof window.__incrementUnreadCount === 'function') {
  window.__incrementUnreadCount('04a965fb-b53d-41bd-9372-5f25a5c1bec9');
}
```

### Check current unread counts:
```javascript
// Check Sidebar state (if you have React DevTools)
// Look for Sidebar component → hooks → useState → unreadCounts
```

## Timeline Expectations

**Complete Flow Should Take ~220ms:**
- Native processing: ~100ms (FCM → SQLite → Notification → Bridge)
- Bridge communication: ~20ms (Native → JavaScript)
- JavaScript processing: ~50ms (Listener → Increment → State Update)
- UI update: ~50ms (State → Re-render → Badge Update)

**If it takes longer:**
- Check for slow network calls (shouldn't be any)
- Check for heavy re-renders (use React DevTools Profiler)
- Check for blocking operations in listeners

## After Successful Test

Once all logs appear and badge updates correctly:

✅ **Native-to-JavaScript bridge is working**  
✅ **Unread count increment system is working**  
✅ **UI updates in real-time**  
✅ **Ready for production use**  

The complete WhatsApp-style unread count system is now functional! 🎉

## Next Phase (After This Test Passes)

1. Test mark-as-read (open chat, verify badge goes to 0)
2. Test app restart (verify counts persist)
3. Test background FCM (app killed, message arrives)
4. Test realtime messages (WebSocket updates)

**DO NOT PROCEED TO NEXT PHASE UNTIL THIS TEST PASSES COMPLETELY.**
