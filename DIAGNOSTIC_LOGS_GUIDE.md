# 🔍 Diagnostic Logs Guide - CASCADE Migration Fix

## What Changed

I've added comprehensive diagnostic logging to identify why the `group_members` row isn't persisting. The CASCADE migration fix IS implemented, but we need to see what's happening.

## New Logs to Look For

### 1. App Launch - Migration Check
```
🔄 [MIGRATION] Checking if foreign key CASCADE migration is needed...
🔍 [MIGRATION] group_members FK check result: {rowCount: X, foreignKeys: [...]}
🔍 [MIGRATION] group_members has CASCADE? true/false
```

**Expected on FIRST launch (fresh install):**
```
🔍 [MIGRATION] group_members has CASCADE? false
⚠️ [MIGRATION] group_members does NOT have CASCADE, will run migration
🔄 [MIGRATION] Starting CASCADE migration (this will recreate tables)...
✅ [MIGRATION] Foreign key CASCADE migration completed in XXXms
✅ [MIGRATION] All tables recreated with CASCADE foreign keys
```

**Expected on SECOND launch (and all subsequent):**
```
🔍 [MIGRATION] group_members has CASCADE? true
✅ [MIGRATION] group_members already has CASCADE, skipping migration
```

### 2. App Launch - Health Check
```
🏥 [HEALTH-CHECK] Verifying database integrity...
🏥 [HEALTH-CHECK] group_members table exists: ✅
🏥 [HEALTH-CHECK] group_members has CASCADE: ✅
🏥 [HEALTH-CHECK] group_members row count: X
🏥 [HEALTH-CHECK] Database encrypted: ✅
🏥 [HEALTH-CHECK] Health check complete
```

**If CASCADE is missing:**
```
🏥 [HEALTH-CHECK] group_members has CASCADE: ❌
⚠️ [HEALTH-CHECK] WARNING: group_members does NOT have CASCADE foreign keys!
⚠️ [HEALTH-CHECK] This will cause data loss on every migration run
```

### 3. Chat Open - Row Check
```
[unread] 🔍 Checking for existing group_members row: group=04a965fb, user=839d1d4a
[unread] 🔍 Result: NOT FOUND (will create)
```

**OR if row exists:**
```
[unread] 🔍 Result: FOUND (last_read_at=1732483200000)
```

### 4. Row Creation - Verification
```
[sqlite] ✅ Created new group_members row for read status
[sqlite] ✅ VERIFIED: Row exists in database after INSERT: {
  last_read_at: 0,
  last_read_message_id: null
}
```

**If verification fails:**
```
[sqlite] ❌ VERIFICATION FAILED: Row NOT found after INSERT!
[sqlite] ❌ This indicates a persistence or transaction issue
```

## Diagnostic Scenarios

### Scenario 1: Migration Running on Every Launch
**Symptoms:**
- "Starting CASCADE migration" appears on every app launch
- "FIRST TIME" appears on every chat open

**Logs to Check:**
```
🔍 [MIGRATION] group_members has CASCADE? false  ← Should be true after first run
```

**Diagnosis:** Migration check is failing, CASCADE not being set properly

---

### Scenario 2: Row Not Persisting
**Symptoms:**
- "FIRST TIME" appears on every chat open (even without app restart)
- Row count stays at 0

**Logs to Check:**
```
[sqlite] ✅ VERIFIED: Row exists in database after INSERT  ← Row created
🏥 [HEALTH-CHECK] group_members row count: 0  ← But count is 0!
```

**Diagnosis:** Row is created but not committed to disk

---

### Scenario 3: Row Deleted Between Opens
**Symptoms:**
- "FIRST TIME" appears on second chat open (2 minutes later)
- Row count increases then decreases

**Logs to Check:**
```
First open:
🏥 [HEALTH-CHECK] group_members row count: 1
[unread] 🔍 Result: NOT FOUND (will create)  ← Should be FOUND!

Second open:
🏥 [HEALTH-CHECK] group_members row count: 0  ← Row disappeared!
```

**Diagnosis:** Migration is running between opens, dropping table

---

## What to Test

### Test 1: Clear App Data and Launch
1. Clear app data (Settings → Apps → Confessr → Clear Data)
2. Launch app
3. Look for migration logs

**Expected:**
```
🔄 [MIGRATION] Checking if foreign key CASCADE migration is needed...
🔍 [MIGRATION] group_members has CASCADE? false
🔄 [MIGRATION] Starting CASCADE migration...
✅ [MIGRATION] Foreign key CASCADE migration completed in XXXms
🏥 [HEALTH-CHECK] group_members has CASCADE: ✅
```

