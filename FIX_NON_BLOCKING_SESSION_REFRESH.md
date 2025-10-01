# Fix: Non-Blocking Session Refresh

## Problem

After keeping the phone idle for 30+ seconds, the first message sent takes **exactly 10 seconds** to send, causing a "SEND_STALLED_BUG" error.

### Root Cause

**File**: `src/lib/supabasePipeline.ts`

**The blocking code** (lines 375-399):

```typescript
private async getClient(): Promise<any> {
  // ...
  const now = Date.now();
  if (now - this.lastCorruptionCheckAt > 30000) {
    this.lastCorruptionCheckAt = now;
    const corrupted = await this.isClientCorrupted(); // ❌ BLOCKS HERE
    // ...
  }
  return this.client!;
}
```

**What `isClientCorrupted()` does** (line 639):

```typescript
const { data, error } = await this.client.auth.setSession({
  access_token: this.lastKnownAccessToken,
  refresh_token: this.lastKnownRefreshToken
}); // ❌ THIS TAKES 10 SECONDS AFTER IDLE
```

### Timeline from log20.txt

```
22:08:33.128 [send-xxx] pre-network: acquiring full client (≤10000ms)
22:08:33.128 🔑 getClient() called
              ⬇️ getClient() calls isClientCorrupted()
              ⬇️ isClientCorrupted() calls await setSession()
              ⬇️ setSession() makes network request to refresh session
              ⬇️ Network request takes 10 seconds
22:08:43.101 [TERMINAL] SEND_STALLED_BUG (exactly 10 seconds later)
```

---

## Why Previous Fix Didn't Work

**Previous fix**: Increased timeout from 5 seconds to 10 seconds

**Why it failed**: This just delayed the problem. The real issue is that `getClient()` is **blocking** on session refresh, which takes 10 seconds. Increasing the timeout to 10 seconds means the message waits the full 10 seconds before timing out.

---

## The Correct Solution: Non-Blocking Session Refresh

### Pros & Cons Analysis

#### Non-Blocking Approach (NEW)

**PROS:**
- ✅ **Instant message sends** - No waiting for session refresh
- ✅ **Better UX** - No 10-second delays or "stalled" messages
- ✅ **Background refresh** - Session updates while message is being sent
- ✅ **Outbox handles failures** - If session is invalid, outbox retries after refresh
- ✅ **Leverages existing architecture** - Outbox system already designed for this

**CONS:**
- ⚠️ First message might fail if session is truly expired (but outbox handles it gracefully)
- ⚠️ Slightly more complex code (but worth it for UX)

#### Blocking Approach (OLD)

**PROS:**
- ✅ Ensures session is valid before sending
- ✅ Simpler logic

**CONS:**
- ❌ **10-second delay** for first message after idle (TERRIBLE UX)
- ❌ User sees "SEND_STALLED_BUG" messages
- ❌ **Outbox is used anyway**, making the blocking check redundant!
- ❌ Doesn't leverage the outbox system that's already built for handling failures

---

## Implementation

### Changes Made

**File**: `src/lib/supabasePipeline.ts`

**1. Modified `getClient()` to be non-blocking** (lines 375-399):

```typescript
/**
 * Get the current client instance, initializing if needed
 * NON-BLOCKING: Returns client immediately, refreshes session in background
 */
private async getClient(): Promise<any> {
  this.log(`🔑 getClient() called - hasClient=${!!this.client} isInitialized=${this.isInitialized} initPromiseActive=${!!this.initializePromise}`);
  if (!this.client || !this.isInitialized) { this.log('🔑 getClient() -> calling initialize()'); await this.initialize(); }
  
  // NON-BLOCKING session refresh: Start in background, don't wait for it
  // This prevents 10-second delays when session needs refreshing after idle
  try {
    const now = Date.now();
    if (now - this.lastCorruptionCheckAt > 30000) {
      this.lastCorruptionCheckAt = now;
      // Fire-and-forget: Start session refresh in background
      this.refreshSessionInBackground().catch(err => {
        this.log('🔄 Background session refresh failed:', err);
      });
    }
  } catch {}
  
  // Return client immediately without waiting for session refresh
  return this.client!;
}
```

**2. Added new `refreshSessionInBackground()` method**:

```typescript
/**
 * Non-blocking session refresh - runs in background
 */
private async refreshSessionInBackground(): Promise<void> {
  try {
    if (!this.client?.auth) return;
    
    // If we have cached tokens, try to refresh with them
    if (this.lastKnownAccessToken && this.lastKnownRefreshToken) {
      this.log('🔄 Starting background session refresh with cached tokens');
      const { data, error } = await this.client.auth.setSession({
        access_token: this.lastKnownAccessToken,
        refresh_token: this.lastKnownRefreshToken
      });
      
      if (!error && data?.session) {
        this.log('✅ Background session refresh successful');
        // Update cached tokens
        this.lastKnownAccessToken = data.session.access_token;
        this.lastKnownRefreshToken = data.session.refresh_token;
      } else {
        this.log('⚠️ Background session refresh failed, will retry on next attempt');
      }
    }
  } catch (error) {
    this.log('❌ Background session refresh error:', error);
  }
}
```

