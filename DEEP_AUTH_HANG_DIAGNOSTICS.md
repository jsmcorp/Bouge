# Deep Auth Hang Diagnostics - Finding the TRUE Root Cause

## Problem

We know `getSession()`, `setSession()`, and `refreshSession()` hang, but we don't know **WHY**. Client recreation is a workaround, not a fix. We need to find the **true root cause**.

## Approach

Since we can't add logging inside the Supabase client library, we add extensive logging **around** the calls and monitor the environment to identify what's blocking them.

## New Diagnostics Added

### 1. Storage State Monitoring

**What we check:**
- Is `localStorage` accessible?
- How many Supabase keys are stored?
- Can we read from storage?

**Why this matters:**
- Supabase stores session in `localStorage`
- If storage is blocked/corrupted, `getSession()` will hang
- Storage quota issues can cause hangs

**Logs:**
```
🔍 localStorage accessible, 3 supabase keys
```
or
```
🔍 localStorage check failed: QuotaExceededError
```

### 2. Internal Auth State Inspection

**What we check:**
- `client.auth._currentSession` - Current session state
- `client.auth._refreshing` - Is a refresh already in progress?

**Why this matters:**
- If `_refreshing` is true, another refresh is stuck
- If `_currentSession` is corrupted, operations will hang
- Internal state machine might be stuck

**Logs:**
```
🔍 PRE-refreshSession state:
🔍   - _currentSession exists: true
🔍   - _refreshing: true  ← ANOTHER REFRESH IS STUCK!
```

### 3. Event Loop Monitoring

**What we check:**
- Monitor event loop every 500ms during auth calls
- Measure delay in setTimeout(0) execution
- Count how many checks complete before timeout

**Why this matters:**
- If event loop is blocked, promises won't resolve
- Heavy computation can block async operations
- Identifies if the issue is event loop starvation

**Logs:**
```
🔍 ⚠️ Event loop blocked: 250ms delay on check #3
```
or
```
✅ setSession timeout cancelled (race completed in 245ms, 0 event loop checks)
```

### 4. Promise Creation Timing

**What we check:**
- Time between calling the method and promise creation
- Immediate logging after method call

**Why this matters:**
- If promise creation is slow, the method itself is blocking
- Helps identify if the hang is in method setup or execution

**Logs:**
```
🔍 setSession() called, promise created at 0ms  ← Fast, good
```
or
```
🔍 setSession() called, promise created at 500ms  ← Slow, problem!
```

### 5. Detailed Hang Diagnostics

**What we check when hang is detected:**
- Client object existence
- Auth module existence
- Method availability
- Event loop responsiveness

**Logs:**
```
🔴 CLIENT CORRUPTION DETECTED: getSession() hung for 502ms
🔍 HANG DIAGNOSTICS:
🔍   - client exists: true
🔍   - client.auth exists: true
🔍   - typeof client.auth.getSession: function
🔍   - Event loop delay: 5ms
```

## What We Can Learn

### Scenario 1: Storage Issue
```
🔍 localStorage check failed: QuotaExceededError
🔍 getSession() called, promise created at 0ms
⏰ getSession() timeout fired after 500ms
```
**Root Cause:** Storage quota exceeded, `getSession()` can't read session
**Fix:** Clear old data, implement storage cleanup

### Scenario 2: Concurrent Refresh Deadlock
```
🔍 PRE-refreshSession state:
🔍   - _refreshing: true
🔍 refreshSession() called, promise created at 0ms
⏰ refreshSession() timeout fired after 5000ms
```
**Root Cause:** Another refresh is stuck, new refresh waits forever
**Fix:** Add mutex/lock management, cancel stuck refreshes

### Scenario 3: Event Loop Blocked
```
🔍 refreshSession() called, promise created at 0ms
🔍 ⚠️ Event loop blocked: 450ms delay on check #1
🔍 ⚠️ Event loop blocked: 380ms delay on check #2
⏰ refreshSession() timeout fired after 5000ms (event loop checks: 2)
```
**Root Cause:** Event loop is blocked by heavy computation
**Fix:** Move heavy work to Web Worker, optimize sync operations

