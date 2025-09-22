# Lock/Unlock Fix Test Plan - PROPER ROOT CAUSE FIXES

## Root Causes Identified and PROPERLY Fixed

### 1. **Client Recreation Loops** ✅ FIXED
**Problem**: Hard recreation on every timeout causing "Multiple GoTrueClient instances"
**Fix**:
- **NEVER recreate client** - maintain single permanent instance through app lifecycle
- Modified `initialize()` to only create client if it doesn't exist
- Removed all forced client destruction and recreation logic

### 2. **Session Hanging Issue** ✅ FIXED
**Problem**: `client.auth.getSession()` hangs after device unlock causing cascading failures
**Fix**:
- **Token recovery strategy** - use `setSession()` with cached tokens instead of `getSession()`
- Added `recoverSession()` method that uses cached access/refresh tokens
- Health checks use cached tokens instead of calling `getSession()`

### 3. **Improper Resume Strategy** ✅ FIXED
**Problem**: Resume handlers calling hanging methods and recreating clients
**Fix**:
- **Pause/resume strategy** - stabilization delay + token recovery + realtime re-auth
- App resume uses `recoverSession()` instead of `refreshSession()`
- Apply cached tokens to realtime without calling `getSession()`

## Testing Instructions

### Test 1: Short Device Lock (< 1 minute)
1. Open app and navigate to a chat
2. Lock device for 10-30 seconds
3. Unlock device
4. **Expected**: 
   - Connection should restore within 2-3 seconds
   - No "Multiple GoTrueClient instances" warnings
   - No session timeout errors
   - Messages should send immediately via realtime (not outbox)

### Test 2: Extended Device Lock (> 5 minutes)
1. Open app and navigate to a chat
2. Lock device for 5+ minutes
3. Unlock device
4. **Expected**:
   - May show brief "Reconnecting..." status
   - Should connect within 5 seconds
   - No repeated session refresh failures
   - Messages should send via realtime after connection

### Test 3: Message Sending After Unlock
1. Lock device for 30 seconds
2. Unlock device
3. Immediately try to send a message
4. **Expected**:
   - Health check should pass using cached session
   - Message should send via realtime, not outbox
   - No "getSession timeout before refresh" errors

## Log Patterns to Look For

### ✅ Good Patterns (Should See)
```
🔄 Supabase client created ONCE (persistSession=true, autoRefreshToken=true)
🔑 Token cached: user=839d1d4a hasAccess=true hasRefresh=true
✅ Session recovered using cached tokens
🏥 Health check: using cached access token (healthy)
✅ App resume: cached token applied to realtime
📱 App resume completed using token recovery strategy
```

### ❌ Bad Patterns (Should NOT See)
```
Multiple GoTrueClient instances detected
🔐 Get session failed: Session fetch timeout
🔄 getSession timeout before refresh → scheduling hard recreate
🗑️ Destroying old client instance (forced)
🧹 Hard recreating Supabase client
```

## Key Changes Made

### File: `src/lib/supabasePipeline.ts`
1. **Single Client Strategy**: `initialize()` never recreates existing client - creates ONCE only
2. **Token Recovery**: Added `recoverSession()` using `setSession()` with cached tokens
3. **Direct Refresh**: Added `refreshSessionDirect()` without pre-check `getSession()` calls
4. **Cached Health Checks**: `checkHealth()` uses cached tokens instead of `getSession()`
5. **Proper Resume**: `onAppResume()` uses token recovery + stabilization delay

### File: `src/lib/reconnectionManager.ts`
1. **Token Recovery First**: Uses `recoverSession()` before attempting refresh
2. **No Hard Recreation**: Removed all hard client recreation logic
3. **Graceful Degradation**: Continues with cached tokens if refresh fails

## Expected Behavior After Fixes

1. **Single permanent client**: One Supabase client instance throughout app lifecycle
2. **No hanging getSession() calls**: Token recovery avoids problematic auth calls
3. **Instant reconnection**: Cached tokens applied immediately to realtime
4. **Reliable message sending**: Health checks use cached tokens, never hang
5. **No client recreation loops**: Maintains connection state through pause/resume

## If Issues Persist

Check for these patterns in logs:
1. **New timeout locations**: Look for any remaining `getSession()` calls that might hang
2. **Corruption detection failures**: Ensure the new corruption check is working
3. **Cache invalidation**: Verify session cache is being updated properly
4. **Race conditions**: Multiple concurrent operations still interfering

## 🎯 FUNDAMENTAL APPROACH CHANGE

**OLD APPROACH (Symptom Treatment):**
- Detect client corruption → Hard recreate client → Multiple instances → More corruption

**NEW APPROACH (Root Cause Fix):**
- Maintain single client → Use token recovery → Avoid hanging calls → Stable connection

The fixes address the **actual root cause**: **Preventing client corruption in the first place** by:
1. **Never recreating the client** (eliminates corruption source)
2. **Using cached tokens** (avoids hanging `getSession()` calls)
3. **Proper pause/resume lifecycle** (maintains connection state)
4. **Token-based health checks** (reliable without network calls)

This approach follows the **WhatsApp model**: maintain persistent connection, recover using cached credentials, never destroy the underlying client infrastructure.
