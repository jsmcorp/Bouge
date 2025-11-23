# Test Guide: Session Refresh Skip Fix

## What Was Fixed

Two critical improvements to eliminate unnecessary `/user` API calls:

1. **Short-circuit in `getClient()`** - Skips auth calls when token is valid for 5+ minutes
2. **Proper session caching** - Auth listener now caches full session with `expires_at`

## How to Test

### Step 1: Sign In
1. Open the app and sign in with OTP
2. **Look for this log:**
   ```
   ✅ Cached full session, expires at: 2025-11-24T01:05:28Z (59 minutes)
   ```
3. ✅ **Pass:** You see the expiration time logged
4. ❌ **Fail:** No expiration log appears

### Step 2: Navigate Around (CRITICAL TEST)
1. Navigate to different screens (messages, contacts, etc.)
2. **Look for this log on each navigation:**
   ```
   🚀 [direct-xxx] Token valid for 3582s (59min), skipping ALL refresh logic
   🔄 [direct-xxx] ✅ SHORT-CIRCUIT SUCCESS in 2ms (no network calls)
   ```
3. **Make sure you DON'T see:**
   ```
   ❌ Calling client.auth.setSession()
   ❌ setSession TIMEOUT
   ❌ Falling through to Strategy 2
   ❌ Calling client.auth.refreshSession()
   ❌ refreshSession TIMEOUT
   ```
4. ✅ **Pass:** You see short-circuit logs, operations complete in < 1 second
5. ❌ **Fail:** You see Strategy 1/2 logs or operations take > 2 seconds

### Step 3: Check Network Tab
1. Open browser DevTools → Network tab
2. Filter for requests to your Supabase URL
3. Navigate around the app for 1-2 minutes
4. ✅ **Pass:** NO `/user` or `/token` calls appear (except on initial sign-in)
5. ❌ **Fail:** You see repeated `/user` calls

### Step 4: Performance Check
1. Time how long it takes to:
   - Open a conversation
   - Load contacts list
   - Send a message
2. ✅ **Pass:** Operations complete in < 1 second
3. ❌ **Fail:** Operations take 2-5+ seconds (indicates auth delays)

## Expected Results

### Before Fix
- `/user` calls on every operation
- 2-5 second delays
- Potential timeouts
- Logs show: `refreshSession()` calls frequently

### After Fix
- **Zero** `/user` calls during normal operation
- < 1 second response times
- No timeouts
- Logs show: `🚀 Using cached session, skipping /user call`

## Troubleshooting

### If you don't see the expiration log:
- Check that `updateSessionCache()` is being called
- Verify the auth listener is attached
- Look for any errors in the console

### If you still see /user calls:
- Check if token is actually cached: look for `sessionState.cached.session`
- Verify `expires_at` is present in the cached session
- Check if token has < 5 minutes remaining (will trigger refresh)

### If operations are still slow:
- Check network tab for other slow requests
- Look for unrelated performance issues
- Verify the short-circuit logic is executing (check logs)

## Success Criteria

✅ Session expiration logged on sign-in  
✅ "Using cached session" log on subsequent calls  
✅ Zero /user calls in network tab  
✅ Operations complete in < 1 second  
✅ No timeout errors  

## Timeline

- **First 60 seconds after sign-in:** May see some refresh activity (normal)
- **After 60 seconds:** Should see consistent "Using cached session" logs
- **Token expires in < 5 min:** Background refresh triggered (non-blocking)
- **Token expired:** Background refresh triggered (non-blocking)
