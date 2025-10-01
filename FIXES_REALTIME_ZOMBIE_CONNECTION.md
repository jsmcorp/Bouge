# Fix: Realtime Zombie Connection After Long Idle

## Date: 2025-10-02

## Problem Summary

After keeping the app idle for 10-15 minutes with the phone locked:
1. Messages sent from one device show as "sent" (tick marks) ✅
2. But the other device doesn't receive the messages ❌
3. Only FCM notifications are received when device is locked
4. When opened, no messages are visible
5. All sent messages show clock icon (stuck in "sending" state) or failed

## Root Cause Analysis

### The Issue: Realtime "Zombie Connection" with Expired Token

**Timeline from logs (log22.txt):**

1. **04:33:04** - App resumes after 10-15 min idle → JWT token has expired
2. **04:33:04** - Token recovery times out: `⚠️ App resume: token recovery failed, session may need refresh`
3. **04:33:04** - Code applies EXPIRED token to realtime: `✅ App resume: token applied to realtime` (misleading!)
4. **04:33:05** - Session refresh happens and gets NEW token (from earlier fix)
5. **04:33:23** - Messages sent via REST API work (after retries with new token) → Sender sees ticks ✅
6. **04:33:23** - But realtime INSERT events never fire (WebSocket has expired token) → Receiver doesn't get updates ❌

### Why This Happens

The realtime WebSocket connection is **separate** from the REST API:
- **REST API**: Uses fresh token after session refresh → Messages reach Supabase ✅
- **Realtime WebSocket**: Still using expired token → INSERT events never fire ❌

**The Bug in Code** (`src/lib/supabasePipeline.ts` lines 2330-2348):
```typescript
// Apply current token to realtime if available
try {
  const client = await this.getClient();
  const token = this.lastKnownAccessToken;  // ← EXPIRED TOKEN!
  if (token) {
    if ((client as any)?.realtime?.setAuth) {
      (client as any).realtime.setAuth(token);  // ← APPLYING EXPIRED TOKEN!
      this.log('✅ App resume: token applied to realtime');  // ← MISLEADING!
    }
  }
} catch (e) {
  this.log('⚠️ App resume: failed to apply token to realtime:', stringifyError(e));
}
```

**The Missing Piece:**
When session is refreshed and `updateSessionCache()` is called:
1. Cached tokens are updated ✅ (from earlier fix)
2. **Realtime WebSocket token is NOT updated** ❌ (the bug!)

Result: Realtime connection becomes a "zombie" - appears subscribed but never receives events.

---

## Fixes Applied

### Fix 1: Proactive Session Refresh in Health Check
**File**: `src/lib/supabasePipeline.ts` lines 504-536

**What Changed:**
When health check detects session expiring within 60 seconds, it now:
1. Calls `refreshQuickBounded(2000)` to **actually refresh** the session
2. If refresh succeeds → returns `true` (healthy)
3. If refresh fails → returns `false` (unhealthy)

**Before:**
```typescript
if (expiresAt > 0 && expiresAt - nowSec <= 60) {
  this.log('🏥 Health check: cached session expires soon, needs refresh');
  this.recordFailure();
  return false; // ❌ Just returns false, never refreshes!
}
```

**After:**
```typescript
if (expiresAt > 0 && expiresAt - nowSec <= 60) {
  this.log('🏥 Health check: cached session expires soon, attempting proactive refresh');
  
  // CRITICAL FIX: Actually refresh the session
  const refreshed = await this.refreshQuickBounded(2000);
  if (refreshed) {
    this.log('🏥 Health check: proactive refresh successful, client healthy');
    this.recordSuccess();
    return true; // ✅ Session refreshed, client is healthy!
  } else {
    this.log('🏥 Health check: proactive refresh failed, marking unhealthy');
    this.recordFailure();
    return false;
  }
}
```

---

### Fix 2: 401 JWT Expired Retry in Outbox Processing
**File**: `src/lib/supabasePipeline.ts` lines 2042-2097

**What Changed:**
When outbox processing encounters a 401/JWT expired error, it now:
1. Detects the 401 error (including "PGRST301" code)
2. Attempts session refresh with `refreshQuickBounded(2000)`
3. If refresh succeeds → schedules **immediate retry** without incrementing retry count
4. If refresh fails → uses normal backoff logic

**Added Code:**
```typescript
// CRITICAL FIX: Check for 401/JWT expired errors and attempt session refresh
let shouldRetryImmediately = false;
try {
  const status = (error as any)?.status ?? (error as any)?.code;
  const msg = String((error as any)?.message || '');
  const is401 = status === 401 || status === '401' || /jwt|token|unauthoriz|PGRST301/i.test(msg);
  
  if (is401) {
    this.log(`[#${outboxItem.id}] 401/JWT expired detected in outbox processing, attempting session refresh`);
    const refreshed = await this.refreshQuickBounded(2000);
    if (refreshed) {
      this.log(`[#${outboxItem.id}] Session refresh successful, will retry immediately`);
      shouldRetryImmediately = true;
    }
  }
} catch (refreshError) {
  this.log(`[#${outboxItem.id}] Session refresh error:`, stringifyError(refreshError));
}

