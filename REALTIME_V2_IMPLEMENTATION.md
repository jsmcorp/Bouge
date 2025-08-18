# Realtime Connection V2 - Simplified Implementation

## Summary

Implemented a simplified, event-driven realtime connection system to fix the "stuck in reconnecting" issue when users lock/unlock their phones.

## Key Changes

### 1. Feature Flag Implementation
- Added `VITE_SIMPLIFIED_REALTIME` environment variable (defaults to `true`)
- Enables safe rollout and easy rollback to legacy implementation
- Set in `src/lib/supabase.ts`

### 2. Simplified Auth Flow
- **Removed**: Complex `ensureAuthBeforeSubscribe` with manual token refresh
- **Added**: Simple session check that lets Supabase handle auth details
- **Result**: Eliminates auth deadlocks and stuck states

### 3. Streamlined Reconnection Logic
- **Removed**: Complex `coalesceReconnect` with exponential backoff and multiple timers
- **Added**: Simple 3-second retry with max 3 attempts
- **Result**: Faster reconnection (3s vs 15+ seconds) and no infinite retry loops

### 4. Event-Driven Connection Management
- **Added**: Auth state listener that triggers reconnection on `TOKEN_REFRESHED`
- **Added**: Force reconnection on app resume (phone unlock)
- **Result**: Automatic reconnection when tokens are refreshed by Supabase

### 5. Eliminated Race Conditions
- **Removed**: `isResuming`, `authRefreshInProgress`, and other blocking flags
- **Added**: Simple connection token system to ignore stale callbacks
- **Result**: No more stuck states from overlapping operations

## Implementation Details

### New Methods Added

#### `realtimeActions.ts`
- `setupSimplifiedRealtimeSubscription()` - New simplified subscription logic
- `forceReconnect()` - Clean reconnection without complex logic
- `setupAuthListener()` - Event-driven auth state monitoring

#### `stateActions.ts`
- `onAppResumeSimplified()` - Force fresh connection on app resume
- `onNetworkOnlineSimplified()` - Faster network recovery (500ms vs 1000ms)

### Key Improvements

1. **Faster Connection**: 3-second timeout vs 15+ seconds
2. **Force Fresh on Resume**: Always creates new connection when phone unlocked
3. **Event-Driven**: Uses Supabase auth events instead of manual checking
4. **Max Retry Limit**: Prevents infinite reconnection attempts
5. **Simplified Logging**: Clear `[realtime-v2]` prefix for debugging

## Configuration

### Enable/Disable Feature
```bash
# Enable (default)
VITE_SIMPLIFIED_REALTIME=true

# Disable (use legacy)
VITE_SIMPLIFIED_REALTIME=false
```

### Monitoring
- All logs prefixed with `[realtime-v2]` for easy filtering
- Connection attempts limited to 3 retries max
- Clear status reporting in logs only (not UI)

## Testing Scenarios

The new implementation should handle:

1. **Phone Lock/Unlock**: Force fresh connection on app resume
2. **Network Loss/Recovery**: Fast reconnection within 3 seconds
3. **Token Refresh**: Automatic reconnection on auth events
4. **App Background/Foreground**: Clean state management
5. **Multiple Rapid Events**: No race conditions or stuck states

## Rollback Plan

If issues occur, simply set:
```bash
VITE_SIMPLIFIED_REALTIME=false
```

This will revert to the legacy implementation without code changes.
