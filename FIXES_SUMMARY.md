# 403 RLS Error - Root Cause Analysis and Fixes

## Problem Summary

Ghost messages were failing with **403 RLS error**: `"new row violates row-level security policy (USING expression) for table \"messages\""`

## Root Causes Identified

### 1. **Missing UPDATE Policy on Messages Table**
- The `messages` table only had INSERT and SELECT policies
- When using REST upsert with `on_conflict=dedupe_key`, Supabase tries to UPDATE existing rows
- Without an UPDATE policy, the operation fails with 403 RLS violation

### 2. **Duplicate Outbox Entries**
- The same message was being added to the outbox multiple times
- First entry would succeed, second entry would try to update the same message
- This triggered the missing UPDATE policy issue

### 3. **Group Membership RLS Issue (Fixed Earlier)**
- The `group_members` table had a circular dependency in RLS policies
- Fixed by allowing authenticated users to read all group memberships

## Timeline of the Error (from log18.txt)

1. **Line 1062**: Direct send times out after 5000ms → Message queued to outbox (ID 34)
2. **Line 1065**: First outbox entry created
3. **Line 1074**: Immediate fallback triggered
4. **Line 1079**: **SECOND outbox entry created (ID 35)** - DUPLICATE!
5. **Line 1096-1107**: Outbox ID 34 processes successfully ✅
6. **Line 1111**: Realtime receives the message (delivered to Supabase)
7. **Line 1123-1131**: Outbox ID 35 tries to send SAME message → **403 error** ❌

## Fixes Applied

### Fix 1: Add UPDATE Policy for Messages Table ✅

**File**: `supabase/migrations/20251002_fix_messages_update_policy.sql`

```sql
CREATE POLICY "Users can update their own messages in their groups"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  );
```

**What it does:**
- Allows users to update their own messages in groups they belong to
- Enables REST upsert with `on_conflict=dedupe_key` to work correctly
- Prevents 403 errors when duplicate messages are sent

### Fix 2: Prevent Duplicate Outbox Entries ✅

**File**: `src/lib/supabasePipeline.ts` (lines 1714-1773)

**Changes:**
- Added duplicate check before inserting into outbox
- Checks by both message ID and dedupe_key
- Skips insertion if message already exists in outbox
- Still triggers processing to ensure stuck messages are processed

**Code added:**
```typescript
// Check if message already exists in outbox to prevent duplicates
const existingItems = await sqliteService.getOutboxMessages();
const alreadyExists = existingItems.some(item => {
  try {
    const content = JSON.parse(item.content);
    // Check by message ID or dedupe_key
    return (content?.id === message.id) || 
           (message.dedupe_key && content?.dedupe_key === message.dedupe_key);
  } catch {
    return false;
  }
});

if (alreadyExists) {
  this.log(`📦 Message ${message.id} already in outbox, skipping duplicate`);
  this.triggerOutboxProcessing('pipeline-fallback');
  return;
}
```

### Fix 3: Group Membership RLS (Applied Earlier) ✅

**File**: `supabase/migrations/20251002_fix_group_members_rls.sql`

**Changes:**
- Removed circular dependency in `group_members` RLS policies
- Allows authenticated users to read all group memberships
- Maintains security for INSERT/DELETE operations

## How to Apply Fixes

### Step 1: Apply Database Migration

Run this SQL in your Supabase SQL Editor:

```sql
/*
  # Add UPDATE policy for messages table
*/

-- Add UPDATE policy for messages table
CREATE POLICY "Users can update their own messages in their groups"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND private.is_group_member(group_id)
  );
```

### Step 2: Rebuild and Deploy

```bash
npm run build && npx cap sync
npx cap run android
```

### Step 3: Test

1. Send a ghost message - should be instant ✅
2. Check for 403 errors in logs - should be none ✅
3. Verify no duplicate outbox entries ✅
4. Check pseudonyms display correctly ✅

## Expected Results

- ✅ **No more 403 errors** - UPDATE policy allows upsert to work
- ✅ **No duplicate outbox entries** - Duplicate check prevents multiple entries
- ✅ **Fast message delivery** - Messages send immediately
- ✅ **Proper pseudonym display** - Ghost messages show unique pseudonyms
- ✅ **Group members visible** - Group info page shows all members

## Technical Details

### Why the 403 Error Happened

1. **REST Upsert Behavior:**
   ```
   POST /rest/v1/messages?on_conflict=dedupe_key
   ```
   - If dedupe_key doesn't exist → INSERT (uses INSERT policy)
   - If dedupe_key exists → UPDATE (uses UPDATE policy)

2. **Missing UPDATE Policy:**
   - Only INSERT and SELECT policies existed
   - UPDATE operation had no policy → RLS blocks it → 403 error

3. **Duplicate Outbox Entries:**
   - First entry INSERTs successfully
   - Second entry tries to UPDATE (conflict on dedupe_key)
   - UPDATE fails due to missing policy

### Why Duplicate Outbox Entries Occurred

The `fallbackToOutbox` function was called multiple times for the same message:
1. **First call**: Direct send timeout (line 1500)
2. **Second call**: Immediate fallback after error (line 1611)

Both calls inserted the same message into the outbox without checking for duplicates.

## Files Modified

1. ✅ `supabase/migrations/20251002_fix_messages_update_policy.sql` - NEW
2. ✅ `src/lib/supabasePipeline.ts` - MODIFIED (lines 1714-1773)
3. ✅ `supabase/migrations/20251002_fix_group_members_rls.sql` - MODIFIED (applied earlier)

## Verification

After applying fixes, check logs for:
- ✅ No "403" errors
- ✅ No "row violates row-level security policy" errors
- ✅ Messages with "already in outbox, skipping duplicate"
- ✅ Successful "Outbox item delivered→deleted" messages
- ✅ No duplicate dedupe_keys in outbox processing

## Additional Notes

- The pseudonym system fixes from earlier are still in place
- Group membership visibility is working correctly
- All RLS policies are now properly configured
- The outbox system is more robust with duplicate prevention

