# Fetch Group Members Timeout - Root Cause Analysis

## Problem Statement
When trying to view group members, the app shows:
```
fetch group members failed: Error: fetch group members timeout after 15000ms
```

## Timeline Analysis

```
20:30:21.070 - fetchGroupMembers starts
20:30:21.070 - getClient() called
20:30:21.070 - Background session refresh triggered
20:30:23.907 - Session refresh timeout fires (10s timeout)
20:30:23.935 - Session refresh fails (result=false)
20:30:36.074 - fetchGroupMembers times out (15s total)
```

## Root Cause

### The Core Issue: Unnecessary Session Refresh Blocking API Calls

The problem is a **cascading timeout** caused by an unnecessary session refresh:

1. **fetchGroupMembers** calls `getClient()` to get the Supabase client
2. **getClient()** triggers a background session refresh (line 900-910 in supabasePipeline.ts)
3. The session refresh **times out after 10 seconds** (even though it's "background")
4. The fetchGroupMembers query **never executes** because it's waiting for the client
5. After 15 seconds total, fetchGroupMembers times out

### Why is Session Refresh Happening?

Looking at the logs:
```javascript
// From logs:
timeSinceStart: 1763843423909  // ~20 days since epoch start
lastCorruptionCheck: 13162      // 13 seconds ago
```

The code in `getClient()` (line 900-910):
```typescript
const now = Date.now();
if (now - this.sessionState.lastCorruptionCheck > 30000) {
  this.sessionState.lastCorruptionCheck = now;
  this.log('🔄 getClient() -> triggering background session refresh (app stable >60s)');
  // Fire-and-forget: Start session refresh in background
  this.refreshSessionInBackground().catch(err => {
    this.log('🔄 Background session refresh failed:', err);
  });
}
```

**The session refresh is triggered because it's been >30 seconds since the last check.**

### Why Does Session Refresh Fail?

From the diagnostics:
```javascript
{
  "session": {
    "tokenExpiresIn": 3005,      // Token expires in 50 minutes
    "tokenExpired": false,        // Token is NOT expired
    "consecutiveFailures": 1      // But refresh still fails
  }
}
```

**The token is perfectly valid (50 minutes until expiration), but the refresh is attempted anyway and fails.**

The refresh failure is likely due to:
1. Network latency
2. Supabase internal issues (as documented in LOG41_ANALYSIS.md)
3. The refresh is unnecessary since the token is valid

## The Actual Problem

### Issue #1: "Background" Refresh is Not Actually Background

Despite being called "background refresh", the `getClient()` method is **blocking** the API call:

```typescript
// In fetchGroupMembers (line 2050):
public async fetchGroupMembers(groupId: string): Promise<{ data: any[] | null; error: any }> {
  return this.executeQuery(async () => {
    const client = await this.getClient();  // ⚠️ WAITS for getClient()
    return client
      .from('group_members')
      .select(...)
  }, 'fetch group members', 15000);
}
```

The `await this.getClient()` **waits** for the client to be ready, which includes waiting for any in-flight session refresh.

### Issue #2: Unnecessary Session Refresh

The session refresh is triggered even when:
- Token is valid (50 minutes until expiration)
- User just resumed the app
- No actual auth issue exists

The condition `now - this.sessionState.lastCorruptionCheck > 30000` is too aggressive.

### Issue #3: Single-Flight Lock Blocks All Requests

The `refreshInFlight` lock (line 400-500) ensures only one refresh happens at a time, but this means:
- All API calls wait for the same refresh
- If refresh times out (10s), all API calls are delayed
- The 15s timeout for fetchGroupMembers includes the 10s refresh timeout

## Why This Happens on App Resume

From the logs:
```
20:30:23.935 - ⚠️ App resume: token recovery failed, session may need refresh
20:30:23.937 - ⚠️ Background session refresh failed (will retry on next API call)
```

The app resume flow:
1. App resumes from background
2. Token recovery is attempted (fails after 10s)
3. Next API call (fetchGroupMembers) triggers another refresh
4. That refresh also times out
5. Total delay: 10s + 10s = 20s (but fetchGroupMembers times out at 15s)

## Solutions

### Solution 1: Skip Session Refresh When Token is Valid (RECOMMENDED)

Modify `getClient()` to check token expiration before triggering refresh:

```typescript
private async getClient(): Promise<any> {
  // ... existing checks ...
  
  // Check if token is still valid before refreshing
  if (this.sessionState.cached?.session?.expires_at) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = this.sessionState.cached.session.expires_at;
    const timeUntilExpiry = expiresAt - nowSec;
    
    // Only refresh if token expires in less than 5 minutes
    if (timeUntilExpiry > 300) {
      this.log(`🔑 getClient() -> token valid for ${timeUntilExpiry}s, skipping refresh`);
      return this.client!;
    }
  }
  
  // ... rest of refresh logic ...
}
```

### Solution 2: Make Background Refresh Truly Non-Blocking

Don't wait for `getClient()` in API calls when client already exists:

```typescript
private async getClient(): Promise<any> {
  // If client exists and is initialized, return immediately
  if (this.client && this.isInitialized) {
    // Start refresh in background WITHOUT blocking
    this.maybeRefreshInBackground();
    return this.client!;
  }
  
  // ... rest of initialization logic ...
}

private maybeRefreshInBackground(): void {
  // Fire-and-forget refresh check
  const now = Date.now();
  if (now - this.sessionState.lastCorruptionCheck > 30000) {
    this.sessionState.lastCorruptionCheck = now;
    this.refreshSessionInBackground().catch(() => {});
  }
}
```

### Solution 3: Increase Timeout for fetchGroupMembers

This is a **band-aid** solution but can help immediately:

```typescript
// Current (line 2050):
public async fetchGroupMembers(groupId: string): Promise<{ data: any[] | null; error: any }> {
  return this.executeQuery(async () => {
    // ...
  }, 'fetch group members', 15000);  // 15 seconds
}

// Increase to 30 seconds:
public async fetchGroupMembers(groupId: string): Promise<{ data: any[] | null; error: any }> {
  return this.executeQuery(async () => {
    // ...
  }, 'fetch group members', 30000);  // 30 seconds
}
```

**This doesn't fix the root cause but gives more time for the refresh to complete.**

### Solution 4: Use Cached Client Without Refresh Check

Add a `getClientFast()` method that skips all refresh checks:

```typescript
private async getClientFast(): Promise<any> {
  if (!this.client || !this.isInitialized) {
    await this.initialize();
  }
  return this.client!;
}

// Use in fetchGroupMembers:
public async fetchGroupMembers(groupId: string): Promise<{ data: any[] | null; error: any }> {
  return this.executeQuery(async () => {
    const client = await this.getClientFast();  // Skip refresh checks
    return client
      .from('group_members')
      .select(...)
  }, 'fetch group members', 15000);
}
```

## Recommended Fix

**Implement Solution 1 + Solution 2:**

1. Check token expiration before triggering refresh
2. Make background refresh truly non-blocking
3. Only refresh when token is actually expiring (< 5 minutes)

This will:
- Eliminate unnecessary refreshes
- Prevent blocking API calls
- Maintain session freshness when needed
- Fix the timeout issue

## Testing Plan

1. **Test app resume with valid token:**
   - Resume app
   - Immediately try to view group members
   - Should load instantly without refresh

2. **Test with expiring token:**
   - Wait until token has < 5 minutes left
   - Try to view group members
   - Should refresh in background without blocking

3. **Test with expired token:**
   - Let token expire completely
   - Try to view group members
   - Should refresh and then load (may take longer)

## Files to Modify

1. `src/lib/supabasePipeline.ts` - Lines 880-920 (getClient method)
2. Consider adding `getClientFast()` for read-only operations
