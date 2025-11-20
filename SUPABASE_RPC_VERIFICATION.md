# Supabase RPC Verification Guide

## Issue Identified

The logs show `markGroupAsRead CALLED` but no subsequent logs, indicating either:
1. An exception before the RPC call
2. The RPC doesn't exist or has wrong permissions
3. The RPC exists but doesn't update the data that `get_all_unread_counts` reads

## Required Supabase RPC Functions

### 1. mark_group_as_read

This function should update the `last_read_at` timestamp in `group_members` table.

**Expected SQL:**

```sql
CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id UUID,
  p_user_id UUID,
  p_last_message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_created_at TIMESTAMPTZ;
BEGIN
  -- Get the timestamp of the last message
  SELECT created_at
  INTO v_last_created_at
  FROM messages
  WHERE id = p_last_message_id
    AND group_id = p_group_id;
  
  -- If message not found, use current timestamp
  IF v_last_created_at IS NULL THEN
    v_last_created_at := NOW();
  END IF;
  
  -- Update the last_read_at for this user in this group
  UPDATE group_members
  SET 
    last_read_at = v_last_created_at,
    last_read_message_id = p_last_message_id
  WHERE group_id = p_group_id
    AND user_id = p_user_id;
    
  -- Log for debugging
  RAISE NOTICE 'Marked group % as read for user % up to message % (timestamp: %)', 
    p_group_id, p_user_id, p_last_message_id, v_last_created_at;
END;
$$;
```

**Key Points:**
- Must update `group_members.last_read_at` to the timestamp of the last read message
- Should also update `last_read_message_id` for reference
- Uses `SECURITY DEFINER` to run with function owner's permissions
- Returns VOID (no data returned)

### 2. get_all_unread_counts

This function should count messages created AFTER the user's `last_read_at` timestamp.

**Expected SQL:**

```sql
CREATE OR REPLACE FUNCTION get_all_unread_counts(
  p_user_id UUID
)
RETURNS TABLE (
  group_id UUID,
  unread_count INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT
    gm.group_id,
    COUNT(m.id)::INTEGER AS unread_count
  FROM group_members gm
  LEFT JOIN messages m
    ON m.group_id = gm.group_id
    AND m.user_id != p_user_id  -- Don't count own messages
    AND m.created_at > COALESCE(gm.last_read_at, gm.joined_at, '-infinity'::TIMESTAMPTZ)
    AND m.deleted_at IS NULL  -- Don't count deleted messages
  WHERE gm.user_id = p_user_id
  GROUP BY gm.group_id
  HAVING COUNT(m.id) > 0;  -- Only return groups with unread messages
$$;
```

**Key Points:**
- Counts messages where `created_at > last_read_at`
- Falls back to `joined_at` if `last_read_at` is NULL (first time viewing)
- Excludes user's own messages
- Excludes deleted messages
- Only returns groups with unread count > 0

## How to Verify

### Step 1: Check if Functions Exist

In Supabase SQL Editor, run:

```sql
-- Check if mark_group_as_read exists
SELECT 
  proname AS function_name,
  pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'mark_group_as_read';

-- Check if get_all_unread_counts exists
SELECT 
  proname AS function_name,
  pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'get_all_unread_counts';
```

### Step 2: Check group_members Table Schema

```sql
-- Check if last_read_at column exists
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'group_members'
  AND column_name IN ('last_read_at', 'last_read_message_id', 'joined_at');
```

**Expected columns:**
- `last_read_at` - TIMESTAMPTZ, nullable
- `last_read_message_id` - UUID, nullable
- `joined_at` - TIMESTAMPTZ, not null

### Step 3: Test mark_group_as_read Manually

```sql
-- Get a test group and user
SELECT 
  gm.group_id,
  gm.user_id,
  gm.last_read_at AS old_last_read_at,
  m.id AS latest_message_id,
  m.created_at AS latest_message_time
FROM group_members gm
JOIN messages m ON m.group_id = gm.group_id
WHERE gm.user_id = '<your-user-id>'
ORDER BY m.created_at DESC
LIMIT 1;

-- Call the function
SELECT mark_group_as_read(
  '<group-id>'::UUID,
  '<user-id>'::UUID,
  '<message-id>'::UUID
);

-- Verify it updated
SELECT 
  group_id,
  user_id,
  last_read_at,
  last_read_message_id
FROM group_members
WHERE group_id = '<group-id>'
  AND user_id = '<user-id>';
```

### Step 4: Test get_all_unread_counts

