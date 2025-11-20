# Action Plan - Next Steps to Fix Remaining Issues

## ✅ Current Status

### Working
- ✅ Foreground message increments (native → JS bridge → UI update)
- ✅ Mark as read locally (badge goes to 0)
- ✅ Improved error logging (will show detailed RPC errors)

### Broken
- ❌ Background message increments (JS paused, can't receive native events)
- ❌ Mark as read persistence (RPC failing, counts jump back after restart)

## 🎯 Immediate Actions (Do First)

### Step 1: Deploy and Test Error Logging

**Deploy:**
```bash
npx cap run android
```

**Test:**
1. Open app, open a chat with unread messages
2. Watch logs for detailed error message

**Expected Log:**
```
[unread] Marking as read: <groupId>
[unread] ❌ Mark as read RPC error: {
  message: "...",
  details: "...",
  hint: "...",
  code: "..."
}
```

**Action:** Note the exact error details and proceed to Step 2.

### Step 2: Verify Supabase RPC Function

**Open Supabase SQL Editor and run:**

```sql
-- Check if function exists
SELECT 
  proname AS function_name,
  pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'mark_group_as_read';
```

**Expected:** Should return function definition.  
**If empty:** Function doesn't exist, run migration.

**Check permissions:**
```sql
GRANT EXECUTE ON FUNCTION mark_group_as_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_unread_counts TO authenticated;
```

**Test manually:**
```sql
-- Get a real group_id and user_id from your database
SELECT * FROM group_members LIMIT 1;

-- Get a real message_id from that group
SELECT id FROM messages 
WHERE group_id = '<group-id-from-above>' 
ORDER BY created_at DESC 
LIMIT 1;

-- Test the function
SELECT mark_group_as_read(
  '<group-id>'::UUID,
  '<user-id>'::UUID,
  '<message-id>'::UUID
);

-- Verify it worked
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

### Step 3: Fix Based on Error

#### If Error: "function does not exist"
**Solution:** Run the migration:
```sql
-- Copy from supabase/migrations/20250102_unread_tracking.sql
CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id uuid,
  p_user_id uuid,
  p_last_message_id uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE group_members
  SET 
    last_read_at = now(),
    last_read_message_id = COALESCE(p_last_message_id, last_read_message_id)
  WHERE group_id = p_group_id 
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mark_group_as_read TO authenticated;
```

#### If Error: "permission denied"
**Solution:** Grant permissions:
```sql
GRANT EXECUTE ON FUNCTION mark_group_as_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_unread_counts TO authenticated;
```

#### If Error: "invalid input syntax for type uuid"
**Solution:** Check if message IDs are valid UUIDs. If using custom IDs (like `1762755854140-aejp11ycaxe`), the function needs to accept TEXT instead of UUID.

**Fix the function:**
```sql
CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id uuid,
  p_user_id uuid,
  p_last_message_id text DEFAULT NULL  -- Changed from uuid to text
) RETURNS void AS $$
BEGIN
  UPDATE group_members
  SET 
    last_read_at = now(),
    last_read_message_id = p_last_message_id
  WHERE group_id = p_group_id 
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Also update the column type:**
```sql
ALTER TABLE group_members 
ALTER COLUMN last_read_message_id TYPE text;
```

#### If Error: "row level security policy violation"
**Solution:** Check RLS policies:
```sql
-- Check existing policies
SELECT * FROM pg_policies WHERE tablename = 'group_members';

-- Add policy to allow users to update their own rows
CREATE POLICY "Users can update their own group_members row"
ON group_members
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

### Step 4: Test Mark as Read Persistence

After fixing the RPC:

1. Open app, open chat with unread messages
2. Verify badge goes to 0
3. Check logs show: `[unread] ✅ Marked as read: <groupId>`
4. Close app completely
5. Reopen app
6. **Expected:** Badge stays at 0 (not jumping to 15)

## 🔄 Next Phase (After RPC Fixed)

### Fix Background Message Increments

Once mark-as-read is working, we can rely on Supabase as source of truth and use a simpler approach:

**Strategy:**
1. **Foreground:** Increment locally (already working)
2. **Background:** Don't track (JS is paused anyway)
3. **On app resume:** Re-fetch from Supabase (source of truth)

**Implementation:**

```typescript
// In push.ts or App.tsx
import { App } from '@capacitor/app';

App.addListener('appStateChange', async ({ isActive }) => {
  if (isActive) {
    console.log('[push] App resumed, refreshing unread counts from Supabase');
    
    // Re-fetch counts from Supabase (source of truth)
    if (typeof window.__updateUnreadCount === 'function') {
      const counts = await unreadTracker.getAllUnreadCounts();
      
      // Update all counts at once
      for (const [groupId, count] of counts.entries()) {
        window.__updateUnreadCount(groupId, count);
      }
      
      console.log('[push] ✅ Unread counts refreshed from Supabase');
    }
  }
});
```

This way:
- **Foreground messages:** Increment immediately (fast, responsive)
- **Background messages:** Counted by Supabase (reliable)
- **App resume:** Sync from Supabase (always correct)

## 📋 Testing Checklist

### Test 1: Mark as Read Persistence
- [ ] Open chat with unread messages
- [ ] Badge goes to 0
- [ ] Logs show `✅ Marked as read`
- [ ] No RPC errors in logs
- [ ] Close app completely
- [ ] Reopen app
- [ ] Badge stays at 0 (not jumping back)

### Test 2: Foreground Increments
- [ ] Stay on dashboard
- [ ] Receive message from another device
- [ ] Badge increments immediately
- [ ] Logs show native → JS bridge → increment

### Test 3: Background Messages (After App Resume Fix)
- [ ] Stay on dashboard
- [ ] Background the app
- [ ] Send messages from another device
- [ ] Resume the app
- [ ] Badge shows correct count from Supabase

### Test 4: Multiple Groups
- [ ] Have unread messages in multiple groups
- [ ] Open each group one by one
- [ ] Each badge goes to 0 when opened
- [ ] Restart app
- [ ] All badges stay at 0

## 🎯 Success Criteria

After all fixes:

✅ **Mark as read persists** (no phantom counts after restart)  
✅ **Foreground increments work** (immediate, responsive)  
✅ **Background messages counted** (via Supabase on resume)  
✅ **No race conditions** (Supabase is source of truth)  
✅ **WhatsApp-style UX** (fast, reliable, predictable)  

## 📝 Summary

**Priority 1 (Do Now):**
1. Deploy with improved error logging
2. Check logs for exact RPC error
3. Fix Supabase RPC function based on error
4. Test mark-as-read persistence

**Priority 2 (After RPC Fixed):**
5. Add app resume listener to refresh counts from Supabase
6. Test background message scenario
7. Verify all scenarios work correctly

**Expected Timeline:**
- Priority 1: 30-60 minutes (mostly waiting for Supabase fixes)
- Priority 2: 15-30 minutes (simple code change)
- Total: 1-2 hours to complete solution

The complete WhatsApp-style unread count system will then be fully functional! 🚀