### Test 2: Relaunch App (Without Clearing Data)
1. Force close app
2. Relaunch app
3. Look for migration logs

**Expected:**
```
🔄 [MIGRATION] Checking if foreign key CASCADE migration is needed...
🔍 [MIGRATION] group_members has CASCADE? true
✅ [MIGRATION] group_members already has CASCADE, skipping migration
🏥 [HEALTH-CHECK] group_members has CASCADE: ✅
```

### Test 3: Open Chat Twice
1. Open a chat
2. Look for row check logs
3. Close chat
4. Reopen same chat (without app restart)
5. Look for row check logs again

**Expected:**
```
First open:
[unread] 🔍 Result: NOT FOUND (will create)
[sqlite] ✅ VERIFIED: Row exists in database after INSERT

Second open (2 min later):
[unread] 🔍 Result: FOUND (last_read_at=XXX)  ← Should be FOUND!
```

### Test 4: Check Row Count
1. Open app
2. Look for health check logs
3. Open a chat
4. Force close app
5. Relaunch app
6. Look for health check logs again

**Expected:**
```
First launch:
🏥 [HEALTH-CHECK] group_members row count: 0

After opening chat:
🏥 [HEALTH-CHECK] group_members row count: 1

Second launch:
🏥 [HEALTH-CHECK] group_members row count: 1  ← Should persist!
```

## How to Share Logs

### Option 1: Copy from Logcat
```bash
adb logcat | grep -E "\[MIGRATION\]|\[HEALTH-CHECK\]|\[unread\]|\[sqlite\]"
```

### Option 2: Filter in Android Studio
1. Open Logcat
2. Filter by: `MIGRATION|HEALTH-CHECK|unread|sqlite`
3. Copy relevant logs

### Option 3: Save to File
```bash
adb logcat -d > full_logs.txt
```

## What I Need to See

Please provide logs for:

1. **First app launch (after clear data):**
   - Migration logs
   - Health check logs

2. **Second app launch (without clear data):**
   - Migration logs (should skip)
   - Health check logs (should show CASCADE exists)

3. **First chat open:**
   - Row check logs
   - Row creation logs
   - Verification logs

4. **Second chat open (same chat, 2 min later):**
   - Row check logs (should find existing row)

5. **App restart after opening chat:**
   - Health check logs (should show row count > 0)

## Expected vs Actual

### ✅ WORKING (What We Want to See)
```
Launch 1:
🔍 [MIGRATION] group_members has CASCADE? false
🔄 [MIGRATION] Starting CASCADE migration...
✅ [MIGRATION] completed in 234ms
🏥 [HEALTH-CHECK] group_members has CASCADE: ✅

Launch 2:
🔍 [MIGRATION] group_members has CASCADE? true
✅ [MIGRATION] skipping migration
🏥 [HEALTH-CHECK] group_members row count: 1

Chat Open 1:
[unread] 🔍 Result: NOT FOUND (will create)
[sqlite] ✅ VERIFIED: Row exists

Chat Open 2:
[unread] 🔍 Result: FOUND (last_read_at=XXX)
```

### ❌ BROKEN (What You're Seeing Now)
```
Launch 1:
🔍 [MIGRATION] group_members has CASCADE? false
🔄 [MIGRATION] Starting CASCADE migration...
✅ [MIGRATION] completed

Launch 2:
🔍 [MIGRATION] group_members has CASCADE? false  ← Should be true!
🔄 [MIGRATION] Starting CASCADE migration...  ← Should skip!

Chat Open 1:
[unread] 🔍 Result: NOT FOUND (will create)
[sqlite] ✅ VERIFIED: Row exists

Chat Open 2 (2 min later):
[unread] 🔍 Result: NOT FOUND (will create)  ← Should be FOUND!
```

## Next Steps

1. **Build and install** the new version with diagnostic logs
2. **Clear app data** to start fresh
3. **Run the 4 tests** above
4. **Share the logs** with me

The diagnostic logs will tell us exactly where the issue is:
- Is CASCADE being set correctly?
- Is the row being created?
- Is the row persisting?
- Is the migration running on every launch?

---

**Build command:**
```bash
npm run build
npx cap sync android
npx cap open android
# Build and install APK
```

**Ready to diagnose!** 🔍