```sql
-- Before marking as read
SELECT * FROM get_all_unread_counts('<user-id>'::UUID);

-- Mark a group as read
SELECT mark_group_as_read('<group-id>'::UUID, '<user-id>'::UUID, '<message-id>'::UUID);

-- After marking as read (should show 0 or not appear)
SELECT * FROM get_all_unread_counts('<user-id>'::UUID);
```

## Common Issues

### Issue 1: Function Doesn't Exist

**Symptom:** RPC call fails with "function not found"

**Solution:** Create the functions using the SQL above

### Issue 2: Permission Denied

**Symptom:** RPC call fails with "permission denied"

**Solution:** Add `SECURITY DEFINER` to function definition and grant execute:

```sql
GRANT EXECUTE ON FUNCTION mark_group_as_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_unread_counts TO authenticated;
```

### Issue 3: Column Doesn't Exist

**Symptom:** Function fails with "column does not exist"

**Solution:** Add missing columns to group_members:

```sql
ALTER TABLE group_members
ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_read_message_id UUID;
```

### Issue 4: Functions Use Different Columns

**Symptom:** `mark_group_as_read` succeeds but `get_all_unread_counts` still returns old count

**Solution:** Ensure both functions use the same column (`last_read_at`)

Check what `mark_group_as_read` updates:
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'mark_group_as_read';
```

Check what `get_all_unread_counts` reads:
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'get_all_unread_counts';
```

### Issue 5: Timestamp Comparison Issue

**Symptom:** Unread count is always wrong

**Solution:** Ensure timestamps are compared correctly:
- Use `created_at > last_read_at` (not `>=`)
- Handle NULL `last_read_at` with `COALESCE(last_read_at, joined_at, '-infinity')`
- Ensure timezone consistency (use TIMESTAMPTZ)

## Migration Script

If the functions don't exist or are wrong, run this migration:

```sql
-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS mark_group_as_read(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS get_all_unread_counts(UUID);

-- Add columns if they don't exist
ALTER TABLE group_members
ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_read_message_id UUID;

-- Create mark_group_as_read function
CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id UUID,
  p_user_id UUID,
  p_last_message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_created_at TIMESTAMPTZ;
BEGIN
  SELECT created_at
  INTO v_last_created_at
  FROM messages
  WHERE id = p_last_message_id
    AND group_id = p_group_id;
  
  IF v_last_created_at IS NULL THEN
    v_last_created_at := NOW();
  END IF;
  
  UPDATE group_members
  SET 
    last_read_at = v_last_created_at,
    last_read_message_id = p_last_message_id
  WHERE group_id = p_group_id
    AND user_id = p_user_id;
END;
$$;

-- Create get_all_unread_counts function
CREATE OR REPLACE FUNCTION get_all_unread_counts(
  p_user_id UUID
)
RETURNS TABLE (
  group_id UUID,
  unread_count INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT
    gm.group_id,
    COUNT(m.id)::INTEGER AS unread_count
  FROM group_members gm
  LEFT JOIN messages m
    ON m.group_id = gm.group_id
    AND m.user_id != p_user_id
    AND m.created_at > COALESCE(gm.last_read_at, gm.joined_at, '-infinity'::TIMESTAMPTZ)
    AND m.deleted_at IS NULL
  WHERE gm.user_id = p_user_id
  GROUP BY gm.group_id
  HAVING COUNT(m.id) > 0;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION mark_group_as_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_unread_counts TO authenticated;
```

## Testing After Fix

1. **Restart the app** - Should show correct unread counts
2. **Open a chat** - Wait 2 seconds
3. **Go back to dashboard** - Badge should update to 0
4. **Restart the app again** - Badge should still be 0 (not revert to old count)

If step 4 fails (badge shows old count after restart), the Supabase functions are still not aligned.

## What the New Logs Will Show

With the enhanced logging, you'll see:

**If RPC doesn't exist:**
```
[unread] 📡 Calling Supabase RPC mark_group_as_read
[unread] ❌ Error marking group as read in Supabase: function not found
```

**If RPC succeeds:**
```
[unread] 📡 Calling Supabase RPC mark_group_as_read
[unread] ✅ Supabase RPC mark_group_as_read succeeded
[unread] ✅ RPC response data: null
```

**If there's an exception:**
```
[unread] 🔵 markGroupAsRead CALLED
[unread] ❌ markGroupAsRead FAILED with exception: <error>
```

The detailed logs will pinpoint exactly where the issue is!
