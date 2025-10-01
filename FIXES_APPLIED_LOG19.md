# Fixes Applied for log19.txt Issues

## Issues Fixed

### ✅ Issue 1: Direct Send Timeout After Phone Idle
**Problem**: First message after idle times out after 5 seconds because session refresh takes longer

**Solution**: Increased pre-network timeout from 5 seconds to 10 seconds

### ✅ Issue 2: Circuit Breaker Blocking All Messages
**Problem**: After phone lock/unlock, circuit breaker stays open and blocks all messages (including non-ghost)

**Solution**: 
1. Reset circuit breaker on app resume
2. Reduced circuit breaker sensitivity (10 failures instead of 5)
3. Faster auto-reset (30 seconds instead of 60 seconds)

---

## Changes Made

### Change 1: Increase Pre-Network Timeout

**File**: `src/lib/supabasePipeline.ts`

**Lines 1490-1499** (timeout value):
```typescript
// Before
this.log(`[${dbgLabel}] pre-network: acquiring ${fastPathNoAuth ? 'direct' : 'full'} client (≤5000ms)`);
const preNetworkTimeout = new Promise<never>((_, reject) => 
  setTimeout(() => reject(new Error('Direct send timeout after 5000ms')), 5000)
);
if (emsg.includes('Direct send timeout after 5000ms')) {
  this.log(`[${dbgLabel}] Direct send timeout after 5000ms → enqueued to outbox`);
}

// After
this.log(`[${dbgLabel}] pre-network: acquiring ${fastPathNoAuth ? 'direct' : 'full'} client (≤10000ms)`);
const preNetworkTimeout = new Promise<never>((_, reject) => 
  setTimeout(() => reject(new Error('Direct send timeout after 10000ms')), 10000)
);
if (emsg.includes('Direct send timeout after 10000ms')) {
  this.log(`[${dbgLabel}] Direct send timeout after 10000ms → enqueued to outbox`);
}
```

**Lines 1578-1583** (error message check):
```typescript
// Before
if (emsg.includes('Direct send timeout after 5000ms')) {
  this.log(`[${dbgLabel}] Direct send timeout after 5000ms → enqueued to outbox`);
}

// After
if (emsg.includes('Direct send timeout after 10000ms')) {
  this.log(`[${dbgLabel}] Direct send timeout after 10000ms → enqueued to outbox`);
}
```

### Change 2: Reduce Circuit Breaker Sensitivity

**File**: `src/lib/supabasePipeline.ts`

**Lines 122-127**:
```typescript
// Before
private readonly maxFailures = 5;
private readonly circuitBreakerResetMs = 60000; // 1 minute

// After
private readonly maxFailures = 10; // Increased from 5 to reduce false positives
private readonly circuitBreakerResetMs = 30000; // 30 seconds (reduced from 60s)
```

### Change 3: Reset Circuit Breaker on App Resume

**File**: `src/lib/supabasePipeline.ts`

**Lines 2221-2242** (added circuit breaker reset):
```typescript
public async onAppResume(): Promise<void> {
  this.log('📱 App resume detected - checking session state');

  // Reset circuit breaker on app resume to allow fresh attempts
  if (this.circuitBreakerOpen || this.failureCount > 0) {
    this.log('🔄 Circuit breaker reset on app resume');
    this.circuitBreakerOpen = false;
    this.failureCount = 0;
  }

  try {
    // Quick session recovery using cached tokens
    const recovered = await this.recoverSession();
    // ... rest of the function
  }
}
```

---

## Expected Behavior After Fixes

### Issue 1: Direct Send After Idle

**Before**:
- User keeps phone idle for 2-3 minutes
- Sends first message
- Message times out after 5 seconds
- Goes to outbox
- Outbox delivers it successfully
- **User experience**: Delay of 5+ seconds

**After**:
- User keeps phone idle for 2-3 minutes
- Sends first message
- Session refresh completes within 10 seconds
- Message sends directly
- **User experience**: Smooth delivery within 10 seconds

### Issue 2: Messages After Phone Lock

**Before**:
- User locks phone for 2-3 minutes
- Unlocks and opens app
- Circuit breaker is open (from previous failures)
- Sends message (ghost or non-ghost)
- Message goes to outbox (direct send skipped)
- **User experience**: All messages delayed

**After**:
- User locks phone for 2-3 minutes
- Unlocks and opens app
- Circuit breaker resets automatically
- Sends message (ghost or non-ghost)
- Message sends directly
- **User experience**: Instant delivery

---

## Testing Instructions

### Test 1: Idle Phone Scenario

1. **Setup**:
   - Build and deploy: `npm run build && npx cap sync && npx cap run android`
   - Open the app and navigate to a group chat

