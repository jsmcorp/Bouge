# Unread Count Inflation Fix

## Problem Summary

The app was showing inflated unread counts (e.g., 6 or 9) when the actual unread count should be lower. This happened specifically:

1. **On app restart**: Fresh fetch would return wrong counts from Supabase
2. **On app resume**: After device lock/unlock, the resume sync would overwrite correct local counts with bad server values

### Root Causes

From the logs, two critical issues were identified:

1. **Backward-Moving Read Pointer**: The `mark_group_as_read` function didn't prevent the read pointer from moving backward when requests arrived out of order. If you read message B, then message A, but the server received "Read A" after "Read B", it would overwrite the timestamp and mistakenly mark message B as unread again.

2. **Inconsistent Count Logic**: The `get_all_unread_counts` function wasn't strictly aligned with the timestamp-based read tracking, leading to miscounts.

## Solution

### Database Changes

Created migration: `supabase/migrations/20251120_fix_unread_count_inflation.sql`

#### 1. Upgraded `mark_group_as_read`

**Key improvements**:

1. **NULL Safety Check**: Returns early if `p_last_message_id` is NULL, preventing accidental "mark all as read" during app initialization/restart
2. **Message Validation**: Returns early if the message doesn't exist (invalid ID)
3. **Monotonic Updates**: Only updates if the new timestamp is newer than the current one:

```sql
WHERE group_id = p_group_id 
  AND user_id = p_user_id
  AND (last_read_at IS NULL OR v_message_timestamp > last_read_at);
```

This prevents:
- Out-of-order requests from "un-reading" messages
- App restart from wiping out unread counts when called with NULL

#### 2. Upgraded `get_all_unread_counts`

**Key improvements**:
- Uses `auth.uid()` instead of requiring `p_user_id` parameter (better security)
- Strict timestamp comparison: `m.created_at > gm.last_read_at`
- Proper NULL handling for groups that have never been read

### Frontend Changes

Updated `src/lib/unreadTracker.ts`:

1. **`getAllUnreadCountsFast()`**: Removed `p_user_id` parameter from RPC call (now uses `auth.uid()` internally)
2. **`getAllUnreadCounts()`**: Removed `p_user_id` parameter from RPC call
3. **`markGroupAsRead()`**: Added safety check to fail fast if `groupId` or `lastMessageId` is missing, preventing accidental NULL calls that would wipe out read status

## Deployment

### Option 1: Using Supabase CLI

```bash
# Set your database URL
set SUPABASE_DB_URL=your_connection_string

# Run the deployment script
deploy-unread-fix.bat
```

### Option 2: Manual SQL Execution

1. Open your Supabase Dashboard
2. Go to SQL Editor
3. Copy and paste the contents of `supabase/migrations/20251120_fix_unread_count_inflation.sql`
4. Execute the SQL

## Testing

After deployment, test these scenarios:

1. **App Restart Test**:
   - Read some messages in a group
   - Close and restart the app
   - Verify the unread count is correct (should be 0 if you read all messages)
   - **Critical**: If you DON'T read messages and restart, the count should stay the same (not reset to 0)

2. **App Resume Test**:
   - Read some messages
   - Lock your device
   - Unlock and return to the app
   - Verify the unread count doesn't jump to a wrong value

3. **Out-of-Order Test**:
   - Quickly read multiple messages in succession
   - Verify the count decrements correctly without jumping back up

## Additional Fix: Prevent markGroupAsRead from Hanging

### Issue Discovered in log26.txt

The `markGroupAsRead` function was hanging because `auth.getUser()` would block indefinitely when a session refresh was in progress. This caused:
- Read status never being saved to Supabase
- App resume fetching stale counts (e.g., 31 instead of 1)

### Solution

Changed `markGroupAsRead` to use `getCachedSession()` instead of `auth.getUser()`:
- Avoids blocking on session refresh
- Uses already-available cached user data
- Completes quickly and reliably

## Expected Behavior

- **Before**: Unread count shows 9 after restart, even though you only have 4 unread messages
- **After**: Unread count shows 4 (the correct value) consistently across restarts and resumes
- **Before**: markGroupAsRead hangs during session refresh, read status not saved
- **After**: markGroupAsRead completes quickly using cached session

## Technical Details

### Why This Works

1. **Monotonic Read Pointer**: By ensuring the read pointer only moves forward in time, we guarantee that once a message is marked as read, it stays read—even if a delayed network request tries to update it with an older timestamp.

2. **Strict Timestamp Logic**: The counting function now uses the exact same timestamp comparison logic as the marking function, ensuring they're always in sync.

3. **Auth Security**: Using `auth.uid()` instead of passing user_id as a parameter prevents potential security issues and simplifies the API.

### Migration Safety

This migration is safe to apply because:
- It only modifies function definitions (no schema changes)
- It's backward compatible (existing data is not affected)
- The WHERE clause addition only makes updates more restrictive (safer)
- Functions are replaced atomically using `CREATE OR REPLACE`