### Scenario 4: Method Call Blocking
```
🔍 setSession() called, promise created at 2500ms  ← SLOW!
⏰ setSession() timeout fired after 3000ms
```
**Root Cause:** The method itself is blocking before creating promise
**Fix:** Investigate what `setSession()` does synchronously

### Scenario 5: Network Stack Hung
```
🔍 refreshSession() called, promise created at 0ms
🔍 Event loop checks: 10 (all responsive)
⏰ refreshSession() timeout fired after 5000ms
```
**Root Cause:** Promise created fine, event loop fine, but network request never completes
**Fix:** Check WebView network stack, implement request timeout at lower level

## Testing Instructions

1. **Deploy this version** with deep diagnostics
2. **Wait for timeout** to occur
3. **Extract logs** and look for patterns:

### Pattern Analysis Checklist

- [ ] **Storage accessible?** Look for "localStorage accessible" or "localStorage check failed"
- [ ] **Concurrent refresh?** Look for "_refreshing: true"
- [ ] **Event loop blocked?** Look for "Event loop blocked" warnings
- [ ] **Slow promise creation?** Look for "promise created at Xms" where X > 100
- [ ] **Event loop responsive?** Check "event loop checks" count
- [ ] **Internal state?** Check "_currentSession exists" and "_refreshing" values

### Example Analysis

**Log Extract:**
```
🔍 PRE-refreshSession state:
🔍   - _currentSession exists: true
🔍   - _refreshing: true
🔍 refreshSession() called, promise created at 0ms
🔍 Event loop checks: 10
⏰ refreshSession() timeout fired after 5000ms (event loop checks: 10)
```

**Analysis:**
- Storage: ✅ (not checked in this call, but previous calls succeeded)
- Concurrent refresh: ❌ `_refreshing: true` - ANOTHER REFRESH IS STUCK!
- Event loop: ✅ (10 checks completed, all responsive)
- Promise creation: ✅ (0ms - instant)

**Conclusion:** The root cause is a **concurrent refresh deadlock**. Another refresh started but never completed, blocking all subsequent refreshes.

**Fix:** Implement refresh cancellation or timeout for stuck refreshes.

## Expected Root Causes

Based on the diagnostics, we expect to find one of these:

### 1. Storage Corruption/Quota
**Symptom:** `localStorage check failed`
**Fix:** Implement storage cleanup, handle quota errors

### 2. Concurrent Refresh Deadlock
**Symptom:** `_refreshing: true` when timeout occurs
**Fix:** Cancel stuck refreshes, implement refresh mutex

### 3. Event Loop Starvation
**Symptom:** Multiple "Event loop blocked" warnings
**Fix:** Optimize heavy operations, use Web Workers

### 4. Network Stack Hang
**Symptom:** Promise created fast, event loop responsive, but still times out
**Fix:** Implement lower-level network timeout, check WebView network stack

### 5. Internal State Corruption
**Symptom:** `_currentSession` is null/undefined when it shouldn't be
**Fix:** Reset internal state, implement state validation

## Files Modified

- `src/lib/supabasePipeline.ts`
  - Added storage state monitoring
  - Added internal auth state inspection
  - Added event loop monitoring
  - Added promise creation timing
  - Added detailed hang diagnostics

## Next Steps

1. Deploy and wait for timeout
2. Extract diagnostic logs
3. Identify the pattern from checklist above
4. Implement the **precise fix** for that specific root cause
5. Remove client recreation workaround once root cause is fixed

## Success Criteria

We'll know we found the root cause when:
1. Logs clearly show what's blocking the auth calls
2. We can reproduce the issue by triggering that condition
3. Fixing that specific issue eliminates the timeouts
4. No need for client recreation workaround
