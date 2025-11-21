# Auth Hang Root Cause Diagnostics - Comprehensive Logging

## Problem Statement

Session refresh calls (`setSession()` and `refreshSession()`) are timing out intermittently. We need to identify the **root cause** of why these auth calls hang, not just work around the issue.

## Solution: Comprehensive Diagnostic Logging

Added extensive diagnostic capture that runs **before** and **during** auth call timeouts to identify exactly what's happening when the calls hang.

## What Was Added

### 1. Pre-Call Diagnostics

Before every auth call (`setSession()` and `refreshSession()`), we now capture:

```typescript
const diagnostics = await this.captureAuthDiagnostics(callId, 'setSession-before');
this.log(`🔍 PRE-CALL DIAGNOSTICS: ${JSON.stringify(diagnostics)}`);
```

### 2. Timeout Diagnostics

When a timeout occurs, we immediately capture the state:

```typescript
const timeoutDiagnostics = await this.captureAuthDiagnostics(callId, 'setSession-timeout');
this.log(`🔍 TIMEOUT DIAGNOSTICS: ${JSON.stringify(timeoutDiagnostics)}`);
```

### 3. Enhanced Error Logging

All errors now include:
- Error name
- Error message
- Full stack trace
- Timing information

## Diagnostic Data Captured

### 1. Network State
```json
{
  "network": {
    "connected": true,
    "connectionType": "wifi"
  }
}
```

**What this tells us:**
- Is the device actually online?
- What type of connection (wifi, cellular, none)?
- Did network state change during the call?

### 2. Client State
```json
{
  "client": {
    "exists": true,
    "isInitialized": true,
    "hasAuth": true
  }
}
```

**What this tells us:**
- Is the Supabase client properly initialized?
- Is the auth module available?
- Did the client get corrupted?

### 3. Session State
```json
{
  "session": {
    "hasUserId": true,
    "hasAccessToken": true,
    "hasRefreshToken": true,
    "hasCachedSession": true,
    "cachedSessionAge": 45000,
    "consecutiveFailures": 0,
    "lastCorruptionCheck": 30000,
    "tokenExpiresIn": 3600,
    "tokenExpired": false
  }
}
```

**What this tells us:**
- Are tokens available?
- How old is the cached session?
- Are tokens expired?
- How many consecutive failures have occurred?

### 4. Circuit Breaker State
```json
{
  "circuitBreaker": {
    "failureCount": 0,
    "isOpen": false,
    "lastFailureAt": null,
    "timeSinceLastFailure": null
  }
}
```

**What this tells us:**
- Is the circuit breaker preventing calls?
- How many recent failures?
- When was the last failure?

### 5. In-Flight State
```json
{
  "inFlight": {
    "hasRefreshInFlight": false
  }
}
```

**What this tells us:**
- Is another refresh already running?
- Could there be a deadlock?

### 6. Client Session Check
```json
{
  "clientSession": {
    "hasSession": true,
    "hasError": false,
    "errorMessage": null
  }
}
```

**What this tells us:**
- Can we quickly get the session from the client?
- Is the client's internal state corrupted?
- Does the client think it has a valid session?

### 7. WebView State
```json
{
  "webview": {
    "userAgent": "Mozilla/5.0...",
    "language": "en-US",
    "onLine": true,
    "cookieEnabled": true
  }
}
```

**What this tells us:**
- Is the WebView properly configured?
- Are cookies enabled (needed for auth)?
- What's the user agent?

### 8. Memory/Performance
```json
{
  "memory": {
    "usedJSHeapSize": 45000000,
    "totalJSHeapSize": 60000000,
    "jsHeapSizeLimit": 2147483648,
    "usagePercent": 2
  }
}
```

**What this tells us:**
- Is the app running out of memory?
- Could memory pressure be causing issues?

### 9. Pending Requests
```json
{
  "pendingRequests": {
    "recentFetchCount": 3
  }
}
```

**What this tells us:**
- Are there many pending network requests?
- Could the network stack be overwhelmed?
- Are requests queuing up?

## How to Use This Data

### When a Timeout Occurs

Look for the log pattern:
```
🔍 PRE-CALL DIAGNOSTICS: {...}
📞 Calling client.auth.setSession()...
⏱️ Setting up timeout race (3000ms)...
🏁 Starting Promise.race for setSession...
[3 seconds pass]
⏰ setSession timeout fired after 3000ms
🔍 TIMEOUT DIAGNOSTICS: {...}
```

### Compare Before vs Timeout

Compare the PRE-CALL and TIMEOUT diagnostics to see what changed:

**Example Analysis:**
```
PRE-CALL:  network.connected = true
TIMEOUT:   network.connected = false
→ Network dropped during the call!
```

