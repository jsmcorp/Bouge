# Action Plan: Fix Unread Count Backend Issue

## Problem Confirmed

Based on the logs, the issue is now clear:

✅ **UI wiring works** - React state updates correctly  
✅ **markGroupAsRead is called** - Logs show `🔵 markGroupAsRead CALLED`  
❌ **RPC execution fails silently** - No subsequent logs appear  
❌ **Unread counts wrong after restart** - Old read messages counted as unread  

## Root Cause

The Supabase RPC functions either:
1. Don't exist
2. Have wrong permissions
3. Update different columns than `get_all_unread_counts` reads
4. Throw an exception that's being swallowed

## Immediate Actions

### Action 1: Enhanced Logging (DONE ✅)

I've added extremely detailed logging to `markGroupAsRead`:
- Logs every step of execution
- Logs RPC parameters
- Logs RPC response
- Logs any exceptions with stack traces
- Won't throw exceptions (resilient)

**File modified:** `src/lib/unreadTracker.ts`

### Action 2: Verify Supabase RPC Functions (TODO)

Open Supabase SQL Editor and run these checks:

**Check 1: Do the functions exist?**
```sql
SELECT proname, pg_get_functiondef(oid)
FROM pg_proc
WHERE proname IN ('mark_group_as_read', 'get_all_unread_counts');
```

**Check 2: Does group_members have the right columns?**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'group_members'
  AND column_name IN ('last_read_at', 'last_read_message_id', 'joined_at');
```

**Check 3: Test mark_group_as_read manually**
```sql
-- Get your user ID and a group ID
SELECT * FROM group_members WHERE user_id = auth.uid() LIMIT 1;

-- Get a message ID from that group
SELECT id, created_at FROM messages 
WHERE group_id = '<group-id-from-above>' 
ORDER BY created_at DESC LIMIT 1;

-- Call the function
SELECT mark_group_as_read(
  '<group-id>'::UUID,
  auth.uid(),
  '<message-id>'::UUID
);

-- Check if it updated
SELECT last_read_at, last_read_message_id
FROM group_members
WHERE group_id = '<group-id>' AND user_id = auth.uid();
```

### Action 3: Create/Fix RPC Functions (TODO)

If the functions don't exist or are wrong, run this migration:

```sql
-- Add columns if missing
ALTER TABLE group_members
ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_read_message_id UUID;

-- Create mark_group_as_read
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
  SELECT created_at INTO v_last_created_at
  FROM messages
  WHERE id = p_last_message_id AND group_id = p_group_id;
  
  IF v_last_created_at IS NULL THEN
    v_last_created_at := NOW();
  END IF;
  
  UPDATE group_members
  SET last_read_at = v_last_created_at,
      last_read_message_id = p_last_message_id
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

-- Create get_all_unread_counts
CREATE OR REPLACE FUNCTION get_all_unread_counts(
  p_user_id UUID
)
RETURNS TABLE (group_id UUID, unread_count INTEGER)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT gm.group_id, COUNT(m.id)::INTEGER AS unread_count
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

### Action 4: Test with New Logs (TODO)

Run the test scenario again:

1. **Open the app** - Note initial unread count
2. **Open a chat** - Wait 3 seconds
3. **Go back to dashboard** - Check logs

**Look for these logs:**

```
[unread] 🔵 markGroupAsRead CALLED
[unread] 🔄 Starting markGroupAsRead execution...
[unread] 📞 Getting Supabase client...
[unread] ✅ Got Supabase client
[unread] 👤 Getting current user...
[unread] ✅ Got user: <user-id>
[unread] 📡 Calling Supabase RPC mark_group_as_read
[unread] 📡 RPC params: p_group_id=..., p_user_id=..., p_last_message_id=...
[unread] 📡 RPC call completed
[unread] ✅ Supabase RPC mark_group_as_read succeeded
[unread] ✅ RPC response data: null
[unread] 📱 Platform check: isNative=true
[unread] 📱 Native platform - checking SQLite...
[unread] 📱 SQLite ready: true
[unread] 📱 Updating SQLite last_read...
[unread] ✅ SQLite updated
[unread] 🗑️ Clearing cache for group <group-id>
[unread] ✅ Cache cleared
[unread] 📢 Notifying X listeners: groupId=<group-id>, count=0
[unread] ✅ Listeners notified
[unread] ✅ markGroupAsRead COMPLETED for group <group-id>
```

**If you see an error:**

```
[unread] ❌ Error marking group as read in Supabase: <error details>
```

This will tell you exactly what's wrong (function not found, permission denied, etc.)

### Action 5: Verify After Restart (TODO)

1. **Restart the app completely**
2. **Check initial unread counts**
3. **Expected:** Should be 0 for groups you marked as read
4. **If not:** The RPC functions are still not aligned

## Expected Outcomes

### If RPC Functions Don't Exist

**Logs will show:**
```
[unread] ❌ Error marking group as read in Supabase: function "mark_group_as_read" does not exist
```

**Solution:** Run the migration script to create them

### If RPC Functions Have Wrong Permissions

**Logs will show:**
```
[unread] ❌ Error marking group as read in Supabase: permission denied for function mark_group_as_read
```

**Solution:** Grant execute permissions

### If RPC Functions Update Wrong Columns

**Logs will show:**
```
[unread] ✅ Supabase RPC mark_group_as_read succeeded
```

But after restart, unread counts are still wrong.

**Solution:** Verify both functions use `last_read_at` column

### If Everything Works

**Logs will show:**
```
[unread] ✅ markGroupAsRead COMPLETED
[Sidebar] Unread callback fired: count=0
[unread] Fetched counts: [[groupId, 0]]
```

And after restart, unread counts remain correct.

## Timeline

1. **Now:** Enhanced logging is in place
2. **Next:** Run test scenario and capture logs
3. **Then:** Based on logs, verify/fix Supabase RPC functions
4. **Finally:** Test again to confirm fix

## Success Criteria

✅ Logs show complete execution of `markGroupAsRead`  
✅ No errors in RPC call  
✅ Dashboard badge updates to 0 after viewing  
✅ After app restart, badge stays at 0 (doesn't revert)  
✅ New messages increment badge correctly  

## Files Modified

1. ✅ `src/lib/unreadTracker.ts` - Added comprehensive logging
2. ✅ `src/components/dashboard/ChatArea.tsx` - Already has logging
3. ✅ `src/components/dashboard/Sidebar.tsx` - Already has logging

## Documentation Created

1. `SUPABASE_RPC_VERIFICATION.md` - How to verify and fix RPC functions
2. `ACTION_PLAN_BACKEND_FIX.md` - This file
3. `READY_TO_TEST.md` - Testing guide
4. `UNREAD_COUNT_COMPLETE_DEBUG_GUIDE.md` - Complete diagnostic guide

## Next Step

**Run the test scenario and share the complete logs.** The enhanced logging will show exactly what's happening with the RPC call, allowing us to fix the Supabase functions if needed.
