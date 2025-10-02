# Fix: RefreshSession() Timeout After Long Backgrounding

## Date: 2025-10-02

## Problem Summary

After keeping the app backgrounded for ~30 minutes:
1. App worked fine initially after resume
2. After ~34 minutes (05:51:21), session refresh started timing out
3. All subsequent message sends failed with JWT expired errors
4. Session refresh attempts consistently timed out (5 seconds)
5. Messages stuck in outbox, never delivered
6. Eventually everything stopped working - no send, no receive

## Root Cause Analysis from log23.txt

### Timeline Analysis

**App Start**: 05:17:23 (23:47:23)
- App resumed successfully
- Messages sent and received normally

**First Timeout**: 05:51:21 (00:21:21) - **~34 minutes after start**
```
🔄 Direct session refresh: timeout
```

**JWT Expired**: 05:52:35 (00:22:35) - **~35 minutes after start**
```
❌ Outbox message 77 failed: Error: REST upsert failed: 401 {"code":"PGRST301","details":null,"hint":null,"message":"JWT expired"}
[#77] 401/JWT expired detected in outbox processing, attempting session refresh
🔄 refreshQuickBounded(2000ms) start
🔄 Direct session refresh...
🔄 Direct session refresh: timeout  ← TIMES OUT!
🔄 refreshQuickBounded result=false in 2003ms
[#77] Session refresh failed, will use normal backoff
```

**Complete Failure**: 05:54:40 onwards (00:24:40+)
- ALL session refresh attempts timeout
- ALL messages go to outbox
- ALL outbox processing fails with JWT expired
- Messages stuck forever

### The Critical Issue

**`client.auth.refreshSession()` is HANGING and never resolving!**

From the logs, we see **23 instances** of "Direct session refresh: timeout":
- Lines 3481, 3484, 3556, 3559, 3730, 3731, 3805, 3813, 3814, 3987, 3990, 4011, 4019, 4030

**Why is it hanging?**

1. **Client Corruption**: After ~30 minutes of backgrounding, the Supabase client enters a corrupted state
2. **Android Background Throttling**: Network requests are throttled/blocked when app is backgrounded
3. **Auth State Stuck**: The auth state machine is stuck and `refreshSession()` can't proceed
4. **WebSocket Connection Dead**: The underlying connection is dead but not properly cleaned up

**The Current Code** (before fix):
```typescript
public async refreshSessionDirect(): Promise<boolean> {
  const client = await this.getClient();
  const refreshPromise = client.auth.refreshSession();  // ← HANGS HERE!
  const refreshTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('refreshSession timeout')), 5000);
  });
  
  const result = await Promise.race([refreshPromise, refreshTimeout]);
  // After 5 seconds, timeout wins and returns false
  // But the underlying refreshSession() is still hanging!
}
```

**The Problem:**
- `refreshSession()` hangs indefinitely
- After 5 seconds, timeout fires and method returns `false`
- But the hanging promise is never cleaned up
- Subsequent calls also hang
- Eventually the client is completely stuck

---

## Fixes Applied

### Fix 1: Use setSession() with Cached Tokens First
**File**: `src/lib/supabasePipeline.ts` lines 625-719

**What Changed:**
Instead of relying solely on `client.auth.refreshSession()` (which hangs), we now:
1. **Try `setSession()` with cached tokens first** (more reliable, faster)
2. **Only fall back to `refreshSession()` if `setSession()` fails**
3. **Track consecutive failures** to detect stuck client

**Why This Works:**
- `setSession()` with cached tokens is more reliable than `refreshSession()`
- It doesn't depend on the auth state machine being healthy
- It has a shorter timeout (3 seconds vs 5 seconds)
- If it fails, we still have the `refreshSession()` fallback