### Key Changes

1. **Removed blocking `await`** - `getClient()` no longer waits for `isClientCorrupted()`
2. **Fire-and-forget pattern** - Session refresh starts in background with `.catch()` handler
3. **Immediate return** - Client is returned instantly without waiting
4. **Background refresh** - Session updates happen asynchronously
5. **Error handling** - Background refresh failures are logged but don't block sends

---

## Expected Behavior After Fix

### Before Fix (Blocking)

```
User sends message after idle
  ⬇️
getClient() called
  ⬇️
Waits for session refresh (10 seconds)
  ⬇️
Timeout after 10 seconds
  ⬇️
Message goes to outbox
  ⬇️
Outbox delivers message
  ⬇️
Total time: 10+ seconds
```

### After Fix (Non-Blocking)

```
User sends message after idle
  ⬇️
getClient() called
  ⬇️
Returns client immediately (0ms)
  ⬇️
Session refresh starts in background
  ⬇️
Message sends directly (or goes to outbox if session invalid)
  ⬇️
Background refresh completes
  ⬇️
Next message uses refreshed session
  ⬇️
Total time: <1 second for message send
```

---

## Testing Instructions

### Test 1: Idle Phone Scenario

1. **Setup**:
   ```bash
   npm run build && npx cap sync
   npx cap run android
   ```

2. **Test Steps**:
   - Open the app and navigate to a group chat
   - Keep phone idle (don't interact) for 2-3 minutes
   - Send a message
   - Observe the logs

3. **Expected Results**:
   - ✅ Log shows: `🔑 getClient() called`
   - ✅ Log shows: `🔄 Starting background session refresh with cached tokens`
   - ✅ Message sends **immediately** (within 1 second)
   - ✅ Log shows: `✅ Direct send successful` OR message goes to outbox and delivers quickly
   - ✅ Log shows: `✅ Background session refresh successful` (a few seconds later)
   - ✅ **NO** "SEND_STALLED_BUG" errors

4. **Failure Indicators**:
   - ❌ Log shows: `[TERMINAL] SEND_STALLED_BUG`
   - ❌ Message takes 10 seconds to send
   - ❌ No background refresh logs

### Test 2: Rapid Messages After Idle

1. **Test Steps**:
   - Keep phone idle for 2-3 minutes
   - Send 3 messages rapidly (one after another)
   - Observe the logs

2. **Expected Results**:
   - ✅ First message triggers background refresh
   - ✅ All 3 messages send quickly (within 1-2 seconds each)
   - ✅ Background refresh completes while messages are sending
   - ✅ No delays or stalls

### Test 3: Session Truly Expired

1. **Test Steps**:
   - Keep phone idle for 10+ minutes (to expire session)
   - Send a message
   - Observe the logs

2. **Expected Results**:
   - ✅ Message attempts direct send
   - ✅ Direct send fails (session expired)
   - ✅ Message goes to outbox
   - ✅ Background refresh completes
   - ✅ Outbox delivers message successfully
   - ✅ Total time: 2-3 seconds (much better than 10+ seconds)

---

## Log Patterns to Look For

### Success Patterns (After Fix)

```
🔑 getClient() called - hasClient=true isInitialized=true
🔄 Starting background session refresh with cached tokens
[send-xxx] using full client
[send-xxx] fast-path: using direct REST upsert
✅ Direct send successful - message xxx
✅ Background session refresh successful
```

### Failure Patterns (Should NOT See These)

```
[TERMINAL] SEND_STALLED_BUG id=xxx
Direct send timeout after 10000ms
```

---

## Why This Is The Right Solution

1. **Leverages Existing Architecture**: The outbox system is already designed to handle failures. There's no benefit to blocking message sends waiting for session refresh.

2. **Better UX**: Users get instant feedback. Messages send immediately, and if there's a session issue, the outbox handles it gracefully.

3. **Follows Best Practices**: Fire-and-forget pattern for non-critical background tasks is a standard approach in mobile apps.

4. **Minimal Risk**: If session is truly expired, the message goes to outbox (which was happening anyway with the blocking approach). The only difference is it happens faster.

5. **Scalable**: This pattern works well even if session refresh takes longer than 10 seconds (e.g., slow network).

---

## Rollback Instructions

If this causes issues, revert with:

```bash
git checkout src/lib/supabasePipeline.ts
npm run build && npx cap sync && npx cap run android
```

Or manually revert by restoring the blocking `await this.isClientCorrupted()` call in `getClient()`.

---

## Files Modified

1. ✅ `src/lib/supabasePipeline.ts` - Made `getClient()` non-blocking, added `refreshSessionInBackground()`
2. ✅ `FIX_NON_BLOCKING_SESSION_REFRESH.md` - This documentation

---

## Next Steps

1. **Build and test**: `npm run build && npx cap sync && npx cap run android`
2. **Test idle scenario**: Keep phone idle for 2-3 minutes, send message
3. **Collect logs**: Save logs to `log21.txt` for verification
4. **Verify no SEND_STALLED_BUG errors**
5. **Verify messages send instantly** (within 1 second)

