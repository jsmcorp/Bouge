# Troubleshooting Guide

## Common Issues and Solutions

### 1. Auth Session Hangs (500ms-10s delays)

**Symptoms:**
- `getSession() timeout fired after 501ms`
- `CLIENT CORRUPTION DETECTED`
- App freezes on startup

**Root Cause:**
Supabase's default storage uses Capacitor Preferences, which has an async native bridge that can hang.

**Solution Applied:**
Custom synchronous localStorage adapter in `supabasePipeline.ts`:
```typescript
const customStorageAdapter = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
```

**Verification:**
- Storage operations should complete in <1ms
- Look for `[storage-adapter] ✅` logs
- `supabaseKeyCount` should be >0 after login

---

### 2. Realtime Connection Dies After Device Lock

**Symptoms:**
- `⚠️ Realtime appears DEAD (no events for 70s)`
- Messages not received while device locked
- Connection shows "CLOSED" status

**Root Cause:**
Android kills background WebSocket connections to save battery. This is expected behavior.

**Solution Applied:**
- Heartbeat mechanism detects death within 60 seconds
- Auto-recovery: session refresh + channel recreation
- Missed message fetch after reconnection

**Verification:**
- Look for `💓 Heartbeat sent` logs every 30s
- After unlock: `🔄 Forcing reconnection due to realtime death`
- Then: `✅ Realtime connected successfully`

---

### 3. FCM Notifications with Wrong Message ID

**Symptoms:**
- `invalid input syntax for type uuid`
- Direct fetch fails, fallback sync runs
- Message ID looks like `1759514618104-roncgdp66y` (optimistic ID)

**Root Cause:**
FCM fanout was using optimistic (client-generated) ID instead of server UUID.

**Solution Applied:**
Extract server ID from upsert response in `fastPathDirectUpsert()`:
```typescript
// Parse response to get server-generated message ID
if (Array.isArray(responseData) && responseData[0]?.id) {
  serverMessageId = responseData[0].id;
} else if (responseData?.id) {
  serverMessageId = responseData.id;
} else {
  // Fallback: Query by dedupe_key
  const { data } = await client.from('messages')
    .select('id').eq('dedupe_key', message.dedupe_key).single();
  serverMessageId = data?.id || message.id;
}
```

**Verification:**
- Look for `✅ Server generated new UUID: xxx`
- FCM payload should contain UUID, not timestamp-based ID

---

### 4. Token Refresh Timeout (10s delays)

**Symptoms:**
- `Token recovery timed out after 10s`
- `refreshSession timeout fired`
- Health check marks client unhealthy

**Root Cause:**
Supabase's internal `setSession()` or `refreshSession()` can hang without making network requests.

**Solution Applied:**
- All auth calls wrapped with timeout (5s default)
- Single-flight pattern prevents duplicate refreshes
- Short-circuit if token valid for 5+ minutes
- Non-blocking refresh on network reconnect

**Verification:**
- Look for `🚀 Token valid for Xs, skipping ALL refresh logic`
- Refresh should complete in <2s normally
- Timeout logs should be rare

---

### 5. Messages Not Visible After Opening Group

**Symptoms:**
- Messages saved to SQLite but not in UI
- Must navigate away and back to see messages
- `Message NOT attached to state: different group`

**Root Cause:**
When user is on dashboard (no active group), realtime messages aren't attached to UI state.

**Solution Applied:**
- Background sync updates both SQLite AND React state
- `refreshUIFromSQLite()` for instant UI refresh
- Unread tracker callbacks trigger dashboard refresh

**Verification:**
- Look for `Background: UI updated with X new messages`
- Messages should appear without navigation

---

### 6. Unread Separator Appears Incorrectly

**Symptoms:**
- Separator shows for already-read messages
- Separator reappears after closing/reopening chat
- Race condition between cache load and marking as read

**Root Cause:**
Multiple issues:
1. Stale closure in cleanup captured old messages
2. Cache load treated as new message
3. setTimeout marking cache messages as read

**Solution Applied:**
- `messagesRef` to track latest messages (no stale closure)
- `lastProcessedMessageIdRef` to distinguish cache from new messages
- Removed setTimeout that caused race condition

**Verification:**
- Separator should only appear for actual unread messages
- No "INSTANT: Marking all messages as read" logs
- Read status preserved across close/reopen

---

### 7. SQLite Foreign Key Constraint Failed

**Symptoms:**
- `FOREIGN KEY constraint failed (code 787)`
- Happens during first-time initialization
- Group members can't be saved

**Root Cause:**
Groups not fully saved to SQLite before members are saved.

**Solution Applied:**
- Increased wait time after fetchGroups (500ms → 1000ms)
- Added wait after fetchGroupMembers (500ms)
- Increased fetchGroupMembers timeout (5s → 15s)

**Verification:**
- No FK errors in logs
- Groups and members load successfully

---

### 8. Outbox Messages Stuck

**Symptoms:**
- Messages queued but never sent
- `JWT expired` errors in outbox processing
- Retry count keeps incrementing

**Root Cause:**
Token expired and refresh failing, causing all sends to fail.

**Solution Applied:**
- Session refresh before outbox processing
- Immediate retry after successful refresh
- Max 5 retries with exponential backoff
- Circuit breaker prevents processing when unhealthy

**Verification:**
- Look for `📦 Outbox processing complete`
- Sent count should increase
- Failed messages removed after max retries

---

## Debugging Tips

### Enable Verbose Logging
All pipeline logs are prefixed with `[supabase-pipeline]`.
Realtime logs use `[realtime-v2]`.
Storage adapter logs use `[storage-adapter]`.

### Check Connection Status
```typescript
const state = useChatStore.getState();
console.log('Connection:', state.connectionStatus);
console.log('Channel:', state.realtimeChannel?.state);
```

### Force Reconnection
```typescript
const { forceReconnect, activeGroup } = useChatStore.getState();
if (activeGroup) forceReconnect(activeGroup.id);
```

### Check Session State
```typescript
const session = await supabasePipeline.getWorkingSession();
console.log('Has token:', !!session?.access_token);
console.log('Expires:', new Date(session?.expires_at * 1000));
```

### Check Outbox
```typescript
const outbox = await sqliteService.getOutboxMessages();
console.log('Pending messages:', outbox.length);
```