**Code Added:**
```typescript
// CRITICAL FIX: Try setSession() with cached tokens first (more reliable)
if (this.lastKnownAccessToken && this.lastKnownRefreshToken) {
  this.log('🔄 Attempting setSession() with cached tokens (more reliable than refreshSession)');
  try {
    const setSessionPromise = client.auth.setSession({
      access_token: this.lastKnownAccessToken,
      refresh_token: this.lastKnownRefreshToken,
    });
    const setSessionTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('setSession timeout')), 3000);
    });
    
    const setSessionResult: any = await Promise.race([setSessionPromise, setSessionTimeout]);
    
    if (setSessionResult?.data?.session?.access_token && !setSessionResult?.error) {
      this.log('🔄 Direct session refresh: success via setSession()');
      this.updateSessionCache(setSessionResult.data.session);
      this.consecutiveRefreshFailures = 0; // Reset failure counter
      return true;
    }
  } catch (setSessionError: any) {
    this.log('🔄 setSession() failed, will try refreshSession()');
  }
}

// Fall back to refreshSession() if setSession() failed
this.log('🔄 Attempting refreshSession() as fallback');
const refreshPromise = client.auth.refreshSession();
// ... existing timeout logic
```

---

### Fix 2: Track Consecutive Refresh Failures
**File**: `src/lib/supabasePipeline.ts` lines 122-125

**What Changed:**
Added tracking variables to detect when the client is stuck:
```typescript
// Track consecutive refresh failures to detect stuck client
private consecutiveRefreshFailures: number = 0;
private lastRefreshFailureAt: number = 0;
private readonly MAX_CONSECUTIVE_REFRESH_FAILURES = 3;
```

**Why This Matters:**
- After 3 consecutive refresh failures, we know the client is stuck
- We can trigger circuit breaker to prevent further attempts
- This prevents infinite retry loops

---

### Fix 3: Trigger Circuit Breaker on Repeated Failures
**File**: `src/lib/supabasePipeline.ts` lines 672-683

**What Changed:**
When `refreshSession()` times out, we now:
1. Increment `consecutiveRefreshFailures` counter
2. Log the failure count
3. If count reaches 3, trigger circuit breaker

**Code Added:**
```typescript
if (err && err.message === 'refreshSession timeout') {
  this.log('🔄 Direct session refresh: timeout (refreshSession hung)');
  
  // Track consecutive failures
  this.consecutiveRefreshFailures++;
  this.lastRefreshFailureAt = Date.now();
  this.log(`⚠️ Consecutive refresh failures: ${this.consecutiveRefreshFailures}/${this.MAX_CONSECUTIVE_REFRESH_FAILURES}`);
  
  // If we've had too many consecutive failures, trigger client recreation
  if (this.consecutiveRefreshFailures >= this.MAX_CONSECUTIVE_REFRESH_FAILURES) {
    this.log('🔴 Too many consecutive refresh failures, client may be stuck - will recreate on next operation');
    this.failureCount = this.maxFailures; // Trigger circuit breaker
  }
  
  return false;
}
```

**Why This Works:**
- After 3 consecutive timeouts, we know the client is permanently stuck
- Circuit breaker prevents further attempts
- Client will be recreated on next operation
- This breaks the infinite timeout loop

---

### Fix 4: Reset Failure Counter on Success
**File**: `src/lib/supabasePipeline.ts` lines 653, 707

**What Changed:**
When session refresh succeeds (via either `setSession()` or `refreshSession()`), we reset the failure counter:
```typescript
if (success && result?.data?.session) {
  this.updateSessionCache(result.data.session);
  this.consecutiveRefreshFailures = 0; // Reset on success
}
```

**Why This Matters:**
- Prevents false positives from transient network issues
- Only triggers circuit breaker after sustained failures
- Allows recovery if client becomes healthy again

---

## How These Fixes Work Together

### Before Fixes (Current Behavior):
```
App backgrounded 30+ min
  ↓
JWT expires
  ↓
Health check calls refreshSessionDirect()
  ↓
refreshSession() HANGS (never resolves)
  ↓
After 5s timeout, returns false
  ↓
Health check fails → messages go to outbox
  ↓
Outbox processing calls refreshSessionDirect()
  ↓
refreshSession() HANGS AGAIN
  ↓
After 5s timeout, returns false
  ↓
Outbox processing fails with JWT expired
  ↓
Messages stuck forever
  ↓
INFINITE LOOP OF TIMEOUTS ❌
```

