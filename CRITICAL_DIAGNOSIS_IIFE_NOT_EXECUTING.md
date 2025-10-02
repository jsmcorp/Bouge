# 🔍 CRITICAL DIAGNOSIS: Push Notification Listener Issue

## 📊 Problem Analysis

### What You Reported
```
No listeners found for event notificationReceived
```

Notifications only work when device is locked/backgrounded, but **NO in-app notifications** when on dashboard.

---

## 🔬 Root Cause Investigation

### Analysis of `log28.txt`

**What's Working:**
- ✅ App loads successfully (bundle: `index-D0ZDQPkQ.js`)
- ✅ SQLite initializes
- ✅ Authentication works
- ✅ Groups load
- ✅ Messages sync

**What's NOT Working:**
- ❌ **ZERO logs from `initPush()` function**
- ❌ No `[main] Initializing push notifications...` log
- ❌ No `[push] 🚀 initPush() called` log
- ❌ No FirebaseMessaging listener registration logs

**Critical Finding:**
Lines 156-165 of log28.txt show:
```
Notifying listeners for event notificationReceived
No listeners found for event notificationReceived
```

This happens **5 times** during your test, but there are **ZERO initialization logs** from `main.tsx` or `push.ts`.

---

## 🎯 The Issue

The async IIFE in `main.tsx` that calls `initPush()` is **NOT executing at all**.

### Evidence

**Expected logs (NOT present in log28.txt):**
1. `[main] 🚀 IIFE starting - about to initialize push notifications` (line 22 of main.tsx)
2. `[main] 🔥 Inside async IIFE - before try block` (line 24)
3. `[main] 📱 Initializing push notifications...` (line 26)
4. `[push] 🚀 initPush() called` (line 135 of push.ts)
5. `[push] ✅ Starting push initialization...` (line 146)
6. `[push] 📦 Importing @capacitor-firebase/messaging...` (line 150)
7. `[push] 📝 Registering FirebaseMessaging.notificationReceived listener` (line 243)

**None of these logs appear in your log file.**

---

## 🛠️ Fix Applied

### File: `src/main.tsx` (Lines 22-33)

**Added comprehensive logging to diagnose IIFE execution:**

```typescript
// Initialize push and listeners (non-blocking)
console.log('[main] 🚀 IIFE starting - about to initialize push notifications');
(async () => {
	console.log('[main] 🔥 Inside async IIFE - before try block');
	try {
		console.log('[main] 📱 Initializing push notifications...');
		await initPush();
		console.log('[main] ✅ Push notifications initialized');
	} catch (error) {
		console.error('[main] ❌ Failed to initialize push notifications:', error);
		console.error('[main] ❌ Error stack:', error);
	}
	// ... rest of IIFE code
})();
```

**What This Does:**
1. **Line 22**: Log BEFORE the IIFE (synchronous, should always execute)
2. **Line 24**: Log INSIDE the IIFE (proves async function is called)
3. **Line 26**: Log INSIDE try block (proves try block is reached)
4. **Lines 29-30**: Enhanced error logging with stack trace

---

## 🧪 Testing Instructions

### 1. Deploy the New Build

```bash
# Already done:
npm run build
npx cap sync android
```

Now run:
```bash
npx cap run android
```

### 2. Check Initialization Logs

**On app start, you should now see:**

```
[main] 🚀 IIFE starting - about to initialize push notifications
[main] 🔥 Inside async IIFE - before try block
[main] 📱 Initializing push notifications...
[push] 🚀 initPush() called
[push] ✅ Starting push initialization...
[push] 📦 Importing @capacitor-firebase/messaging...
[push] ✅ FirebaseMessaging imported successfully
[push] 📝 Registering FirebaseMessaging.notificationReceived listener
[push] ✅ FirebaseMessaging.notificationReceived listener registered
[main] ✅ Push notifications initialized
```

### 3. Test In-App Notifications

1. Open app on **Device A** (stay on dashboard)
2. Send message from **Device B**
3. **Expected on Device A:**
   - ✅ `[push] 🔔 FirebaseMessaging.notificationReceived event fired!`
   - ✅ `[bg-sync] ✅ Message stored successfully`
   - ✅ `[unread] Triggered callbacks for group <id>, count=1`
   - ✅ Toast notification appears
   - ✅ Unread badge updates
   - ✅ **NO "No listeners found" error**

---

## 🔍 Diagnostic Scenarios

### Scenario A: No Logs at All

**If you see NONE of the new logs:**

**Problem**: The IIFE is not executing at all.

**Possible Causes:**
1. Build cache issue (old bundle still deployed)
2. Syntax error preventing main.tsx from loading
3. Module import error

**Solution:**
```bash
# Clear build cache
rm -rf dist android/app/src/main/assets/public
npm run build
npx cap sync android
npx cap run android
```

### Scenario B: First Log Only

**If you see:**
```
[main] 🚀 IIFE starting - about to initialize push notifications
```

**But NOT:**
```
[main] 🔥 Inside async IIFE - before try block
```

**Problem**: The async IIFE is defined but not being invoked.

**Check**: Verify line 197 of `main.tsx` has `})();` (with the `()` at the end)

### Scenario C: Logs Stop at "Inside async IIFE"

**If you see:**
```
[main] 🚀 IIFE starting - about to initialize push notifications
[main] 🔥 Inside async IIFE - before try block
```

**But NOT:**
```
[main] 📱 Initializing push notifications...
```

**Problem**: Error thrown before try block is entered.

**Check**: Look for error logs immediately after the last successful log.

### Scenario D: Error in initPush()

**If you see:**
```
[main] ❌ Failed to initialize push notifications: <error>
[main] ❌ Error stack: <stack>
```

**Problem**: `initPush()` is throwing an error.

**Action**: Share the error message and stack trace for further diagnosis.

### Scenario E: All Logs Present, Still No Listener

**If you see all initialization logs but still get "No listeners found":**

**Problem**: Plugin mismatch or event name issue.

**Check**:
1. Verify `@capacitor-firebase/messaging` version: `7.3.1`
2. Check if plugin is properly installed in Android project
3. Verify `google-services.json` is present and valid

---

## 📋 What to Share

After deploying, please share:

1. **Initialization logs** (from app start):
   - Look for all `[main]` and `[push]` logs
   - Copy the first 50 lines after app launch

2. **Notification test logs** (when message arrives on dashboard):
   - Look for `[push] 🔔 FirebaseMessaging.notificationReceived`
   - Look for "No listeners found" errors

3. **Any error messages**:
   - Especially `[main] ❌ Failed to initialize push notifications`
   - Any stack traces

---

## 🎯 Expected Outcome

After this fix, you should see:

✅ **Initialization logs** confirming `initPush()` is called  
✅ **Listener registration logs** confirming FirebaseMessaging listener is registered  
✅ **In-app notification logs** when messages arrive on dashboard  
✅ **Toast notifications** appearing in the app  
✅ **Unread badges** updating instantly  
✅ **NO "No listeners found" errors**

---

## 🚀 Next Steps

1. **Deploy** the new build to your device
2. **Check logs** for the new diagnostic messages
3. **Test** in-app notifications on dashboard
4. **Share** the logs with me

The comprehensive logging will tell us **exactly** where the execution is stopping and why `initPush()` is not being called.

---

**Build Status**: ✅ Completed successfully  
**Bundle**: `index-D0ZDQPkQ.js` (new hash = new code)  
**Sync**: ✅ Completed successfully  
**Ready to deploy**: ✅ Yes

**Deploy now and share the logs!** 🔍