if (shouldRetryImmediately) {
  // Schedule immediate retry (0ms backoff) without incrementing retry count
  await sqliteService.updateOutboxRetry(outboxItem.id, outboxItem.retry_count || 0, Date.now());
  this.log(`⚡ Outbox message ${outboxItem.id} scheduled for immediate retry after session refresh`);
  retriedCount++;
}
```

---

### Fix 3: Update Cached Tokens in Session Cache
**File**: `src/lib/supabasePipeline.ts` lines 933-954 (earlier fix)

**What Changed:**
When `updateSessionCache()` is called, it now also updates:
- `lastKnownAccessToken`
- `lastKnownRefreshToken`
- `lastKnownUserId`

This ensures all cached token variables stay in sync with the refreshed session.

---

### Fix 4: Update Realtime Token After Session Refresh (NEW - CRITICAL!)
**File**: `src/lib/supabasePipeline.ts` lines 933-982

**What Changed:**
When `updateSessionCache()` is called after successful session refresh, it now:
1. Updates cached tokens (from Fix 3)
2. **Invalidates old realtime token** (`lastRealtimeAuthToken = null`)
3. **Applies new token to realtime WebSocket** using `setRealtimeAuth()`
4. Logs success/failure of realtime token update

**Added Code:**
```typescript
// CRITICAL FIX: Apply new token to realtime connection to prevent zombie connections
if (session?.access_token) {
  try {
    // Invalidate old realtime token to force update
    const oldToken = this.lastRealtimeAuthToken;
    this.lastRealtimeAuthToken = null;
    
    // Apply new token to realtime WebSocket connection (fire-and-forget)
    this.setRealtimeAuth(session.access_token).then(({ changed }) => {
      if (changed) {
        this.log('🔐 Session cache updated: realtime token refreshed (zombie connection prevented)');
      } else {
        this.log('🔐 Session cache updated: realtime token unchanged');
      }
    }).catch(err => {
      this.log('⚠️ Failed to update realtime token after session refresh:', stringifyError(err));
      this.lastRealtimeAuthToken = oldToken; // Restore old token on failure
    });
    
    this.log('🔐 Session cache updated (including cached tokens + realtime token update initiated)');
  } catch (error) {
    this.log('⚠️ Error updating realtime token:', stringifyError(error));
  }
}
```

---

## How These Fixes Work Together

1. **Proactive Refresh (Fix 1)**: Prevents session from expiring in the first place
2. **401 Retry (Fix 2)**: Handles cases where session already expired
3. **Token Cache Sync (Fix 3)**: Ensures all cached tokens are updated
4. **Realtime Token Update (Fix 4)**: **Prevents zombie connections** by updating WebSocket token

**The Critical Flow:**
```
App idle 10-15 min → JWT expires
  ↓
Health check detects expiration → Proactively refreshes session (Fix 1)
  ↓
Session refresh succeeds → updateSessionCache() called
  ↓
Cached tokens updated (Fix 3) + Realtime token updated (Fix 4)
  ↓
Both REST API and Realtime WebSocket now use fresh token
  ↓
Messages sent via REST API ✅ + Realtime INSERT events fire ✅
  ↓
Sender sees ticks ✅ + Receiver gets messages ✅
```

---

## Testing Instructions

### Test Scenario 1: Long Idle Period
1. Open the app and send a message (should work ✅)
2. Lock the phone and wait **15 minutes**
3. Unlock and open the app
4. Send a message from Device A
5. **Expected Result**: 
   - Device A shows tick marks ✅
   - Device B receives the message in real-time ✅

### Test Scenario 2: Multiple Messages After Idle
1. Lock phone for 15 minutes
2. Unlock and send 5 messages in quick succession from Device A
3. **Expected Result**: 
   - All messages show tick marks on Device A ✅
   - All messages received on Device B in real-time ✅

### Test Scenario 3: Check Logs
Look for these new log messages:
```
🏥 Health check: cached session expires soon, attempting proactive refresh
🏥 Health check: proactive refresh successful, client healthy
🔐 Session cache updated (including cached tokens + realtime token update initiated)
🔐 Session cache updated: realtime token refreshed (zombie connection prevented)
[#XX] 401/JWT expired detected in outbox processing, attempting session refresh
[#XX] Session refresh successful, will retry immediately
```

---

## Expected Behavior

### Before Fixes:
```
04:33:04 - Token recovery failed
04:33:04 - ✅ App resume: token applied to realtime (EXPIRED TOKEN!)
04:33:23 - Message sent via REST API ✅
04:33:23 - Realtime INSERT event: ❌ NEVER FIRES (expired token)
         - Sender sees ticks ✅
         - Receiver sees nothing ❌
```

### After Fixes:
```
04:33:04 - Token recovery failed
04:33:04 - ⚠️ App resume: token applied to realtime (expired token)
04:33:05 - 🏥 Health check: proactive refresh successful
04:33:05 - 🔐 Session cache updated: realtime token refreshed (zombie connection prevented)
04:33:06 - Message sent via REST API ✅
04:33:06 - Realtime INSERT event: ✅ FIRES (fresh token)
         - Sender sees ticks ✅
         - Receiver gets message ✅
```

---

## Summary

**Root Cause**: After long idle, expired token is applied to realtime WebSocket. Even after session refresh succeeds, the realtime connection is never updated with the fresh token, creating a "zombie connection" that appears subscribed but never receives events.

**Fixes Applied**:
1. ✅ Proactive session refresh in health check
2. ✅ 401 error detection and retry in outbox processing
3. ✅ Proper token cache updates after refresh
4. ✅ **Realtime WebSocket token update after session refresh** (CRITICAL FIX!)

**Impact**: Messages will now be received on both devices even after long idle periods, because:
- Session is proactively refreshed before expiration
- If session does expire, 401 errors trigger immediate refresh and retry
- **Realtime WebSocket connection is updated with fresh token** (prevents zombie connections)
- Both REST API and realtime channels use fresh tokens

---

## Files Modified

1. `src/lib/supabasePipeline.ts`
   - Lines 504-536: Proactive session refresh in health check
   - Lines 2042-2097: 401 JWT expired retry in outbox processing
   - Lines 933-982: Update cached tokens + realtime token after session refresh

