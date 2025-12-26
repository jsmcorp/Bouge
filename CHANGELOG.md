# Changelog

All notable changes and bug fixes for the Bouge messaging app.

## [Unreleased]

### Architecture
- Consolidated 150+ documentation files into 4 key documents
- Removed dead comments from codebase

---

## Session Management Fixes

### Custom Storage Adapter (LOG40)
**Problem:** Supabase `getSession()` hanging for 500ms-10s due to Capacitor Preferences async bridge.

**Root Cause:** Default Supabase storage uses Capacitor Preferences which has an async native bridge that can hang when:
- Bridge queue is full
- Disk I/O is slow
- Android system is busy

**Solution:** Custom synchronous localStorage adapter:
```typescript
const customStorageAdapter = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
```

**Result:** Storage operations complete in <1ms instead of 500ms+.

---

### Token Refresh Timeout Fix (LOG43, LOG46)
**Problem:** Token refresh timing out after 2-3s, causing cascading failures.

**Root Cause:** 
- `setSession()` hanging internally without making network requests
- In-flight session promise waiting forever with no timeout

**Solution:**
- Added 5s timeout to in-flight session promise wait
- Increased token refresh timeout from 3s to 10s
- Clear hung promises on timeout and retry

---

### Non-Blocking Network Reconnect (LOG52)
**Problem:** 10-second UI freeze on network reconnection.

**Root Cause:** `onNetworkReconnect()` was awaiting `recoverSession()` synchronously.

**Solution:** Fire-and-forget pattern:
```typescript
this.recoverSession().then(success => {
  // Handle in background
}).catch(error => {
  // Log error, don't block
});
```

---

## Realtime Connection Fixes

### Heartbeat Mechanism (LOG46)
**Problem:** Realtime connection dies without detection, messages lost.

**Root Cause:** No death detection mechanism, no automatic recovery.

**Solution:**
- Send heartbeat every 30 seconds
- Check for death every 10 seconds
- Detect death if no events for 60 seconds
- Auto-recovery: remove channel → refresh session → recreate subscription

---

### Zombie Connection Detection (LOG47)
**Problem:** Connection appears "connected" but stops receiving messages.

**Root Cause:** WebSocket enters zombie state after:
- Extended device lock (8+ minutes)
- Network switches (WiFi ↔ cellular)
- Android killing background processes

**Solution:**
- Track `realtimeDeathAt` timestamp when connection dies
- After reconnection, fetch all messages since death time
- Query: `created_at >= realtimeDeathAt`

---

### Realtime V2 Implementation
**Problem:** Complex reconnection logic with race conditions and stuck states.

**Solution:** Simplified event-driven system:
- Simple 3-second retry with max 3 attempts
- Auth state listener triggers reconnection on `TOKEN_REFRESHED`
- Force fresh connection on app resume
- Connection token system to ignore stale callbacks

**Feature Flag:** `VITE_SIMPLIFIED_REALTIME=true`

---

## Message Delivery Fixes

### Server UUID for FCM (LOG41)
**Problem:** FCM notifications contained optimistic (client-generated) ID instead of server UUID.

**Root Cause:** `push-fanout` was called with `message.id` (optimistic) instead of server-returned ID.

**Solution:** Extract server ID from upsert response:
```typescript
if (Array.isArray(responseData) && responseData[0]?.id) {
  serverMessageId = responseData[0].id;
} else {
  // Fallback: Query by dedupe_key
}
```

---

### Background Sync UI Update (LOG52)
**Problem:** Messages fetched in background but not displayed until navigation.

**Root Cause:** Background Supabase sync saved to SQLite but didn't update React state.

**Solution:** After background fetch, update UI state:
```typescript
if (currentState.activeGroup?.id === groupId) {
  const newMessages = data.filter(msg => !existingIds.has(msg.id));
  set({ messages: [...currentState.messages, ...newMessages] });
}
```

---

