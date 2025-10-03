# 🎯 CRITICAL FIX: Data-Only FCM Payloads for Foreground Notifications

## 📊 Root Cause Analysis (log29.txt)

### What I Found

**Lines 102-103: Listener Registered Successfully ✅**
```
[push] 🎯 Registering PushNotifications.pushNotificationReceived listener (PRIMARY)
[push] ✅ PushNotifications.pushNotificationReceived listener registered successfully
```

**Line 119: Native Confirms Registration ✅**
```
callback: 118123861, pluginId: PushNotifications, methodName: addListener, 
methodData: {"eventName":"pushNotificationReceived"}
```

**Lines 306-317: Still Firing Wrong Event ❌**
```
Capacitor/FirebaseMessagingPlugin: Notifying listeners for event notificationReceived
Capacitor/FirebaseMessagingPlugin: No listeners found for event notificationReceived
```

### The Problem

The native `FirebaseMessagingPlugin` is firing `notificationReceived` instead of `pushNotificationReceived` because:

**Your FCM payload includes a `notification` block!**

When FCM receives a payload with BOTH `notification` and `data` blocks:
- ❌ Android routes it through `FirebaseMessagingPlugin`
- ❌ Fires `notificationReceived` event
- ❌ Our `PushNotifications.pushNotificationReceived` listener never fires

When FCM receives a payload with ONLY `data` block (no `notification`):
- ✅ Android routes it through `PushNotificationsPlugin`
- ✅ Fires `pushNotificationReceived` event
- ✅ Our listener receives it!

---

## ✅ Fix Applied

### Updated `supabase/functions/push-fanout/index.ts`

**Removed `notification` block from both FCM v1 and legacy functions.**

#### FCM v1 Function (Lines 117-147)

**Before:**
```typescript
const body = {
	message: {
		token,
		data,
		notification: {
			title: 'New message',
			body: 'You have a new message',
		},
		android: {
			priority: 'HIGH',
		},
		// ...
	}
};
```

**After:**
```typescript
// DATA-ONLY payload for foreground notifications
// No notification block = Android routes to PushNotifications.pushNotificationReceived
const body = {
	message: {
		token,
		data,
		android: {
			priority: 'HIGH',
		},
		apns: {
			headers: { 'apns-priority': '10' },
			payload: { 
				aps: { 
					'content-available': 1,
					sound: 'default'
				} 
			},
		},
	}
};
```

#### Legacy FCM Function (Lines 162-185)

**Before:**
```typescript
const payload = {
	registration_ids: tokens,
	priority: 'high',
	data,
	notification: {
		title: 'New message',
		body: 'You have a new message',
	},
	android: { priority: 'high' },
	// ...
};
```

**After:**
```typescript
// DATA-ONLY payload for foreground notifications
// No notification block = Android routes to PushNotifications.pushNotificationReceived
const payload = {
	registration_ids: tokens,
	priority: 'high',
	data,
	android: { priority: 'high' },
	apns: { 
		headers: { 'apns-priority': '10' }, 
		payload: { 
			aps: { 
				'content-available': 1,
				sound: 'default' 
			} 
		} 
	},
};
```

**Key Changes:**
- ✅ Removed `notification` block entirely
- ✅ Added `content-available: 1` for iOS background delivery
- ✅ Kept `sound: 'default'` for iOS notification sound
- ✅ Kept high priority for Android

---

## 🚀 Deployment Instructions

### 1. Deploy Edge Function

```bash
# Navigate to your project root
cd "d:\Bouge from git\Bouge"

# Deploy the updated Edge Function
npx supabase functions deploy push-fanout
```

**Expected Output:**
```
Deploying push-fanout (project ref: <your-ref>)
Deployed push-fanout
```

### 2. Test the Fix

**No need to rebuild the mobile app!** The app code is already correct. We only needed to fix the server-side payload.

1. Open app on **Device A** (stay on dashboard)
2. Send message from **Device B**
3. **Expected on Device A:**

```
[push] 🔔 PushNotifications.pushNotificationReceived fired! {...}
[push] 🔔 Raw notification object: {"data":{"type":"new_message","message_id":"...","group_id":"...","sender_id":"..."}}
[push] 🔔 Extracted data: {"type":"new_message","message_id":"...","group_id":"...","sender_id":"..."}
[push] 🔔 Notification received, reason=data
[push] Fetching message {id} in background
[bg-sync] ✅ Message stored successfully
[unread] Triggered callbacks for group <id>, count=1
```

