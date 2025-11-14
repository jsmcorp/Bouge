# Local Notification Logic Fix

## Requirement
Show local notifications only when:
1. Message is for a **different group** (not currently active), OR
2. App is **backgrounded/inactive**, OR
3. Device is **locked**

**Do NOT show notification** when:
- Message is for the currently active group AND app is in foreground

## Implementation

### Server-Side (`supabase/functions/push-fanout/index.ts`)
Added group name to FCM payload for notification display:

```typescript
// Fetch group name for notification
const { data: groupData } = await db
  .from('groups')
  .select('name')
  .eq('id', payload.group_id)
  .single();

if (groupData) {
  fcmData.group_name = String(groupData.name || 'Group');
}
```

### Client-Side (`src/lib/push.ts`)
Updated notification logic to check app state:

```typescript
// Check if message is for active group
const activeGroupId = useChatStore.getState().activeGroup?.id;
const isActiveGroup = activeGroupId === data.group_id;

// Check if app is in foreground
const { App } = await import('@capacitor/app');
const appState = await App.getState();
const isAppActive = appState.isActive;

// Show notification if:
// - Message is for different group, OR
// - App is backgrounded/inactive
const shouldShowNotification = !isActiveGroup || !isAppActive;

if (shouldShowNotification && Capacitor.isNativePlatform()) {
  // Show local notification with group name and message preview
  const groupName = data.group_name || 'New message';
  const preview = data.content?.substring(0, 100) || 'You have a new message';
  
  await LocalNotifications.schedule({
    notifications: [{
      title: groupName,
      body: preview,
      id: Date.now(),
      extra: { group_id: data.group_id },
      actionTypeId: 'OPEN_CHAT',
      sound: 'default'
    }]
  });
}
```

## Notification Behavior

### Scenario 1: Active Group + Foreground
- **Message arrives for Group A**
- **User is viewing Group A**
- **App is in foreground**
- **Result**: ❌ No notification (message appears directly in chat)

### Scenario 2: Different Group + Foreground
- **Message arrives for Group B**
- **User is viewing Group A**
- **App is in foreground**
- **Result**: ✅ Notification shown with group name and preview

### Scenario 3: Any Group + Backgrounded
- **Message arrives for any group**
- **App is backgrounded**
- **Result**: ✅ Notification shown with group name and preview

### Scenario 4: Any Group + Device Locked
- **Message arrives for any group**
- **Device is locked**
- **Result**: ✅ Notification shown with group name and preview

## Expected Logs

### Notification Shown:
```
[push] ⚡ FAST PATH: FCM payload contains full message
[push] ✅ Message stored in SQLite in 67ms (fast path)
[push] 📢 Showing notification (activeGroup=false, appActive=true)
[push] 📢 Local notification shown: Group Name
```

### Notification Skipped (Active Group):
```
[push] ⚡ FAST PATH: FCM payload contains full message
[push] ✅ Message stored in SQLite in 67ms (fast path)
[push] 🔕 Skipping notification (activeGroup=true, appActive=true)
```

### Notification Shown (Backgrounded):
```
[push] ⚡ FAST PATH: FCM payload contains full message
[push] ✅ Message stored in SQLite in 67ms (fast path)
[push] 📢 Showing notification (activeGroup=true, appActive=false)
[push] 📢 Local notification shown: Group Name
```

## Testing Checklist

- [ ] **Test 1**: Send message to active group while app is open
  - Expected: No notification, message appears in chat

- [ ] **Test 2**: Send message to different group while app is open
  - Expected: Notification appears with group name

- [ ] **Test 3**: Background app, send message to any group
  - Expected: Notification appears

- [ ] **Test 4**: Lock device, send message to any group
  - Expected: Notification appears when device is unlocked

- [ ] **Test 5**: Tap notification
  - Expected: App opens to the correct group

## Deployment Status

- ✅ Server-side: Group name added to FCM payload (needs deployment)
- ✅ Client-side: Notification logic updated
- ✅ Built and synced with Android

## Next Steps

1. Deploy edge function: `npx supabase functions deploy push-fanout`
2. Test all scenarios above
3. Verify notification content shows group name and message preview

---

**Status**: ✅ Implemented, ready for deployment and testing
**Date**: 2025-11-14
