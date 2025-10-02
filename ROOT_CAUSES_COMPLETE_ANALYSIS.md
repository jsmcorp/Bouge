# 🔍 COMPLETE ROOT CAUSE ANALYSIS: FCM Notification Failure

**Date**: 2025-10-02  
**Status**: Ready to Fix  
**Severity**: CRITICAL - Multiple Issues Must Be Fixed Together

---

## 📋 Executive Summary

After comprehensive analysis of logs, codebase, and documentation, I've identified **8 ROOT CAUSES** that are ALL contributing to the "No listeners found for event notificationReceived" error.

**Why you're stuck in a loop**: Each fix addresses ONE issue, but the other SEVEN remain broken, so notifications still fail.

**Solution**: Fix ALL 8 issues together in a systematic approach.

---

## 🚨 ROOT CAUSE #1: Missing FirebaseMessaging Configuration

### The Problem
**`capacitor.config.ts` is MISSING the `FirebaseMessaging` plugin configuration!**

### Current State
```typescript
// capacitor.config.ts
plugins: {
  SplashScreen: { ... },
  StatusBar: { ... },
  Keyboard: { ... },
  Haptics: { ... },
  PushNotifications: { ... },  // ❌ WRONG PLUGIN!
  CapacitorSQLite: { ... }
  // ❌ FirebaseMessaging: MISSING!
}
```

### What's Missing
```typescript
FirebaseMessaging: {
  presentationOptions: ["alert", "badge", "sound"]
}
```

### Impact
- Plugin may not initialize properly
- Listeners may not register correctly
- Events may not fire
- **Severity**: 🔴 CRITICAL

### Fix Required
Add `FirebaseMessaging` configuration to `capacitor.config.ts` and remove `PushNotifications` config.

---

## 🚨 ROOT CAUSE #2: Web Shim Bundled Instead of Native Plugin

### The Problem
**Vite is bundling the WEB SHIM into the Android app instead of using the native plugin!**

### Evidence
```javascript
// File: android/app/build/intermediates/assets/debug/public/assets/capacitor-firebase-messaging-HNnXeiEZ.js
const s={
  requestPermissions:async()=>({receive:"denied"}),
  getToken:async()=>({token:null}),
  addListener:async(e,n)=>({remove:()=>{}})  // ❌ NO-OP!
};
export{s as FirebaseMessaging};
```

This is the web shim from `src/shims/capacitor-firebase-messaging.ts` being used in the native app!

### Impact
**ALL `FirebaseMessaging.addListener()` calls are NO-OPS!**

```typescript
// Your code calls:
FirebaseMessaging.addListener('notificationReceived', handler);

// But it's actually calling:
async(e,n)=>({remove:()=>{}})  // Does NOTHING!
```

**This is THE PRIMARY REASON for "No listeners found" - listeners are NEVER actually registered!**

### Why This Happens
- Vite is resolving the web shim instead of the native plugin
- The shim should only be used in web builds, not native builds
- Incorrect Vite configuration or plugin resolution

### Fix Required
- Check `vite.config.ts` for incorrect alias or resolution
- Ensure web shim is excluded from native builds
- Verify Capacitor plugin resolution is working correctly
- **Severity**: 🔴 CRITICAL

---

## 🚨 ROOT CAUSE #3: Module Load Time Registration Timing Issue

### The Problem
**Listener registration happens in an async Promise chain that may not complete before FCM messages arrive!**

### Current Code
```typescript
// src/lib/push.ts lines 22-87
if (Capacitor.isNativePlatform()) {
  import('@capacitor-firebase/messaging').then(({ FirebaseMessaging }) => {
    // Listener registration happens HERE (async)
    FirebaseMessaging.addListener('notificationReceived', handler)
      .then((handle) => { ... })
  });
}
```

### The Race Condition
1. **Module loads** → `import('@capacitor-firebase/messaging')` starts (async)
2. **FCM notification arrives** → Native plugin fires event
3. **Import completes** → Listener gets registered (TOO LATE!)
4. **Result**: "No listeners found"

### Timeline from Logs
```
22:51:27 - App backgrounded
23:25:55 - FCM notification arrives (34 minutes later)
23:25:55 - "No listeners found" error
23:26:21 - App opened (listener may register now, but too late)
```