```
PRE-CALL:  session.tokenExpiresIn = 60
TIMEOUT:   session.tokenExpired = true
→ Token expired during the call!
```

```
PRE-CALL:  memory.usagePercent = 85
TIMEOUT:   memory.usagePercent = 95
→ Memory pressure increased!
```

```
PRE-CALL:  pendingRequests.recentFetchCount = 2
TIMEOUT:   pendingRequests.recentFetchCount = 15
→ Network stack is overwhelmed!
```

## Root Causes We Can Now Identify

### 1. Network Issues
- **Symptom:** `network.connected` changes from true to false
- **Root Cause:** Network dropped during auth call
- **Fix:** Add network state monitoring and retry on reconnect

### 2. Token Expiration
- **Symptom:** `session.tokenExpired` is true
- **Root Cause:** Token expired before/during refresh
- **Fix:** Check token expiration before making calls

### 3. Client Corruption
- **Symptom:** `client.hasAuth` is false or `clientSession.checkFailed` is true
- **Root Cause:** Supabase client is in a bad state
- **Fix:** Recreate the client

### 4. Memory Pressure
- **Symptom:** `memory.usagePercent` > 90%
- **Root Cause:** App is running out of memory
- **Fix:** Implement memory cleanup or defer non-critical operations

### 5. Network Stack Overload
- **Symptom:** `pendingRequests.recentFetchCount` is very high (>20)
- **Root Cause:** Too many concurrent requests
- **Fix:** Implement request queuing or throttling

### 6. WebView Issues
- **Symptom:** `webview.cookieEnabled` is false or `webview.onLine` is false
- **Root Cause:** WebView configuration problem
- **Fix:** Check WebView settings and permissions

### 7. Circuit Breaker Interference
- **Symptom:** `circuitBreaker.isOpen` is true
- **Root Cause:** Circuit breaker is blocking calls
- **Fix:** Review circuit breaker thresholds

### 8. Concurrent Refresh Deadlock
- **Symptom:** `inFlight.hasRefreshInFlight` is true
- **Root Cause:** Multiple refreshes are interfering
- **Fix:** Improve single-flight protection

## Testing Instructions

1. **Deploy this version** with diagnostic logging
2. **Wait for a timeout** to occur
3. **Extract the logs** and find the diagnostic JSON
4. **Compare PRE-CALL vs TIMEOUT** diagnostics
5. **Identify the root cause** from the differences
6. **Implement the precise fix** for that specific issue

## Example Log Output

```
🔄 [background-123-abc] 🔍 PRE-CALL DIAGNOSTICS: {
  "callId": "background-123-abc",
  "phase": "setSession-before",
  "timestamp": "2025-11-22T01:43:54.313Z",
  "network": {"connected": true, "connectionType": "wifi"},
  "client": {"exists": true, "isInitialized": true, "hasAuth": true},
  "session": {
    "hasUserId": true,
    "hasAccessToken": true,
    "hasRefreshToken": true,
    "tokenExpiresIn": 3600,
    "tokenExpired": false
  },
  "circuitBreaker": {"failureCount": 0, "isOpen": false},
  "memory": {"usagePercent": 45}
}

[3 seconds later]

🔄 [background-123-abc] 🔍 TIMEOUT DIAGNOSTICS: {
  "callId": "background-123-abc",
  "phase": "setSession-timeout",
  "timestamp": "2025-11-22T01:43:57.315Z",
  "network": {"connected": false, "connectionType": "none"},  ← CHANGED!
  "client": {"exists": true, "isInitialized": true, "hasAuth": true},
  "session": {
    "hasUserId": true,
    "hasAccessToken": true,
    "hasRefreshToken": true,
    "tokenExpiresIn": 3597,
    "tokenExpired": false
  },
  "circuitBreaker": {"failureCount": 0, "isOpen": false},
  "memory": {"usagePercent": 46}
}

→ ROOT CAUSE: Network disconnected during auth call!
```

## Files Modified

- `src/lib/supabasePipeline.ts`
  - Added `captureAuthDiagnostics()` method (140 lines)
  - Added pre-call diagnostic capture for `setSession()`
  - Added pre-call diagnostic capture for `refreshSession()`
  - Added timeout diagnostic capture for both strategies
  - Enhanced error logging with name, message, and stack trace

## Next Steps

1. Deploy and monitor logs
2. When timeout occurs, extract diagnostic JSON
3. Analyze the differences between PRE-CALL and TIMEOUT
4. Identify the specific root cause
5. Implement the precise fix for that issue
6. Repeat until all root causes are identified and fixed

## Benefits

- **No more guessing** - We'll know exactly what's happening
- **Precise fixes** - Fix the actual problem, not symptoms
- **Pattern detection** - Identify if it's always the same issue or multiple issues
- **Data-driven decisions** - Make fixes based on real data, not assumptions
