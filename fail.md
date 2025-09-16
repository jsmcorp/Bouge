# Supabase Session Fetch Timeout Issue - Root Cause Analysis & Fixes

## Issue Summary

**Date**: 2025-09-16  
**Severity**: Critical  
**Impact**: App becomes unusable with constant reconnection loops and session fetch timeouts

## Symptoms Observed

### Primary Symptoms
- Constant `Session fetch timeout` errors in logs
- `getSession() is hanging - client is corrupted` messages
- Repeated hard client recreation cycles
- Multiple GoTrueClient instances warnings
- App stuck in reconnecting/disconnected states

### Log Pattern Example
```
🧪 Corruption check: getSession() is hanging - client is corrupted
🧹 Hard recreating Supabase client (reason=getClient-autoheal)
🔐 Get session failed: Session fetch timeout
🔐 Using last known tokens as fallback
Multiple GoTrueClient instances detected in the same browser context
```

## Root Cause Analysis

### 1. **Primary Issue: `getSession()` Hanging**
- `client.auth.getSession()` calls hang indefinitely in certain conditions
- Particularly occurs after device unlock/app resume events
- WebView network state becomes stale after device sleep/wake cycles

### 2. **Aggressive Corruption Detection**
- System detects hanging `getSession()` as "corruption"
- Triggers hard client recreation every 10 seconds
- Creates cascading failure loop: recreate → hang → recreate

### 3. **Network State Detection Issues**
- `navigator.onLine` doesn't reflect actual network state in WebView
- Capacitor bridge communication delays after device unlock
- WebView DOM state becomes inconsistent after app resume

### 4. **Client Recreation Cascade**
- Hard recreation destroys working client
- New client immediately hangs on first `getSession()` call
- Multiple concurrent GoTrueClient instances created
- Session cache invalidated unnecessarily

## Technical Deep Dive

### Why `getSession()` Hangs
1. **WebView Network State**: After device unlock, WebView network stack may be in inconsistent state
2. **Capacitor Bridge Delays**: Native-to-WebView communication delays cause timeouts
3. **Supabase Client State**: Internal client state becomes corrupted during app lifecycle events

### Corruption Detection Problems
- **Too Aggressive**: 10-second intervals with immediate recreation
- **Wrong Trigger**: Network issues misidentified as corruption
- **No Failure Threshold**: Single timeout triggers full recreation

## Implemented Fixes

### 1. **Enhanced Network State Detection**
**File**: `src/lib/supabasePipeline.ts`
**Method**: `checkNetworkAndWebViewState()`

```typescript
// Before: Simple navigator.onLine check
const online = navigator.onLine;

// After: Comprehensive state validation
const networkState = await this.checkNetworkAndWebViewState();
// Checks: navigator.onLine + Capacitor Network + WebView DOM readiness
```

**Benefits**:
- Detects actual network connectivity vs WebView state
- Validates Capacitor bridge communication
- Prevents operations during WebView instability

### 2. **Session Recovery with Token Fallback**
**File**: `src/lib/supabasePipeline.ts`
**Method**: `fetchSessionInternal()` → Enhanced with `attemptTokenRecovery()`

```typescript
// Before: Direct getSession() call
const result = await client.auth.getSession();

// After: Token recovery first, getSession() fallback
if (this.lastKnownAccessToken && this.lastKnownRefreshToken) {
  const recoveryResult = await this.attemptTokenRecovery();
  if (recoveryResult.success) {
    return { data: { session: recoveryResult.session } };
  }
}
// Only then try getSession() with timeout
```

**Benefits**:
- Avoids hanging `getSession()` calls
- Uses `setSession()` with cached tokens (more reliable)
- Graceful fallback chain: cached tokens → setSession → getSession → fallback session

### 3. **Less Aggressive Corruption Detection**
**File**: `src/lib/supabasePipeline.ts`
**Method**: `isClientCorrupted()` and `getClient()`

```typescript
// Before: Check every 10s, immediate recreation
if (now - this.lastCorruptionCheckAt > 10000) {
  if (corrupted) {
    await this.ensureRecreated('getClient-autoheal');
  }
}

// After: Check every 30s, require multiple failures
if (now - this.lastCorruptionCheckAt > 30000) {
  if (corrupted && this.failureCount >= 3) {
    await this.ensureRecreated('getClient-autoheal');
  }
}
```

**Benefits**:
- Reduces unnecessary client recreations
- Allows transient issues to resolve naturally
- Prevents recreation loops

### 4. **Enhanced WebView State Management**
**File**: `src/lib/supabasePipeline.ts`
**Method**: `validateWebViewState()` and enhanced `onAppResume()`

```typescript
// Before: Fixed 300ms delay
await new Promise(resolve => setTimeout(resolve, 300));

// After: Dynamic delay based on WebView state
const webViewState = await this.validateWebViewState();
const delay = webViewState.isReady && webViewState.bridgeWorking ? 300 : 1000;
await new Promise(resolve => setTimeout(resolve, delay));
```

**Benefits**:
- Validates WebView DOM and Capacitor bridge health
- Conservative recovery when WebView state is problematic
- Prevents operations during bridge communication issues

## Configuration Changes

### Timeout Adjustments
- **Corruption check timeout**: 1.5s → 5s (more lenient)
- **Corruption check frequency**: 10s → 30s (less aggressive)
- **WebView stabilization delay**: 300ms → 1000ms (when issues detected)

### Failure Thresholds
- **Corruption recreation threshold**: 1 failure → 3 failures
- **Session cache validity**: Maintained existing 5-minute cache
- **Circuit breaker**: Existing 5 failures in 60s maintained

## Testing & Validation

### Test Scenarios
1. **Device Lock/Unlock Cycles**: Validate session recovery without recreation
2. **Network Connectivity Changes**: Ensure proper state detection
3. **App Background/Foreground**: Test WebView state validation
4. **Extended Offline Periods**: Verify cached token usage

### Success Metrics
- **Reduced client recreations**: From every 10s to only when necessary
- **Faster session recovery**: Token-based recovery vs network calls
- **Stable connection states**: Fewer disconnected/reconnecting cycles
- **Eliminated recreation loops**: No more cascading failures

## Monitoring & Alerts

### Key Metrics to Monitor
- `🧪 Corruption check` frequency and results
- `🔐 Session fetch timeout` occurrences
- `🧹 Hard recreating Supabase client` events
- `Multiple GoTrueClient instances` warnings

### Alert Thresholds
- **High**: >5 client recreations per hour
- **Medium**: >10 session timeouts per hour
- **Low**: WebView state validation failures

## Future Improvements

### Potential Enhancements
1. **Adaptive Timeout Logic**: Dynamic timeouts based on network conditions
2. **Session Preemptive Refresh**: Refresh before expiration
3. **WebView Health Monitoring**: Continuous WebView state tracking
4. **Metrics Collection**: Detailed failure pattern analysis

### Known Limitations
- Still dependent on Supabase client internal behavior
- WebView state detection may not catch all edge cases
- Token expiration handling could be more sophisticated

## Rollback Plan

If issues persist:
1. **Immediate**: Revert corruption detection frequency to 10s
2. **Short-term**: Disable WebView state validation
3. **Long-term**: Consider Supabase version downgrade to 2.30.0

## Related Documentation
- `supabase_getsession_hang.doc.md` - Original issue documentation
- `supabasefail.md` - Previous fix attempts
- `unlockdebug.md` - Device unlock debugging notes

---
**Last Updated**: 2025-09-16  
**Next Review**: 2025-09-23  
**Owner**: Development Team