### WhatsApp-Style Instant Messaging
**Problem:** 1-3 second delay for messages when returning from background.

**Solution:** 3-layer instant message system:
1. **Prefer Realtime:** Skip FCM processing if realtime connected
2. **Fast Path:** Direct SQLite write from FCM payload (<150ms)
3. **Fallback:** REST fetch only when needed

---

## Unread Tracking Fixes

### Stale Closure Fix
**Problem:** Read status reverts when closing chat.

**Root Cause:** Cleanup function captured stale messages snapshot.

**Solution:** Use `messagesRef` to track latest messages:
```typescript
const messagesRef = useRef<any[]>([]);
// Cleanup uses ref, not stale closure
return () => {
  const currentMessages = messagesRef.current;
};
```

---

### Cache Load Detection
**Problem:** Cache load treated as new message, marking old messages as read.

**Root Cause:** Realtime effect couldn't distinguish cache load from new message.

**Solution:** Track `lastProcessedMessageIdRef`:
```typescript
if (previousLastMessageId) {
  // This is a NEW message
  markGroupAsRead(...);
} else {
  // Initial cache load - don't mark
}
```

---

### setTimeout Race Condition
**Problem:** Race condition between cache load and marking as read.

**Root Cause:** A `setTimeout(100ms)` was marking cache messages as read.

**Solution:** Removed the setTimeout entirely. Realtime effect handles marking.

---

## First-Time Initialization

### Orchestrator Pattern (LOG45)
**Problem:** First-time init failing with FK constraint errors and timeouts.

**Root Cause:**
- `fetchGroupMembers` timeout too aggressive (5s)
- Groups not saved before members
- Unnecessary user profile fetch step

**Solution:**
- Increased `fetchGroupMembers` timeout to 15s
- Added wait times between steps (500ms-1000ms)
- Removed redundant step (fetchGroupMembers already saves user profiles)

**Init Steps:**
1. Sync contacts
2. Fetch groups (wait 1000ms)
3. Fetch group members (wait 500ms) - also saves user profiles
4. Fetch recent messages

---

## SQLite Fixes

### Query Hang Fix (LOG46)
**Problem:** SQLite `messageExists()` query hanging for 10+ seconds.

**Root Cause:** Database lock/contention when checking cross-group messages.

**Solution:** Added 2-second timeout with graceful fallback:
```typescript
const exists = await Promise.race([
  sqliteService.messageExists(messageId),
  new Promise((_, reject) => setTimeout(() => reject(), 2000))
]);
```

---

## FCM Push Notification Fixes

### Listener Registration (ROOT_CAUSES_COMPLETE_ANALYSIS)
**Problem:** "No listeners found for event notificationReceived"

**Root Causes Identified:**
1. Missing FirebaseMessaging config in capacitor.config.ts
2. Web shim bundled instead of native plugin
3. Async listener registration timing issue
4. Data-only payload limitations
5. Missing notification channel

**Solutions Applied:**
- Added FirebaseMessaging configuration
- Fixed Vite bundling to use native plugin
- Synchronous listener registration
- Hybrid payload (notification + data)
- Created notification channel on app start

---

## Circuit Breaker & Health Checks

### Fast Recovery (LOG46)
**Problem:** System stuck after failures, requiring app restart.

**Solution:**
- Circuit breaker opens on first failure (was 10)
- Auto-reset after 30 seconds
- Health check uses cached tokens (avoids hanging getSession)
- Proactive refresh when token expires soon

---

## Performance Optimizations

### Skip Health Check on Fast Path
When realtime is connected, skip health check for message sends:
```typescript
if (connectionStatus === 'connected') {
  skipHealthCheck = true;
}
```

### Session Short-Circuit
If token valid for 5+ minutes, skip ALL refresh logic:
```typescript
if (timeUntilExpiry > 300) {
  return true; // No network calls needed
}
```

### Direct REST Upsert
Bypass SDK overhead with direct PostgREST calls when token is cached.