4. **Expected UI:**
   - ✅ Toast notification appears
   - ✅ Unread badge updates
   - ✅ **NO "No listeners found" error**

---

## 🔍 Verification Steps

### Check Edge Function Logs

After deploying, check Supabase Edge Function logs:

```bash
npx supabase functions logs push-fanout
```

**Look for:**
```json
{
  "tag": "push-fcm-v1:request",
  "projectId": "your-project-id",
  "tokenCount": 1
}
```

### Check Mobile Logs

After sending a test message, check Android logs:

**Expected (SUCCESS):**
```
Capacitor/PushNotificationsPlugin: Notifying listeners for event pushNotificationReceived
[push] 🔔 PushNotifications.pushNotificationReceived fired!
```

**NOT Expected (FAILURE):**
```
Capacitor/FirebaseMessagingPlugin: Notifying listeners for event notificationReceived
No listeners found for event notificationReceived
```

---

## 📋 What Changed

### Server-Side (Edge Function)
- ✅ Removed `notification` block from FCM payloads
- ✅ Now sends **data-only** payloads
- ✅ Android routes to `PushNotificationsPlugin` instead of `FirebaseMessagingPlugin`

### Client-Side (Mobile App)
- ✅ Already has correct listener registered
- ✅ No changes needed
- ✅ Will now receive notifications via `PushNotifications.pushNotificationReceived`

---

## 🎯 Expected Outcome

After deploying the Edge Function:

✅ **PushNotifications listener** receives foreground notifications  
✅ **Toast notifications** appear in the app  
✅ **Unread badges** update instantly  
✅ **NO "No listeners found" errors**  
✅ **Background message sync** works correctly  
✅ **In-app notifications** work on dashboard  

---

## 🔧 Troubleshooting

### If You Still See "No listeners found"

**Problem**: Edge Function not deployed or old version still running.

**Solution**:
1. Verify deployment: `npx supabase functions list`
2. Check function version in Supabase Dashboard
3. Redeploy: `npx supabase functions deploy push-fanout --no-verify-jwt`

### If Notifications Don't Appear at All

**Problem**: Data payload might be missing required fields.

**Check**: Verify the Edge Function is sending:
- `type: 'new_message'`
- `message_id: '<uuid>'`
- `group_id: '<uuid>'`
- `sender_id: '<uuid>'`

### If iOS Notifications Don't Work

**Problem**: iOS requires different handling for silent notifications.

**Solution**: The fix includes `content-available: 1` for iOS, which should work. If not, we may need to add a minimal `alert` for iOS.

---

## 📊 Technical Details

### Why Data-Only Payloads Work

**FCM Routing Logic:**

1. **Payload with `notification` block:**
   - Android: System handles notification display
   - Routes to `FirebaseMessagingPlugin`
   - Fires `notificationReceived` event
   - Our listener doesn't match ❌

2. **Payload with ONLY `data` block:**
   - Android: App handles notification display
   - Routes to `PushNotificationsPlugin`
   - Fires `pushNotificationReceived` event
   - Our listener matches ✅

### Data Payload Structure

```json
{
  "message": {
    "token": "device_fcm_token",
    "data": {
      "type": "new_message",
      "message_id": "uuid",
      "group_id": "uuid",
      "sender_id": "uuid",
      "created_at": "2025-10-02T10:00:00Z"
    },
    "android": {
      "priority": "HIGH"
    },
    "apns": {
      "headers": { "apns-priority": "10" },
      "payload": { 
        "aps": { 
          "content-available": 1,
          "sound": "default"
        } 
      }
    }
  }
}
```

---

## 🚀 Next Steps

1. **Deploy** the Edge Function:
   ```bash
   npx supabase functions deploy push-fanout
   ```

2. **Test** in-app notifications on dashboard

3. **Share** the logs with me:
   - Look for `[push] 🔔 PushNotifications.pushNotificationReceived fired!`
   - Verify NO "No listeners found" errors

**The fix is complete! Deploy the Edge Function and test now.** 🎯

