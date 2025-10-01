# Issue Analysis - log19.txt

## Summary

Two critical issues identified:

1. **Direct send timeout after phone idle** - First message after idle takes >5 seconds due to session refresh
2. **Circuit breaker blocking all messages** - After failures, circuit breaker opens and blocks ALL messages (including non-ghost)

---

## Issue 1: Direct Send Timeout After Idle

### Problem

When the phone is idle for some time, the first message sent fails with a 5-second timeout and goes to outbox. Subsequent messages send quickly.

### Root Cause

**Timeline from logs (lines 115-174)**:
1. Line 124: `[send-1759354873437-diw15eb346q] checkHealth() -> start`
2. Line 139: `GET https://sxykfyqrqwifkirveqgr.supabase.co/auth/v1/user` - Session refresh triggered
3. Line 148: `Direct send timeout after 5000ms → enqueued to outbox` - Timeout while waiting for auth refresh
4. Line 153: Message stored in outbox
5. Line 201: Outbox processes and delivers the message successfully ✅

**The issue**: When `getClient()` is called after idle, it makes a `GET /auth/v1/user` request to refresh the session. This request takes longer than the 5-second `preNetworkTimeout`, causing the direct send to fail and fall back to outbox.

**Why subsequent messages work**: After the first message refreshes the session, the cached token is valid, so subsequent messages use the fast path without needing to refresh.

### Code Location

`src/lib/supabasePipeline.ts` lines 1490-1505:

```typescript
this.log(`[${dbgLabel}] pre-network: acquiring ${fastPathNoAuth ? 'direct' : 'full'} client (≤5000ms)`);
let client: any;
try {
  const clientPromise = fastPathNoAuth ? this.getDirectClient() : this.getClient();
  const preNetworkTimeout = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Direct send timeout after 5000ms')), 5000)
  );
  client = await Promise.race([clientPromise, preNetworkTimeout]);
} catch (e: any) {
  const emsg = String(e?.message || e || '');
  if (emsg.includes('Direct send timeout after 5000ms')) {
    this.log(`[${dbgLabel}] Direct send timeout after 5000ms → enqueued to outbox`);
    await this.fallbackToOutbox(message);
    // ... throw error
  }
}
```

### Solution

**Option 1**: Increase `preNetworkTimeout` from 5000ms to 10000ms (10 seconds)
- Pros: Simple fix, allows session refresh to complete
- Cons: User waits longer for first message after idle

**Option 2**: Make session refresh non-blocking
- Pros: Messages send immediately, session refreshes in background
- Cons: More complex, requires refactoring

**Recommended**: Option 1 - Increase timeout to 10 seconds

---

## Issue 2: Circuit Breaker Blocking All Messages

### Problem

After the phone is locked and unlocked, ALL messages (including non-ghost) fail with "Client unhealthy" and go to outbox. The circuit breaker is open, blocking direct sends.

### Root Cause

**Timeline from logs (lines 502-843)**:
1. Line 502-513: App goes to background (phone locked)
2. Line 512: `App paused - resetting outbox processing state`
3. Line 514-553: App resumes after 132 seconds
4. Line 553: `No outbox messages to process; idle`
5. Line 827: User sends non-ghost message `"Health ghuvub"` with `is_ghost":0`
6. Line 838: `📤 Client unhealthy, falling back to outbox` - Direct send skipped!
7. Line 843: Message stored in outbox
8. Line 903: Another non-ghost message `"Gxity hi 8t ti 8t t8"` with `is_ghost":0`
9. Line 915: `📤 Client unhealthy, falling back to outbox` - Direct send skipped again!
10. Line 962: `🏥 Health check: circuit breaker open, marking unhealthy` - Circuit breaker is open!

**The issue**: The circuit breaker opens after 5 failures (line 230-232 in code). Once open, `checkHealth()` returns `false` immediately (line 455-457), causing ALL messages to skip direct send and go to outbox.

**Why it stays open**: The circuit breaker auto-resets after 60 seconds (line 248), but if messages keep failing, it reopens immediately.

### Code Location

`src/lib/supabasePipeline.ts` lines 122-255:

```typescript
// Circuit breaker for repeated failures
private failureCount = 0;
private lastFailureAt = 0;
private circuitBreakerOpen = false;
private readonly maxFailures = 5;
private readonly circuitBreakerResetMs = 60000; // 1 minute

private recordFailure(): void {
  this.failureCount++;
  this.lastFailureAt = Date.now();

  if (this.failureCount >= this.maxFailures) {
    this.circuitBreakerOpen = true;
    this.log(`🔴 Circuit breaker opened after ${this.failureCount} failures`);
  }
}

private isCircuitBreakerOpen(): boolean {
  if (!this.circuitBreakerOpen) return false;

  // Auto-reset circuit breaker after timeout
  if (Date.now() - this.lastFailureAt > this.circuitBreakerResetMs) {
    this.log(`🟡 Circuit breaker auto-reset after ${this.circuitBreakerResetMs}ms`);
    this.circuitBreakerOpen = false;
    this.failureCount = 0;
    return false;
  }

  return true;
}

public async checkHealth(): Promise<boolean> {
  // Check circuit breaker first
  if (this.isCircuitBreakerOpen()) {
    this.log('🏥 Health check: circuit breaker open, marking unhealthy');
    return false;
  }
  // ... rest of health check
}
```

### Solution

**Option 1**: Reset circuit breaker on app resume
- Add circuit breaker reset in the app resume handler
- Ensures fresh start after phone unlock

**Option 2**: Reduce circuit breaker threshold
- Change `maxFailures` from 5 to 10
- Change `circuitBreakerResetMs` from 60000ms to 30000ms (30 seconds)

**Option 3**: Allow outbox to bypass circuit breaker
- Outbox processing should always attempt delivery, even if circuit breaker is open
- Only block direct sends from user actions

**Recommended**: Combination of Option 1 + Option 3
- Reset circuit breaker on app resume
- Allow outbox to process even when circuit breaker is open (already implemented in line 1811-1816)

---

## Fixes to Apply

### Fix 1: Increase Pre-Network Timeout

**File**: `src/lib/supabasePipeline.ts` line 1494

**Change**:
```typescript
// Before
const preNetworkTimeout = new Promise<never>((_, reject) => 
  setTimeout(() => reject(new Error('Direct send timeout after 5000ms')), 5000)
);

// After
const preNetworkTimeout = new Promise<never>((_, reject) => 
  setTimeout(() => reject(new Error('Direct send timeout after 10000ms')), 10000)
);
```

**Also update error message checks** at lines 1498 and 1581:
```typescript
// Before
if (emsg.includes('Direct send timeout after 5000ms')) {

// After
if (emsg.includes('Direct send timeout after 10000ms')) {
```

### Fix 2: Reset Circuit Breaker on App Resume

**File**: `src/lib/supabasePipeline.ts` 

**Find the app resume handler** (search for "App resume detected" or "resume" event handler)

**Add**:
```typescript
// Reset circuit breaker on app resume
this.circuitBreakerOpen = false;
this.failureCount = 0;
this.log('🔄 Circuit breaker reset on app resume');
```

### Fix 3: Reduce Circuit Breaker Sensitivity

**File**: `src/lib/supabasePipeline.ts` lines 126-127

**Change**:
```typescript
// Before
private readonly maxFailures = 5;
private readonly circuitBreakerResetMs = 60000; // 1 minute

// After
private readonly maxFailures = 10;
private readonly circuitBreakerResetMs = 30000; // 30 seconds
```

---

## Expected Results After Fixes

### Issue 1 (Direct Send Timeout):
- ✅ First message after idle will have 10 seconds to complete session refresh
- ✅ No more unnecessary outbox fallbacks for first message
- ✅ Faster perceived message delivery

### Issue 2 (Circuit Breaker):
- ✅ Circuit breaker resets on app resume
- ✅ Non-ghost messages send directly after phone unlock
- ✅ Less aggressive circuit breaker (10 failures instead of 5)
- ✅ Faster auto-reset (30 seconds instead of 60 seconds)

---

## Testing Steps

1. **Test Issue 1 Fix**:
   - Keep phone idle for 2-3 minutes
   - Send a message
   - Should send directly without timeout (within 10 seconds)
   - Check logs for no "Direct send timeout" errors

2. **Test Issue 2 Fix**:
   - Lock phone for 2-3 minutes
   - Unlock and open app
   - Turn off ghost mode
   - Send a non-ghost message
   - Should send directly without "Client unhealthy" error
   - Check logs for "Circuit breaker reset on app resume"

3. **Verify No Regressions**:
   - Send multiple messages quickly (ghost and non-ghost)
   - All should send directly
   - Check logs for no circuit breaker openings

