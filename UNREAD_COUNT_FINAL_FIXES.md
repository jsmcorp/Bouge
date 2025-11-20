# Unread Count - Final Fixes for Remaining Issues

## Issues Identified

### ✅ Issue 1: Foreground Increments Working
**Status:** SOLVED ✅  
**Evidence:** Logs show native → JS bridge → increment → UI update working correctly

### ❌ Issue 2: Background Messages Don't Increment
**Status:** BROKEN ❌  
**Problem:** When app is backgrounded, JavaScript is paused, so native FCM service can't notify JS  
**Impact:** Unread counts don't increment while app is in background

### ❌ Issue 3: `markGroupAsRead` Not Persisting to Supabase
**Status:** BROKEN ❌  
**Problem:** RPC call is failing with error (logs show `[unread] Error marking group as read in Supabase`)  
**Impact:** After restart, `get_all_unread_counts` returns stale high values (like 15) instead of 0

## Root Causes

### Issue 2: Background Increment Problem
When app is backgrounded:
1. JavaScript execution is paused by Android
2. Native FCM service receives message and writes to SQLite
3. Native tries to call `NativeEventsPlugin.notifyNewMessage()` but JS is paused
4. No increment happens
5. On app resume, only way to get correct count is from Supabase RPC

**Solution:** Native service should track increments in SharedPreferences when JS is unavailable, then sync on app resume.

### Issue 3: Mark as Read RPC Failing
Logs show:
```
POST https://sxykfyqrqwifkirveqgr.supabase.co/rest/v1/rpc/mark_group_as_read
[unread] Error marking group as read in Supabase: [object Object]
```

**Possible Causes:**
1. RPC function doesn't exist in Supabase
2. Permission denied (RLS policy issue)
3. Invalid parameters (UUID format issue)
4. Network error

**Solution:** Add detailed error logging and verify RPC function exists.

## Fixes Applied

### Fix 1: Improved Error Logging for mark_group_as_read

**File:** `src/lib/unreadTracker.ts`

**Before:**
```typescript
if (error) {
  console.error('[unread] Mark as read error:', error);
  return false;
}
```

**After:**
```typescript
if (error) {
  console.error('[unread] ❌ Mark as read RPC error:', {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
  return false;
}
```

This will show the exact error from Supabase so we can diagnose the issue.

## Fixes Needed

### Fix 2: Background Unread Tracking (Native Side)

**Problem:** When app is backgrounded, JS can't receive native events.

**Solution:** Track unread increments in SharedPreferences and sync on app resume.

#### Step 1: Modify MyFirebaseMessagingService.java

Add SharedPreferences tracking for background increments:

```java
private void incrementUnreadCountInPrefs(String groupId) {
    try {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String key = "unread_count_" + groupId;
        int currentCount = prefs.getInt(key, 0);
        prefs.edit().putInt(key, currentCount + 1).apply();
        Log.d(TAG, "✅ Incremented unread count in prefs: " + groupId + " → " + (currentCount + 1));
    } catch (Exception e) {
        Log.e(TAG, "❌ Error incrementing unread count in prefs: " + e.getMessage(), e);
    }
}
```

Update the background message handling:

```java
if (!isAppForeground) {
    // App is in background - show notification AND track unread count
    showNotification(...);
    incrementUnreadCountInPrefs(groupId);
    Log.d(TAG, "✅ Notification shown and unread tracked (app in background)");
}
```

#### Step 2: Sync on App Resume

Add app resume listener in MainActivity or push.ts:

```typescript
// In push.ts or App.tsx
App.addListener('appStateChange', async ({ isActive }) => {
  if (isActive) {
    console.log('[push] App resumed, syncing unread counts from native');
    
    // Get native-tracked counts from SharedPreferences
    const nativeCounts = await getNativeUnreadCounts();
    
    // Merge with current counts
    for (const [groupId, count] of Object.entries(nativeCounts)) {
      if (count > 0 && typeof window.__incrementUnreadCount === 'function') {
        // Increment by the native-tracked amount
        for (let i = 0; i < count; i++) {
          window.__incrementUnreadCount(groupId);
        }
      }
    }
    
    // Clear native counts after syncing
    await clearNativeUnreadCounts();
  }
});
```

