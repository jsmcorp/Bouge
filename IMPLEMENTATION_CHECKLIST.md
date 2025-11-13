# Implementation Checklist - WhatsApp-Style Instant Messaging

## ✅ Completed Changes

### 1. Enhanced onWake Handler
- [x] Updated existing `onWake()` in `StateActions` with instant UI refresh
- [x] Added call to `refreshUIFromSQLite()` for active group
- [x] Added outbox processing trigger
- [x] Wired `onWake()` to push:wakeup event in `main.tsx`

### 2. Added Instant UI Refresh
- [x] Added `refreshUIFromSQLite()` method to `OfflineActions` interface
- [x] Implemented `refreshUIFromSQLite()` to load from SQLite instantly
- [x] Added auto-scroll to bottom after refresh

### 3. Optimized FCM Handler
- [x] Added realtime status check (skip FCM if realtime active)
- [x] Added fast path: direct SQLite write from FCM payload
- [x] Kept REST fetch as fallback for incomplete payloads
- [x] Updated `handleNotificationReceived()` to call `onWake()`

### 4. Updated Event Wiring
- [x] Updated push:wakeup event listener in `main.tsx`
- [x] Added error handling for missing `onWake` handler
- [x] Made `onWake()` call async with proper error handling

## 🔧 Server-Side Changes Needed (Optional)

### FCM Payload Enhancement
To enable the fast path for all messages, update the FCM payload to include:

```json
{
  "type": "new_message",
  "message_id": "uuid",
  "group_id": "uuid",
  "group_name": "Group Name",
  "message_preview": "Message preview...",
  
  // NEW: Add these fields for fast path
  "content": "Full message content",
  "user_id": "uuid",
  "created_at": "2025-11-13T23:24:41.950Z",
  "is_ghost": false,
  "message_type": "text",
  "category": null,
  "parent_id": null,
  "image_url": null
}
```

**Location:** Update your FCM cloud function that sends notifications

**Impact:** Enables <150ms instant message display (no REST fetch needed)

## 📋 Testing Steps

### Test 1: Realtime Active (Target: <50ms)
1. Open chat on Device A
2. Keep app in foreground
3. Send message from Device B
4. **Expected:** Message appears instantly via realtime (no FCM processing)

### Test 2: Realtime Dead + Full FCM Payload (Target: <150ms)
1. Open chat on Device A
2. Lock screen or background app for 5+ minutes (realtime dies)
3. Send message from Device B
4. Unlock screen and open chat
5. **Expected:** Message already visible (written to SQLite from FCM)

### Test 3: Realtime Dead + Partial FCM Payload (Target: 500-1000ms)
1. Same as Test 2, but with incomplete FCM payload
2. **Expected:** Message appears after REST fetch (slower but still works)

### Test 4: No Duplicates
1. Send message while realtime is active
2. **Expected:** Message appears once (not duplicated by FCM)

### Test 5: Correct Order
1. Send multiple messages quickly
2. **Expected:** Messages appear in chronological order

### Test 6: Large Chats (>50 messages)
1. Open chat with >50 messages
2. Send new message from another device
3. **Expected:** New message appears, old messages remain visible

### Test 7: Outbox Processing
1. Send message while offline
2. Go online
3. **Expected:** Message sends automatically via outbox

## 🐛 Debugging

### Check Realtime Status
```javascript
// In browser console
useChatStore.getState().connectionStatus
// Should be: 'connected', 'connecting', or 'disconnected'
```

### Check onWake Handler
```javascript
// In browser console
typeof useChatStore.getState().onWake
// Should be: 'function'
```

### Check FCM Payload
```javascript
// Look for this log when notification arrives
[push] 🔔 Notification received, reason=data, data: {...}
```

### Check Fast Path
```javascript
// Look for this log if fast path is used
[push] ⚡ FAST PATH: FCM payload contains full message, writing directly to SQLite
```

### Check Realtime Skip
```javascript
// Look for this log if realtime is active
[push] ⚡ Realtime is connected - skipping FCM processing
```

## 📊 Performance Monitoring

Add these logs to track performance:

```javascript
// In handleNotificationReceived()
const startTime = Date.now();
// ... processing ...
console.log(`[push] ⏱️ Total time: ${Date.now() - startTime}ms`);
```

**Target Metrics:**
- Realtime active: <50ms
- Fast path (SQLite): <150ms
- REST fetch fallback: 500-1000ms

## 🚨 Known Issues & Workarounds

### Issue 1: onWake not defined
**Symptom:** `onWake is not a function` error in console

**Fix:** Ensure `offlineActions` is included in chatStore:
```typescript
// In src/store/chatstore_refactored/index.ts
const offlineActions = createOfflineActions(set, get);
return {
  // ...
  ...offlineActions,
};
```

### Issue 2: SQLite not ready
**Symptom:** Messages don't appear instantly

**Fix:** Check SQLite initialization:
```javascript
// In browser console
await sqliteService.isReady()
// Should return: true
```

### Issue 3: Realtime not reconnecting
**Symptom:** Messages only arrive via FCM (slow)

**Fix:** Check realtime subscription:
```javascript
// In browser console
useChatStore.getState().realtimeChannel
// Should not be: null
```

## ✅ Acceptance Criteria

- [x] Code changes implemented
- [ ] Server-side FCM payload updated (optional)
- [ ] All 7 tests pass
- [ ] Performance metrics meet targets
- [ ] No TypeScript errors
- [ ] No console errors in production

## 🎯 Success Criteria

**Primary Goal:** Messages appear instantly (<150ms) when returning from background

**Measured By:**
1. User perception: "Message is already there when I open the chat"
2. Logs show: `[push] ⚡ FAST PATH` or `[push] ⚡ Realtime is connected`
3. No REST fetch timeouts in logs
4. No duplicate messages
5. Correct chronological order

## 📝 Notes

- The fix is backward compatible (works with existing FCM payloads)
- Fast path is optional (requires server-side changes)
- REST fetch fallback ensures reliability
- No breaking changes to existing code
- All changes are localized to 3 files