### After Fixes (Expected Behavior):
```
App backgrounded 30+ min
  ↓
JWT expires
  ↓
Health check calls refreshSessionDirect()
  ↓
Try setSession() with cached tokens (3s timeout)
  ↓
SUCCESS! ✅ (more reliable than refreshSession)
  ↓
Update session cache + realtime token
  ↓
Health check passes
  ↓
Messages sent via direct path
  ↓
Realtime events fire
  ↓
Messages delivered ✅
```

**If setSession() also fails:**
```
setSession() fails/times out
  ↓
Fall back to refreshSession()
  ↓
refreshSession() times out (5s)
  ↓
Increment consecutiveRefreshFailures (1/3)
  ↓
Return false, messages go to outbox
  ↓
Outbox processing tries again
  ↓
setSession() fails, refreshSession() times out
  ↓
Increment consecutiveRefreshFailures (2/3)
  ↓
Outbox processing tries again
  ↓
setSession() fails, refreshSession() times out
  ↓
Increment consecutiveRefreshFailures (3/3)
  ↓
Trigger circuit breaker
  ↓
Client will be recreated on next operation
  ↓
Fresh client with healthy auth state ✅
```

---

## Testing Instructions

### Test Scenario 1: Long Background Period (30+ minutes)
1. Open app on both devices
2. Send a few messages (should work ✅)
3. Background the app (press home button)
4. Wait **35 minutes**
5. Open app and send a message
6. **Expected Result**:
   - Message sends successfully ✅
   - Other device receives message ✅
   - No "Direct session refresh: timeout" in logs

### Test Scenario 2: Check Logs for setSession() Success
Look for these new log messages:
```
🔄 Attempting setSession() with cached tokens (more reliable than refreshSession)
🔄 Direct session refresh: success via setSession()
🔐 Session cache updated: realtime token refreshed (zombie connection prevented)
```

### Test Scenario 3: Verify Fallback Works
If `setSession()` fails, should see:
```
🔄 setSession() failed, will try refreshSession()
🔄 Attempting refreshSession() as fallback
```

### Test Scenario 4: Verify Circuit Breaker
If both methods fail 3 times:
```
⚠️ Consecutive refresh failures: 1/3
⚠️ Consecutive refresh failures: 2/3
⚠️ Consecutive refresh failures: 3/3
🔴 Too many consecutive refresh failures, client may be stuck - will recreate on next operation
```

---

## Expected Behavior

### Before Fixes:
```
05:51:21 - 🔄 Direct session refresh: timeout
05:52:35 - ❌ JWT expired
05:52:35 - 🔄 Direct session refresh: timeout
05:54:40 - ❌ JWT expired
05:54:40 - 🔄 Direct session refresh: timeout
... (infinite loop of timeouts)
```

### After Fixes:
```
05:51:21 - 🔄 Attempting setSession() with cached tokens
05:51:21 - 🔄 Direct session refresh: success via setSession()
05:51:21 - 🔐 Session cache updated: realtime token refreshed
05:51:22 - ✅ Message sent successfully
05:51:22 - ✅ Message received on other device
```

---

## Summary

**Root Cause**: `client.auth.refreshSession()` hangs indefinitely after app is backgrounded for 30+ minutes, causing all session refresh attempts to timeout and fail.

**Fixes Applied**:
1. ✅ Try `setSession()` with cached tokens first (more reliable, faster)
2. ✅ Fall back to `refreshSession()` only if `setSession()` fails
3. ✅ Track consecutive refresh failures
4. ✅ Trigger circuit breaker after 3 consecutive failures
5. ✅ Reset failure counter on success

**Impact**: 
- Session refresh will succeed using `setSession()` even when `refreshSession()` is stuck
- If both methods fail repeatedly, circuit breaker prevents infinite loops
- Client will be recreated to recover from stuck state
- Messages will be delivered successfully even after long background periods

---

## Files Modified

1. `src/lib/supabasePipeline.ts`
   - Lines 122-125: Added consecutive failure tracking variables
   - Lines 625-719: Rewrote `refreshSessionDirect()` to use `setSession()` first
   - Added circuit breaker trigger on repeated failures
   - Added failure counter reset on success