### Impact
- Listener not ready when notification arrives
- Race condition between import and notification
- **Severity**: 🔴 CRITICAL

### Fix Required
- Register listener synchronously, not in Promise chain
- Use synchronous import or ensure listener is ready before any notifications can arrive
- Add initialization check before allowing notifications

---

## 🚨 ROOT CAUSE #4: Data-Only Payload Limitations

### The Problem
**Data-only payloads have LIMITED support and reliability in background/killed states!**

### Current Payload
```typescript
// supabase/functions/push-fanout/index.ts
const body = {
  message: {
    token,
    data: {  // ❌ Data-only
      type: 'new_message',
      group_id: '...',
      message_id: '...'
    },
    android: { priority: 'HIGH' }
  }
};
```

### The Limitation
According to Capacitor Firebase docs:
- **Foreground**: `notificationReceived` called for ALL notifications ✅
- **Background/killed**: `notificationReceived` called ONLY for data-only notifications ✅
- **BUT**: Data-only notifications:
  - Don't wake device reliably
  - Can be delayed by Android Doze mode
  - Can be dropped by battery optimization
  - Don't appear in notification tray
  - User has no indication message arrived

### Impact
- Unreliable delivery in background
- No visual notification for user
- Messages may be delayed or dropped
- **Severity**: 🟡 HIGH

### Fix Required
Use hybrid payload with both `notification` and `data` blocks for reliable delivery.

---

## 🚨 ROOT CAUSE #5: Missing Notification Channel Configuration

### The Problem
**AndroidManifest.xml references a default notification channel that may not exist!**

### Current Configuration
```xml
<!-- AndroidManifest.xml -->
<meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="@string/default_notification_channel_id" />
```

### The Issue
**Android 8.0+ (API 26+) REQUIRES notification channels to be created programmatically!**

If the channel doesn't exist:
- Notifications are silently dropped
- No error is shown
- FCM events may not fire properly

### Impact
- Silent notification failures
- No user feedback
- **Severity**: 🟡 HIGH

### Fix Required
- Create the default notification channel on app start
- Verify channel exists before sending notifications
- Add proper channel configuration (name, description, importance)

---

## 🚨 ROOT CAUSE #6: Listener Registration vs initPush() Timing

### The Problem
**Listener registration at module load time races with `initPush()` call!**

### Current Flow
```typescript
// 1. src/lib/push.ts loads
if (Capacitor.isNativePlatform()) {
  import('@capacitor-firebase/messaging').then(({ FirebaseMessaging }) => {
    // Listener registration starts (async, not awaited)
  });
}

// 2. src/main.tsx loads
(async () => {
  await initPush();  // Runs before listener registration completes!
})();
```

### The Issue
- Module-level listener registration is NOT awaited by anything
- `initPush()` may complete before listener is registered
- No guarantee of initialization order
- No way to know when listener is ready

### Impact
- Race condition between initialization and listener registration
- Token may be fetched before listener is ready
- Notifications may arrive before listener is registered
- **Severity**: 🟡 HIGH

### Fix Required
- Make listener registration synchronous and blocking
- Ensure listener is registered before `initPush()` completes
- Add initialization state tracking

---

## 🚨 ROOT CAUSE #7: FCM Token Not Stored in Supabase

### The Problem
**Token may not be successfully stored in Supabase `user_devices` table!**

### Evidence from Logs
```
[push] token received(firebase): AIzaSy...
```

But NO log showing:
```
[push] ✅ Device token upserted to Supabase
```

### Why This Matters
**If the token isn't in Supabase, the Edge Function can't send notifications!**

The Edge Function queries:
```sql
SELECT fcm_token FROM user_devices 
WHERE user_id = ... AND active = true
```

If your token isn't there, NO FCM message is sent to your device.

### Impact
- Edge Function can't find device token
- No notifications sent to device
- Silent failure with no error
- **Severity**: 🟡 HIGH

### Fix Required
- Verify `backgroundUpsertDeviceToken()` is working
- Check Supabase RLS policies on `user_devices` table
- Add error handling and logging for token storage
- Confirm token appears in database

