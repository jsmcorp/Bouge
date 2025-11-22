# Final Storage Fix - Disable autoRefreshToken

## The Real Problem

Even with your custom storage adapter, **Supabase's `autoRefreshToken: true` is causing the hang**.

### What's Happening:
1. Your custom storage adapter works perfectly (< 1ms operations) ✅
2. But Supabase's GoTrueClient has **internal refresh logic** that runs independently
3. That internal logic calls `refreshSession()` which has its own timeout/blocking issues
4. Your logs show: `refreshSession TIMEOUT after 15550ms (10000ms limit)`

### The Evidence:
```
02:16:11.945  Calling client.auth.refreshSession...
02:16:21.951  refreshSession TIMEOUT after 15550ms
```

This is **Supabase's internal refresh**, not your manual refresh.

## The Solution

**Disable `autoRefreshToken` and handle refresh manually with proper timeout control.**

### Why This Works:
1. Removes Supabase's internal refresh logic that's causing hangs
2. You already have manual refresh logic in `refreshSessionUnified()`
3. Your manual refresh has proper timeout handling (5-10s)
4. You control when and how refresh happens

## Implementation

### Change in `src/lib/supabasePipeline.ts`

```typescript
this.client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,
    persistSession: true,
    autoRefreshToken: false,  // ✅ DISABLE - we handle refresh manually
    detectSessionInUrl: false,
  },
  // ... rest of config
});
```

### Add Manual Refresh Check

After disabling autoRefreshToken, add a check in `getClient()` to manually refresh when needed:

```typescript
private async getClient(): Promise<any> {
  // ... existing initialization checks ...
  
  // Manual token refresh check (since autoRefreshToken is disabled)
  if (this.sessionState.cached?.session?.expires_at) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = this.sessionState.cached.session.expires_at;
    const timeUntilExpiry = expiresAt - nowSec;
    
    // Refresh if token expires in < 5 minutes
    if (timeUntilExpiry < 300 && timeUntilExpiry > 0) {
      this.log(`🔑 Token expires in ${timeUntilExpiry}s, refreshing...`);
      // Fire-and-forget refresh
      this.refreshSessionUnified({ timeout: 5000, background: true }).catch(() => {});
    }
  }
  
  return this.client!;
}
```

## Expected Results

### Before (autoRefreshToken: true):
```
Supabase internal refresh triggers
  ↓
Calls refreshSession() internally
  ↓
Hangs for 10-15 seconds
  ↓
Timeout
  ↓
All API calls blocked
```

### After (autoRefreshToken: false):
```
Your code controls refresh
  ↓
Calls refreshSessionUnified() with 5s timeout
  ↓
Completes in 200-500ms OR times out cleanly
  ↓
API calls proceed
```

## Trade-offs

### Pros:
- ✅ No more internal Supabase refresh hangs
- ✅ Full control over refresh timing and timeout
- ✅ Faster, more predictable behavior
- ✅ Your existing refresh logic is already robust

### Cons:
- ❌ Must manually trigger refresh (but you already do this)
- ❌ Token might expire if not refreshed in time (but you have checks)

## Testing

1. **Disable autoRefreshToken**
2. **Test app resume** - should load instantly
3. **Test group members** - should load instantly
4. **Monitor logs** - should see no more "refreshSession TIMEOUT"
5. **Test token expiry** - manually trigger refresh before expiry

## Alternative: Increase Supabase's Internal Timeout

If you want to keep `autoRefreshToken: true`, you could try increasing Supabase's internal timeout, but this is not officially supported and may not work.

## Recommendation

**Disable `autoRefreshToken` and use manual refresh.** You already have the infrastructure for this, and it gives you full control.