### Fix 3: Verify Supabase RPC Function

**Action Required:** Check if `mark_group_as_read` function exists in Supabase.

#### Step 1: Check Function Exists

Run in Supabase SQL Editor:

```sql
SELECT 
  proname AS function_name,
  pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'mark_group_as_read';
```

**Expected:** Should return the function definition.  
**If empty:** Function doesn't exist, need to run migration.

#### Step 2: Check Permissions

```sql
-- Check if authenticated users can execute the function
SELECT 
  proname,
  proacl
FROM pg_proc
WHERE proname = 'mark_group_as_read';
```

**Expected:** Should show `authenticated` role has EXECUTE permission.  
**If not:** Run `GRANT EXECUTE ON FUNCTION mark_group_as_read TO authenticated;`

#### Step 3: Test Function Manually

```sql
-- Replace with actual UUIDs from your database
SELECT mark_group_as_read(
  '<group-id>'::UUID,
  '<user-id>'::UUID,
  '<message-id>'::UUID
);

-- Check if last_read_at was updated
SELECT 
  group_id,
  user_id,
  last_read_at,
  last_read_message_id
FROM group_members
WHERE group_id = '<group-id>'::UUID
  AND user_id = '<user-id>'::UUID;
```

**Expected:** `last_read_at` should be updated to current timestamp.

#### Step 4: Check RLS Policies

```sql
-- Check if RLS is blocking the update
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'group_members';
```

**Expected:** Should have a policy allowing authenticated users to UPDATE their own rows.

### Fix 4: Alternative Approach - Use Supabase as Source of Truth

**If RPC continues to fail**, use a simpler approach:

1. **On app start:** Fetch counts from Supabase (already working)
2. **On message receive (foreground):** Increment locally (already working)
3. **On mark as read:** Update Supabase AND local state
4. **On app resume:** Re-fetch from Supabase (source of truth)

This way, even if mark-as-read fails, the next app resume will sync the correct state.

## Testing Plan

### Test 1: Verify mark_group_as_read Error

1. Open app, open a chat with unread messages
2. Check logs for detailed error message
3. Note the exact error code and message

**Expected Logs:**
```
[unread] Marking as read: <groupId>
[unread] ❌ Mark as read RPC error: {
  message: "...",
  details: "...",
  hint: "...",
  code: "..."
}
```

### Test 2: Verify Supabase Function

1. Open Supabase SQL Editor
2. Run the verification queries above
3. Test function manually with real UUIDs

**Expected:** Function exists, has permissions, and updates `last_read_at` correctly.

### Test 3: Background Increment (After Fix)

1. Open app on Device A, stay on dashboard
2. Background the app (press home button)
3. Send message from Device B
4. Resume app on Device A

**Expected:**
- Native logs show increment tracked in SharedPreferences
- On resume, JS syncs the native counts
- Badge shows correct count

### Test 4: Mark as Read Persistence (After Fix)

1. Open app, open chat with unread messages
2. Verify badge goes to 0
3. Close app completely
4. Reopen app

**Expected:**
- Badge stays at 0 (not jumping to 15)
- Supabase `get_all_unread_counts` returns 0 for that group

## Priority

### Immediate (Do First)
1. ✅ **Improved error logging** (already applied)
2. **Verify Supabase RPC function** (run SQL queries)
3. **Fix mark_group_as_read RPC** (based on error details)

### Next (After RPC Fixed)
4. **Implement background unread tracking** (native SharedPreferences)
5. **Add app resume sync** (merge native counts to JS)

## Expected Outcome

After all fixes:

✅ **Foreground messages:** Increment immediately (already working)  
✅ **Background messages:** Tracked in native, synced on resume  
✅ **Mark as read:** Persists to Supabase correctly  
✅ **App restart:** Shows correct counts from Supabase  
✅ **No phantom counts:** Badge doesn't jump to wrong values  

The complete WhatsApp-style unread count system will be fully functional in all scenarios! 🚀
