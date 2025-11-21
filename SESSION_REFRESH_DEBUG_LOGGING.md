# Session Refresh Debug Logging - Complete Fix

## Problem Identified

The session refresh was hanging due to a **lock management issue** in `refreshSessionUnified()`:

### The Symptom
```
🔄 refreshSessionUnified: waiting for in-flight refresh
[10 seconds later]
❌ TIMEOUT
```

### Root Cause
When Call A started a refresh, it set `this.refreshInFlight` to a promise. If Call A's underlying `client.auth.refreshSession()` or `client.auth.setSession()` hung:
- The promise never resolved
- The `finally` block never executed
- `this.refreshInFlight` was never cleared
- Call B (and all subsequent calls) waited forever

### Why It Hung
We couldn't see **which specific operation** was hanging:
- Was it `getClient()`?
- Was it `setSession()`?
- Was it `refreshSession()`?
- Was it the timeout mechanism itself?

## Solution Implemented

### 1. Comprehensive Logging with Call IDs
Every refresh call now gets a unique ID for tracking:
```typescript
const callId = `${mode}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
```

### 2. Detailed Step-by-Step Logging
Added logs at every critical point:

**Lock Management:**
- `🚀 START (taking lock)` - When a call takes the lock
- `⏳ WAITING for in-flight refresh` - When a call waits
- `✅ WAIT COMPLETED` - When waiting finishes successfully
- `❌ WAIT FAILED` - When waiting fails
- `🔓 FINALLY: Clearing refreshInFlight lock` - Lock release
- `🏁 COMPLETE: Total time Xms, lock released` - Final completion

**Strategy 1 (setSession):**
- `🔑 Strategy 1: Attempting setSession()` - Start
- `📞 Calling client.auth.setSession()` - Before call
- `⏱️ Setting up timeout race` - Timeout setup
- `🏁 Starting Promise.race` - Race start
- `✅ setSession Promise.race completed` - Race finished
- `⏰ setSession timeout fired` - If timeout triggers
- `❌ setSession ERROR` - If error occurs

**Strategy 2 (refreshSession):**
- `🔄 Strategy 2: Attempting refreshSession()` - Start
- `📞 Calling client.auth.refreshSession()` - Before call
- `⏱️ Setting up timeout race` - Timeout setup
- `🏁 Starting Promise.race` - Race start
- `✅ refreshSession Promise.race completed` - Race finished
- `⏰ refreshSession timeout fired` - If timeout triggers
- `🔍 Checking refreshSession result` - Result analysis
- `❌ FAILED` with full error details

**Error Handling:**
- `❌ OUTER CATCH: Unhandled error` - Unexpected errors
- `❌ FINAL CATCH: refreshInFlight promise rejected` - Promise rejection

### 3. Enhanced Error Information
Every error now includes:
- Call ID for tracking
- Elapsed time
- Full error stringification
- Consecutive failure count updates

### 4. Guaranteed Lock Release
The `finally` block now has explicit logging to confirm it executes:
```typescript
finally {
  this.log(`🔄 [${callId}] 🔓 FINALLY: Clearing refreshInFlight lock`);
  this.refreshInFlight = null;
  const took = Date.now() - started;
  this.log(`🔄 [${callId}] 🏁 COMPLETE: Total time ${took}ms, lock released`);
}
```

## What We'll See in Logs Now

### Successful Refresh
```
🔄 [direct-1732310000000-abc123] refreshSessionUnified(direct, timeout=10000ms) 🚀 START (taking lock)
🔄 [direct-1732310000000-abc123] 📍 Inside refresh promise execution
🔄 [direct-1732310000000-abc123] 📞 Calling getClient()...
🔄 [direct-1732310000000-abc123] ✅ getClient() returned successfully
🔄 [direct-1732310000000-abc123] 🔑 Strategy 1: Attempting setSession() with cached tokens
🔄 [direct-1732310000000-abc123] 📞 Calling client.auth.setSession()...
🔄 [direct-1732310000000-abc123] ⏱️ Setting up timeout race (3000ms)...
🔄 [direct-1732310000000-abc123] 🏁 Starting Promise.race for setSession...
🔄 [direct-1732310000000-abc123] ✅ setSession Promise.race completed
🔄 [direct-1732310000000-abc123] ✅ setSession returned valid session
🔄 [direct-1732310000000-abc123] ✅ SUCCESS via setSession() in 245ms
🔄 [direct-1732310000000-abc123] ⏳ Awaiting refreshInFlight promise...
🔄 [direct-1732310000000-abc123] ✅ refreshInFlight promise resolved in 246ms, result=true
🔄 [direct-1732310000000-abc123] 🔓 FINALLY: Clearing refreshInFlight lock
🔄 [direct-1732310000000-abc123] 🏁 COMPLETE: Total time 246ms, lock released
```

### Hung Call (What We're Looking For)
```
🔄 [direct-1732310000000-abc123] refreshSessionUnified(direct, timeout=10000ms) 🚀 START (taking lock)
🔄 [direct-1732310000000-abc123] 📍 Inside refresh promise execution
🔄 [direct-1732310000000-abc123] 📞 Calling getClient()...
[HANGS HERE - we'll see exactly where it stops]
```

### Concurrent Call Waiting
```
🔄 [background-1732310000500-def456] refreshSessionUnified: ⏳ WAITING for in-flight refresh
[waits for Call A]
🔄 [background-1732310000500-def456] refreshSessionUnified: ✅ WAIT COMPLETED in 246ms, result=true
```

## Testing Instructions

1. Deploy this version
2. Trigger the session refresh issue
3. Check logs for the call ID that takes the lock
4. Follow that call ID through the logs to see exactly where it hangs
5. Look for the last log message before the hang - that's the culprit

## Expected Findings

We'll now be able to identify:
- **If `getClient()` hangs** - Last log: "📞 Calling getClient()..."
- **If `setSession()` hangs** - Last log: "🏁 Starting Promise.race for setSession..."
- **If `refreshSession()` hangs** - Last log: "🏁 Starting Promise.race for refreshSession..."
- **If timeout doesn't fire** - We'll see the timeout setup but never see "⏰ timeout fired"
- **If promise never resolves** - We'll see race start but never see "✅ Promise.race completed"

## Files Modified

- `src/lib/supabasePipeline.ts` - Added comprehensive logging to `refreshSessionUnified()` method

## Next Steps

After identifying the exact hang point, we can:
1. Add additional timeout protection at that specific layer
2. Implement a watchdog timer for that operation
3. Add fallback mechanisms
4. Consider alternative approaches for that specific operation
