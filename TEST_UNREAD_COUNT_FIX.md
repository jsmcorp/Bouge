# Test Guide - Unread Count Fix

## Deploy Steps

### 1. Deploy Supabase Migration
```sql
-- In Supabase SQL Editor, run:
-- File: supabase/migrations/20251120_fix_mark_as_read_clock_skew.sql

CREATE OR REPLACE FUNCTION mark_group_as_read(
  p_group_id uuid,
  p_user_id uuid,
  p_last_message_id uuid DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_message_timestamp timestamptz;
BEGIN
  IF p_last_message_id IS NOT NULL THEN
    SELECT created_at INTO v_message_timestamp
    FROM messages
    WHERE id = p_last_message_id AND group_id = p_group_id;
  END IF;
  
  UPDATE group_members
  SET 
    last_read_at = COALESCE(v_message_timestamp, now()),
    last_read_message_id = COALESCE(p_last_message_id, last_read_message_id)
  WHERE group_id = p_group_id 
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2. Deploy Android App
```bash
npx cap run android
```

## Test Scenarios

### Test 1: App Resume Updates Badge ✅

**Steps:**
1. Open app, go to dashboard
2. Note current badge count (e.g., 5)
3. Background app (home button)
4. Wait 2 seconds
5. Resume app

**Expected Result:**
```
[main] 📱 App resumed - syncing unread counts from Supabase
[main] 🔄 Importing unreadTracker...
[main] ✅ unreadTracker imported
[main] 🔄 Fetching fresh counts from Supabase...
[main] ✅ Got fresh counts from Supabase: [["group-id", 5]]
[main] 🔄 Updating UI with fresh counts...
[main] ✅ Updated count for group: group-id → 5
[main] ✅ Unread counts synced to UI
```

**Badge should update to correct count from Supabase**

### Test 2: Mark as Read Persists ✅

**Steps:**
1. Open chat with unread messages (badge shows count)
2. Scroll to bottom (marks as read)
3. Verify badge goes to 0
4. Go back to dashboard
5. Close app completely
6. Restart app

**Expected Result:**
- Badge stays at 0 after restart
- No phantom unread counts

### Test 3: Increment While App Open ✅

**Steps:**
1. Open app, go to dashboard
2. Badge shows 0
3. Send message from another device
4. Wait for FCM notification

**Expected Result:**
```
[push] 🔔 Native new message event received
[push] 📬 Native event for non-active group, incrementing unread count
[unread] 📈 incrementUnreadCount called for: group-id
[unread] 📊 group-id : 0 → 1
[unread] ✅ State updated, new counts: group-id,1
```

**Badge increments to 1**

### Test 4: Resume After Background Messages ✅

**Steps:**
1. Open app, mark all as read (badge = 0)
2. Background app
3. Send 3 messages from another device
4. Resume app

**Expected Result:**
```
[main] 📱 App resumed - syncing unread counts from Supabase
[main] ✅ Got fresh counts from Supabase: [["group-id", 3]]
[main] ✅ Unread counts synced to UI
```

**Badge updates to 3**

### Test 5: Clock Skew Immunity ✅

**Steps:**
1. Open chat with 5 unread messages
2. Mark as read (badge → 0)
3. Immediately restart app (within 1 second)

**Expected Result:**
- Badge stays at 0
- No phantom counts even with potential clock skew

## What to Look For

### Success Indicators:
- ✅ `[main] 📱 App resumed - syncing unread counts` appears in logs
- ✅ Badge updates on app resume
- ✅ Badge persists correctly after restart
- ✅ No phantom unread counts

### Failure Indicators:
- ❌ No `[main] 📱 App resumed` logs
- ❌ Badge doesn't update on resume
- ❌ Badge shows wrong count after restart
- ❌ Phantom counts appear

## Debugging

If issues persist, check logs for:

1. **Session recovery blocking:**
   ```
   [supabase-pipeline] refreshSessionUnified(direct, timeout=10000ms) start
   ```
   Should be followed by:
   ```
   [main] 📱 App resumed - syncing unread counts
   ```

2. **Unread sync errors:**
   ```
   [main] ❌ Error syncing unread counts on resume
   [main] ❌ Error details: { message: "...", stack: "..." }
   ```

3. **RPC call failures:**
   ```
   [unread] ❌ Failed to fetch counts from Supabase
   ```

## Expected Timeline

- **App resume sync:** < 500ms
- **Badge update:** Immediate after sync
- **Mark as read:** < 200ms
- **Supabase RPC:** < 300ms

## Success Criteria

All 5 test scenarios pass:
- ✅ App resume updates badge
- ✅ Mark as read persists
- ✅ Increment while app open works
- ✅ Resume after background messages works
- ✅ Clock skew immunity confirmed

## Next Steps After Testing

If all tests pass:
1. Monitor production logs for any edge cases
2. Verify with multiple users
3. Check for any performance issues

If any test fails:
1. Check logs for specific error
2. Verify Supabase migration was applied
3. Confirm build was deployed correctly
4. Review ROOT_CAUSE_FOUND_AND_FIXED.md for details
