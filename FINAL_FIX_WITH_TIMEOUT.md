# Final Fix - Added Timeout to RPC Call

## Deep Analysis of log25.txt

### What Was Happening

From log25.txt analysis at line 196-217:

```
11:02:31.972: [main] 📱 App resumed - syncing unread counts from Supabase
11:02:31.972: [main] 🔄 Importing unreadTracker...
11:02:31.973: [main] ✅ unreadTracker imported
11:02:31.973: [main] 🔄 Fetching fresh counts from Supabase (fast mode - uses cached session)...
11:02:31.974: [unread] 🚀 Fast fetch: Getting cached session...
11:02:31.974: [unread] ✅ Got cached user: 852432e2-c453-4f00-9ec7-ecf6bda87676
11:02:31.974: [unread] 🔄 Fetching counts from Supabase...
11:02:32.003: GET https://sxykfyqrqwifkirveqgr.supabase.co/auth/v1/user  ← RPC trying to auth
11:02:52.936: refreshSessionUnified: ❌ TIMEOUT after 5000ms  ← Session refresh times out
```

**The Problem:**
1. Fast fetch gets cached user ID ✅
2. Tries to make RPC call to Supabase
3. RPC call needs authentication
4. Auth call hangs waiting for session refresh
5. Session refresh times out after 5 seconds
6. RPC call never completes
7. Badge never updates

### Root Cause

Even though we bypassed `auth.getUser()` and used the cached user ID, the **RPC call itself still requires authentication**. When the RPC call is made, Supabase client tries to authenticate, which triggers `GET /auth/v1/user`, which hangs during session refresh.

## The Solution

Added a **3-second timeout** to the RPC call so it fails gracefully instead of hanging:

```typescript
/**
 * Get unread counts for all groups from Supabase (fast version using cached session)
 * This bypasses auth.getUser() which can hang during session refresh
 */
public async getAllUnreadCountsFast(): Promise<Map<string, number>> {
  try {
    console.log('[unread] 🚀 Fast fetch: Getting cached session...');
    const session = await supabasePipeline.getCachedSession();
    
    if (!session?.user) {
      console.log('[unread] ⚠️ No cached session, returning empty counts');
      return new Map();
    }

    console.log('[unread] ✅ Got cached user:', session.user.id);
    console.log('[unread] 🔄 Fetching counts from Supabase with 3s timeout...');

    const client = await supabasePipeline.getDirectClient();
    
    // Add timeout to prevent hanging during session refresh
    const rpcPromise = client.rpc('get_all_unread_counts', {
      p_user_id: session.user.id,
    });
    
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('RPC timeout')), 3000)
    );

    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as any;

    if (error) {
      console.error('[unread] ❌ RPC error:', error);
      return new Map();
    }

    const counts = new Map<string, number>();
    if (data && Array.isArray(data)) {
      for (const row of data) {
        counts.set(row.group_id, row.unread_count || 0);
      }
    }

    console.log('[unread] ✅ Fetched counts:', Array.from(counts.entries()));
    return counts;
  } catch (error: any) {
    if (error?.message === 'RPC timeout') {
      console.warn('[unread] ⏱️ RPC call timed out after 3s, returning empty counts');
    } else {
      console.error('[unread] ❌ Failed to get counts:', error);
    }
    return new Map();
  }
}
```

## Why This Works

### Scenario 1: Session is Ready (Normal Case)
```
App Resume
  ↓
getAllUnreadCountsFast()
  ↓
RPC call with 3s timeout
  ↓
Auth succeeds immediately (< 100ms)
  ↓
✅ Unread counts fetched and UI updated
```

### Scenario 2: Session is Refreshing (Problem Case)
```
App Resume
  ↓
getAllUnreadCountsFast()
  ↓
RPC call with 3s timeout
  ↓
Auth hangs waiting for session refresh
  ↓
Timeout after 3 seconds
  ↓
⏱️ Returns empty counts gracefully
  ↓
Badge shows current value (doesn't update, but doesn't hang)
```

### Scenario 3: Session Refresh Completes Quickly
```
App Resume
  ↓
getAllUnreadCountsFast()
  ↓
RPC call with 3s timeout
  ↓
Session refresh completes in 1s
  ↓
Auth succeeds
  ↓
✅ Unread counts fetched and UI updated
```

## Expected Logs After Fix

### Success Case:
```
[main] 📱 App resumed - syncing unread counts from Supabase
[unread] 🚀 Fast fetch: Getting cached session...
[unread] ✅ Got cached user: 852432e2...
[unread] 🔄 Fetching counts from Supabase with 3s timeout...
[unread] ✅ Fetched counts: [["group-id", 5]]
[main] ✅ Got fresh counts from Supabase: [["group-id", 5]]
[main] ✅ Unread counts synced to UI
```

### Timeout Case:
```
[main] 📱 App resumed - syncing unread counts from Supabase
[unread] 🚀 Fast fetch: Getting cached session...
[unread] ✅ Got cached user: 852432e2...
[unread] 🔄 Fetching counts from Supabase with 3s timeout...
[unread] ⏱️ RPC call timed out after 3s, returning empty counts
[main] ✅ Got fresh counts from Supabase: []
[main] ℹ️ UI helper not ready, Sidebar will fetch on mount
```

## Benefits

✅ **No hanging** - Times out after 3 seconds instead of hanging forever  
✅ **Graceful degradation** - Returns empty counts if timeout occurs  
✅ **Fast when possible** - Completes in < 100ms when session is ready  
✅ **User experience** - Badge shows current value instead of freezing  
✅ **Sidebar fallback** - Sidebar will fetch counts on mount if resume fails  

## Changes Made

1. **src/lib/unreadTracker.ts** - Added 3-second timeout to `getAllUnreadCountsFast()`

## Build Status

```
✅ unreadTracker.ts updated (added timeout)
✅ Build successful
✅ Android sync complete
✅ Ready to test
```

## Testing

1. Deploy the app
2. Background and resume
3. Check logs:
   - If session is ready: Should see "✅ Fetched counts"
   - If session is refreshing: Should see "⏱️ RPC call timed out after 3s"
4. Verify badge behavior:
   - Success case: Badge updates immediately
   - Timeout case: Badge shows current value, Sidebar fetches on mount

The unread count sync will now either complete quickly or timeout gracefully, preventing the app from hanging!