2. **Test Steps**:
   - Keep phone idle (don't interact with app) for 3-5 minutes
   - Send a message
   - Observe the logs

3. **Expected Results**:
   - ✅ Log shows: `pre-network: acquiring full client (≤10000ms)`
   - ✅ No "Direct send timeout after 10000ms" error
   - ✅ Message sends directly without going to outbox
   - ✅ Log shows: `✅ Direct send successful`

4. **Failure Indicators**:
   - ❌ Log shows: `Direct send timeout after 10000ms`
   - ❌ Log shows: `📦 Message stored in outbox`

### Test 2: Phone Lock/Unlock Scenario

1. **Setup**:
   - Build and deploy: `npm run build && npx cap sync && npx cap run android`
   - Open the app and navigate to a group chat

2. **Test Steps**:
   - Lock the phone (press power button)
   - Wait 2-3 minutes
   - Unlock the phone and open the app
   - Turn OFF ghost mode
   - Send a non-ghost message
   - Observe the logs

3. **Expected Results**:
   - ✅ Log shows: `📱 App resume detected - checking session state`
   - ✅ Log shows: `🔄 Circuit breaker reset on app resume`
   - ✅ Log shows: `📤 Direct send attempt 1/3`
   - ✅ Message sends directly without "Client unhealthy" error
   - ✅ Log shows: `✅ Direct send successful`

4. **Failure Indicators**:
   - ❌ Log shows: `🏥 Health check: circuit breaker open, marking unhealthy`
   - ❌ Log shows: `📤 Client unhealthy, falling back to outbox`
   - ❌ Log shows: `📦 Message stored in outbox`

### Test 3: Rapid Message Sending

1. **Setup**:
   - Build and deploy
   - Open the app and navigate to a group chat

2. **Test Steps**:
   - Send 5 messages rapidly (both ghost and non-ghost)
   - Observe the logs

3. **Expected Results**:
   - ✅ All messages send directly
   - ✅ No circuit breaker openings
   - ✅ All messages show: `✅ Direct send successful`

4. **Failure Indicators**:
   - ❌ Log shows: `🔴 Circuit breaker opened after X failures`
   - ❌ Messages going to outbox unnecessarily

---

## Log Patterns to Look For

### Success Patterns

**After Idle (Issue 1 Fixed)**:
```
[send-XXXXX] pre-network: acquiring full client (≤10000ms)
[send-XXXXX] using full client
[send-XXXXX] fast-path: using direct REST upsert
✅ Direct send successful - message XXXXX
```

**After Phone Unlock (Issue 2 Fixed)**:
```
📱 App resume detected - checking session state
🔄 Circuit breaker reset on app resume
[send-XXXXX] checkHealth() -> healthy
📤 Direct send attempt 1/3 - message XXXXX
✅ Direct send successful - message XXXXX
```

### Failure Patterns (Should NOT See These)

**Issue 1 Still Present**:
```
Direct send timeout after 10000ms → enqueued to outbox
📦 Message XXXXX stored in outbox
```

**Issue 2 Still Present**:
```
🏥 Health check: circuit breaker open, marking unhealthy
📤 Client unhealthy, falling back to outbox - message XXXXX
📦 Message XXXXX stored in outbox
```

---

## Rollback Instructions

If these changes cause issues, revert with:

```bash
git checkout src/lib/supabasePipeline.ts
npm run build && npx cap sync && npx cap run android
```

Or manually revert the changes:

1. Change `10000` back to `5000` in lines 1490, 1494, 1498, 1581
2. Change `maxFailures` from `10` back to `5` in line 126
3. Change `circuitBreakerResetMs` from `30000` back to `60000` in line 127
4. Remove the circuit breaker reset code from `onAppResume()` (lines 2227-2231)

---

## Additional Notes

### Why 10 Seconds?

- Session refresh typically takes 2-5 seconds
- 10 seconds provides comfortable buffer
- Still fast enough for good UX
- Prevents unnecessary outbox fallbacks

### Why 10 Failures?

- 5 failures was too aggressive
- 10 failures allows for transient network issues
- Still protects against persistent failures
- Reduces false positives

### Why 30 Seconds Auto-Reset?

- 60 seconds was too long
- 30 seconds allows faster recovery
- User doesn't have to wait as long
- Still prevents rapid retry storms

---

## Files Modified

1. ✅ `src/lib/supabasePipeline.ts` - 3 changes applied
2. ✅ `ISSUE_ANALYSIS_LOG19.md` - Created for reference
3. ✅ `FIXES_APPLIED_LOG19.md` - This file

---

## Next Steps

1. **Build and test**: `npm run build && npx cap sync && npx cap run android`
2. **Test idle scenario**: Keep phone idle for 3-5 minutes, send message
3. **Test lock scenario**: Lock phone for 2-3 minutes, unlock, send non-ghost message
4. **Collect new logs**: Save logs to `log20.txt` for verification
5. **Verify fixes**: Check for success patterns in logs