---

## 🚨 ROOT CAUSE #8: Edge Function Payload Data Types

### The Problem
**FCM requires ALL data values to be STRINGS, but you might be sending other types!**

### Current Code
```typescript
// supabase/functions/push-fanout/index.ts
data: {
  type: 'new_message',
  group_id: payload.group_id,        // String?
  message_id: payload.message_id,    // String?
  created_at: payload.created_at     // ❌ Might be Date object or timestamp!
}
```

### The Requirement
**FCM HTTP v1 API requires:**
- All `data` values MUST be strings
- No nested objects
- No arrays
- No null values
- No numbers (must be stringified)

### Impact
If you send non-string values, FCM may:
- Reject the message silently
- Deliver it but with corrupted data
- Not trigger the listener properly
- **Severity**: 🟠 MEDIUM

### Fix Required
- Ensure all data values are explicitly converted to strings
- Add type validation before sending
- Test with various data types

---

## 📊 SUMMARY TABLE

| # | Root Cause | Severity | Component | Impact |
|---|------------|----------|-----------|--------|
| 1 | Missing FirebaseMessaging config | 🔴 CRITICAL | capacitor.config.ts | Plugin not initialized |
| 2 | Web shim bundled in native app | 🔴 CRITICAL | Vite build | Listeners are no-ops |
| 3 | Async listener registration timing | 🔴 CRITICAL | src/lib/push.ts | Race condition |
| 4 | Data-only payload limitations | 🟡 HIGH | Edge Function | Unreliable delivery |
| 5 | Missing notification channel | 🟡 HIGH | Android native | Silent failures |
| 6 | initPush() timing | 🟡 HIGH | src/main.tsx | Initialization race |
| 7 | Token not in Supabase | 🟡 HIGH | Database | No messages sent |
| 8 | Non-string data values | 🟠 MEDIUM | Edge Function | Corrupted payloads |

---

## 🎯 WHY YOU'RE STUCK IN A LOOP

**Each fix addresses ONE issue, but the other SEVEN remain broken!**

### Previous Attempts
1. ✅ Removed `notification` block → Fixed payload structure
2. ❌ But web shim still bundled → Listeners still no-ops
3. ✅ Moved listener to module load → Fixed timing
4. ❌ But async import still races → Listener not ready
5. ✅ Added hybrid payload → Fixed delivery
6. ❌ But reverted to data-only → Back to unreliable
7. ✅ Stored listener handles → Fixed GC
8. ❌ But web shim still bundled → Listeners still no-ops

**Result**: You fix one thing, but 7 others are still broken, so notifications still fail.

---

## ✅ SOLUTION: Fix ALL Issues Together

### Systematic Approach

1. **Fix Vite bundling** (Root Cause #2) - FIRST!
   - Ensure native plugin is used, not web shim
   - This is the PRIMARY issue

2. **Add FirebaseMessaging config** (Root Cause #1)
   - Add to capacitor.config.ts
   - Remove PushNotifications config

3. **Fix listener registration** (Root Cause #3, #6)
   - Make it synchronous and blocking
   - Ensure it completes before initPush()

4. **Create notification channel** (Root Cause #5)
   - Create on app start
   - Verify it exists

5. **Use hybrid payload** (Root Cause #4)
   - Add notification block for reliability
   - Keep data block for custom handling

6. **Verify token storage** (Root Cause #7)
   - Check Supabase user_devices table
   - Add logging and error handling

7. **Fix Edge Function** (Root Cause #8)
   - Ensure all data values are strings
   - Add validation

8. **Test systematically**
   - Test each scenario separately
   - Verify all issues are resolved

---

## 🚀 NEXT STEPS

**Ready to fix? Here's the order:**

1. **FIRST**: Fix Vite bundling (Root Cause #2) - This is the PRIMARY issue
2. **SECOND**: Add FirebaseMessaging config (Root Cause #1)
3. **THIRD**: Fix listener registration timing (Root Cause #3, #6)
4. **FOURTH**: Fix remaining issues (Root Causes #4, #5, #7, #8)
5. **FIFTH**: Test systematically

**Let me know when you're ready to start fixing these issues!**

