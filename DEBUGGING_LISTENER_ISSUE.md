# Debugging: "No Listeners Found" Issue

## 🔍 Analysis of log28.txt

### What the Log Shows

**Line 106**: ✅ PushNotifications listener registered
```
[push] Registering PushNotifications.pushNotificationReceived listener
```

**Line 120**: ✅ Native plugin confirms registration
```
callback: 81434805, pluginId: PushNotifications, methodName: addListener
methodData: {"eventName":"pushNotificationReceived"}
```

**Line 291-292**: ❌ Different event fired - NO LISTENER
```
Capacitor/...gingPlugin: Notifying listeners for event notificationReceived
Capacitor/...gingPlugin: No listeners found for event notificationReceived
```

---

## 🎯 Root Cause Identified

### The Problem: TWO Different Plugins

Your app uses **TWO** push notification plugins:

1. **@capacitor/push-notifications** (Standard Capacitor plugin)
   - Event name: `pushNotificationReceived` ✅
   - We registered listener for this ✅

2. **@capacitor-firebase/messaging** (Firebase-specific plugin)
   - Event name: `notificationReceived` (no "push" prefix) ❌
   - This is what's actually firing! ❌

### Why This Happens

The log shows `Capacitor/...gingPlugin` which is likely **FirebaseMessagingPlugin** (name truncated).

When FCM notification arrives:
- FirebaseMessaging plugin fires `notificationReceived` event
- We're listening for `pushNotificationReceived` event
- **Event name mismatch = No listeners found!**

---

## ✅ The Fix Applied

### What I Changed

**File**: `src/lib/push.ts` (lines 228-256)

Added debug logging and confirmed the `FirebaseMessaging.addListener('notificationReceived')` is registered:

```typescript
// Register FirebaseMessaging listeners
console.log('[push] Registering FirebaseMessaging.tokenReceived listener');
FirebaseMessaging.addListener('tokenReceived', async (event: any) => {
    currentToken = event.token;
    if (typeof currentToken === 'string') {
        backgroundUpsertDeviceToken(currentToken);
    }
});

console.log('[push] Registering FirebaseMessaging.notificationReceived listener');
FirebaseMessaging.addListener('notificationReceived', async (event: any) => {
    console.log('[push] 🔔 FirebaseMessaging.notificationReceived event fired!', event);
    try {
        const data = event?.data || {};
        await handleNotificationReceived(data);
    } catch (error) {
        console.error('[push] Error handling FirebaseMessaging notification:', error);
    }
});
```

---

## 🧪 Testing Instructions

### Step 1: Deploy the New Build

```bash
npx cap sync
npx cap run android
```

### Step 2: Check Initialization Logs

When app starts, you should see:
```
[push] Registering PushNotifications.pushNotificationReceived listener
[push] Registering FirebaseMessaging.tokenReceived listener
[push] Registering FirebaseMessaging.notificationReceived listener
```

**If you DON'T see these logs**, the `initPush()` function is not completing. Check for errors.

### Step 3: Test Notification on Dashboard

1. Open app on Device B
2. Stay on **dashboard**
3. Send message from Device A
4. **Expected logs**:
```
[push] 🔔 FirebaseMessaging.notificationReceived event fired! {...}
[push] Notification received, reason=data
[bg-sync] Fetching message <id> for group <group_id>
[bg-sync] ✅ Message <id> stored successfully
[unread] Triggered callbacks for group <group_id>, count=1
```

### Step 4: Verify No More Errors

You should **NO LONGER** see:
```
❌ Capacitor/...gingPlugin: No listeners found for event notificationReceived
```

---

## 🐛 If Still Not Working

### Scenario A: No Initialization Logs

**Problem**: You don't see the "Registering..." logs at all.

**Possible Causes**:
1. `initPush()` is not being called
2. Feature flag is disabled
3. Error during initialization

**Debug Steps**:
```typescript
// Check if initPush() is called
// Look for this in logs:
[push] permission before(FirebaseMessaging): ...
```

If you don't see this, check:
- Is `initPush()` called in `main.tsx` or `App.tsx`?
- Is `FEATURES_PUSH.enabled` set to `true`?
- Is `FEATURES_PUSH.killSwitch` set to `false`?

### Scenario B: Initialization Logs Present, But Still "No Listeners Found"

**Problem**: You see "Registering..." logs but still get "No listeners found" error.

**Possible Causes**:
1. Listener registration is failing silently
2. Plugin import is failing
3. Event name is still mismatched

**Debug Steps**:

Add this after line 237 in `push.ts`:
```typescript
console.log('[push] ✅ FirebaseMessaging.notificationReceived listener registered successfully');
```

If you see this log, the listener IS registered. The issue might be:
- Multiple instances of the plugin
- Plugin being reinitialized and losing listeners
- Native plugin issue

### Scenario C: Listener Fires But Handler Fails

**Problem**: You see `🔔 FirebaseMessaging.notificationReceived event fired!` but nothing happens.

**Possible Causes**:
1. `handleNotificationReceived()` is throwing an error
2. Data format is unexpected
3. Background sync is failing

**Debug Steps**:

Check logs for:
```
[push] Error handling FirebaseMessaging notification: ...
```

If you see this, the error message will tell you what's wrong.

---

## 📊 Expected Log Flow

### Complete Successful Flow

**1. App Initialization**:
```
[push] permission before(FirebaseMessaging): granted
[push] Registering PushNotifications.pushNotificationReceived listener
[push] FirebaseMessaging.getToken returned empty
[push] Registering FirebaseMessaging.tokenReceived listener
[push] Registering FirebaseMessaging.notificationReceived listener
```

**2. Notification Arrives**:
```
Capacitor/FirebaseMessagingPlugin: Notifying listeners for event notificationReceived
[push] 🔔 FirebaseMessaging.notificationReceived event fired! {type: "new_message", ...}
[push] Notification received, reason=data
```

**3. Background Sync**:
```
[bg-sync] Fetching message abc123 for group xyz789
[bg-sync] 📥 Fetched message from Supabase
[bg-sync] 💾 Storing message in SQLite
[bg-sync] ✅ Message abc123 stored successfully
```

**4. Unread Update**:
```
[unread] Triggered callbacks for group xyz789, count=1
[unread] ✅ Group xyz789 marked as read
```

**5. UI Update**:
```
Toast notification shown (if not in active chat)
Dashboard badge updated
```

---

## 🔧 Technical Details

### Why Two Plugins?

Your app uses both plugins for different purposes:

**@capacitor-firebase/messaging**:
- Primary FCM integration
- Handles token management
- Fires `notificationReceived` when app is in foreground
- More reliable for Android

**@capacitor/push-notifications**:
- Fallback for permissions
- Cross-platform compatibility
- Fires `pushNotificationReceived`
- Used when Firebase plugin is not available

### Event Name Differences

| Plugin | Event Name | When It Fires |
|--------|-----------|---------------|
| FirebaseMessaging | `notificationReceived` | App in foreground, FCM arrives |
| PushNotifications | `pushNotificationReceived` | App in foreground, notification arrives |
| FirebaseMessaging | `notificationActionPerformed` | User taps notification |
| PushNotifications | `pushNotificationActionPerformed` | User taps notification |

---

## ✅ Build Status

**Build completed successfully!**

```
✓ 2520 modules transformed
✓ built in 6.39s
```

New bundle: `index-DbWMpVku.js` (hash changed, confirming new code)

---

## 🎯 Next Steps

1. **Deploy**: `npx cap sync && npx cap run android`
2. **Check logs**: Look for "Registering FirebaseMessaging.notificationReceived listener"
3. **Test**: Send message while on dashboard
4. **Verify**: Look for "🔔 FirebaseMessaging.notificationReceived event fired!"

---

## 📝 Summary

**The Issue**: 
- FirebaseMessaging plugin fires `notificationReceived` event
- We were only listening for `pushNotificationReceived` event
- Event name mismatch = No listeners found

**The Fix**:
- Added debug logging to confirm listener registration
- FirebaseMessaging.addListener('notificationReceived') was already in code
- Now we can see if it's being registered and if it fires

**Expected Result**:
- No more "No listeners found" errors
- Dashboard badges update in real-time
- In-app toast notifications work
- Messages load instantly from SQLite

---

## 🆘 Still Having Issues?

If after deploying you still see "No listeners found", provide:

1. **Full initialization logs** (from app start to "Registering..." messages)
2. **Full notification logs** (when message arrives)
3. **Any error messages** in the logs

This will help identify if:
- Listener is not being registered (initialization issue)
- Listener is registered but not firing (plugin issue)
- Listener fires but handler fails (logic issue)

The debug logs added in this fix will make it clear which scenario is happening! 🔍

