# 🧪 Test Guide: SQLite group_members Persistence Fix

## Quick Test (5 minutes)

### Test 1: Migration Only Runs Once
**Goal:** Verify migration doesn't drop table on every launch

1. Clear app data (Settings → Apps → Confessr → Clear Data)
2. Launch app
3. Check logs for:
   ```
   ✅ Foreign key CASCADE migration completed in XXXms
   ```
4. Force close app
5. Relaunch app
6. Check logs for:
   ```
   ✅ group_members already has CASCADE, skipping migration
   ```

**Expected:** Migration runs once, then skipped on subsequent launches

**Pass Criteria:** ✅ "skipping migration" appears on second launch

---

### Test 2: Read Status Persists Across Restarts
**Goal:** Verify group_members row survives app restart

1. Open a chat with unread messages
2. Scroll to bottom (marks as read)
3. Note the log:
   ```
   [sqlite] ✅ Updated local read status: {messageId: abc123...}
   ```
4. Close chat
5. Force close app
6. Relaunch app
7. Open same chat
8. Check logs for:
   ```
   [unread] 📊 LOCAL: last_read_message_id=abc123 (from previous session)
   ```

**Expected:** Same message ID loaded from SQLite

**Pass Criteria:** ✅ NO "FIRST TIME" log on second open

---

### Test 3: No FK Constraint Errors
**Goal:** Verify parent row checks prevent FK errors

1. Clear app data
2. Launch app (first-time init)
3. Monitor logs for:
   ```
   *** ERROR Run: FOREIGN KEY constraint failed (code 787)
   ```

**Expected:** Zero FK errors

**Pass Criteria:** ✅ No FK errors in logs

---

## Comprehensive Test (30 minutes)

### Test 4: Multiple Groups (50+)
**Goal:** Verify all groups saved successfully

1. Join 50+ groups (or use test account with many groups)
2. Clear app data
3. Launch app
4. Check logs for:
   ```
   ✅ Saved 50 groups to SQLite (waited XXXms)
   ```
5. Open each group sequentially
6. Monitor for FK errors

**Expected:** All groups saved, no FK errors

**Pass Criteria:** 
- ✅ All groups appear in UI
- ✅ Zero FK errors
- ✅ Save time < 2 seconds

---

### Test 5: Slow Network Conditions
**Goal:** Verify no race conditions with slow saves

1. Enable network throttling (Chrome DevTools → Network → Slow 3G)
2. Clear app data
3. Launch app
4. Monitor logs during first-time init
5. Check for FK errors

**Expected:** No FK errors even with slow network

**Pass Criteria:** 
- ✅ Zero FK errors
- ✅ All groups eventually saved
- ✅ Logs show actual wait times (not fixed delays)

---

### Test 6: Parent Row Missing Scenario
**Goal:** Verify graceful degradation when parent missing

1. Use SQLite browser to manually delete a group row
2. Try to open that group's chat
3. Check logs for:
   ```
   [sqlite] ⚠️ Group XXX not in SQLite yet, skipping group_members creation
   ```

**Expected:** Warning logged, no crash, app continues

**Pass Criteria:**
- ✅ Warning appears in logs
- ✅ No FK constraint error
- ✅ App doesn't crash
- ✅ Group re-synced from Supabase

---

### Test 7: Health Check on Launch
**Goal:** Verify health check runs and reports correctly

1. Launch app
2. Check logs for:
   ```
   [sqlite-monitoring] 🏥 Health check results:
   tableExists: ✅
   hasCascade: ✅
   hasRows: ✅ (or ⚠️ if no groups joined yet)
   isEncrypted: ✅
   ```

**Expected:** Health check passes

**Pass Criteria:** ✅ All checks pass (or expected warnings)

---

### Test 8: Monitoring Data Flows
**Goal:** Verify monitoring tracks metrics correctly

1. Clear app data
2. Launch app
3. Open a chat (first time)
4. Close and reopen same chat
5. Check console for monitoring logs:
   ```
   [sqlite-monitoring] 📊 Migration success in XXXms
   [sqlite-monitoring] ⏱️ Saved X groups in XXXms
   [sqlite-monitoring] 📝 FIRST TIME log for group XXX (count: 1)
   ```

**Expected:** All metrics tracked

**Pass Criteria:**
- ✅ Migration tracked
- ✅ Group save tracked
- ✅ "FIRST TIME" tracked
- ✅ Alert if "FIRST TIME" appears > 2 times for same group

---

## Performance Benchmarks

### Benchmark 1: Group Save Performance
**Target:** < 2 seconds for 50 groups

1. Clear app data
2. Launch app with 50 groups
3. Measure time from "Fetching groups" to "Saved X groups"

**Pass Criteria:** ✅ < 2 seconds (p95)

---

### Benchmark 2: Migration Check Performance
**Target:** < 50ms

1. Launch app (migration already run)
2. Measure time for migration check

**Pass Criteria:** ✅ < 50ms

---

### Benchmark 3: Parent Row Check Performance
**Target:** < 10ms per check

1. Open a chat
2. Measure time for parent row validation

**Pass Criteria:** ✅ < 10ms

---

## Regression Tests

### Regression 1: Read Status Still Works
**Goal:** Ensure fix didn't break existing functionality

1. Open chat with unread messages
2. Scroll to bottom
3. Verify unread count decreases
4. Verify separator disappears

**Pass Criteria:** ✅ Read status works as before

---

### Regression 2: Offline Mode Still Works
**Goal:** Ensure offline functionality intact

1. Enable airplane mode
2. Open app
3. Verify local data loads
4. Send message (goes to outbox)
5. Disable airplane mode
6. Verify message sends

**Pass Criteria:** ✅ Offline mode works

---

## Edge Cases

### Edge Case 1: Rapid App Restarts
**Goal:** Verify migration idempotency under load

1. Clear app data
2. Launch app 10 times in rapid succession (force close between)
3. Check logs for migration status

**Expected:** Migration runs once, skipped on all subsequent launches

**Pass Criteria:** ✅ No data corruption, migration only runs once

---

### Edge Case 2: Corrupted Database
**Goal:** Verify recovery from corruption

1. Manually corrupt database file (or delete it)
2. Launch app
3. Check if app recovers

**Expected:** App recreates database, runs migration

**Pass Criteria:** ✅ App recovers gracefully

---

## Monitoring Dashboard Checks

### Check 1: FK Error Rate
**Metric:** FK errors per user
**Target:** < 0.1%

**How to Check:**
1. Open analytics dashboard
2. Navigate to "SQLite Metrics"
3. Check "FK Error Rate" graph

**Pass Criteria:** ✅ < 0.1% of users experience FK errors

---

### Check 2: Migration Success Rate
**Metric:** % of users who complete migration successfully
**Target:** > 99%

**How to Check:**
1. Open analytics dashboard
2. Check "Migration Success Rate"

**Pass Criteria:** ✅ > 99% success rate

---

### Check 3: "FIRST TIME" Frequency
**Metric:** Average "FIRST TIME" logs per user per group
**Target:** < 1.5 (allowing for some legitimate first opens)

**How to Check:**
1. Open analytics dashboard
2. Check "First Time Log Frequency"

**Pass Criteria:** ✅ < 1.5 average per user per group

---

## Automated Test Script

```bash
#!/bin/bash
# Quick automated test script

echo "🧪 Running SQLite Persistence Tests..."

# Test 1: Build app
echo "📦 Building app..."
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Build failed"
  exit 1
fi
echo "✅ Build successful"

# Test 2: Type check
echo "🔍 Type checking..."
npm run type-check
if [ $? -ne 0 ]; then
  echo "❌ Type check failed"
  exit 1
fi
echo "✅ Type check passed"

# Test 3: Lint
echo "🔍 Linting..."
npm run lint
if [ $? -ne 0 ]; then
  echo "⚠️ Lint warnings (non-blocking)"
fi

echo "✅ All automated tests passed!"
echo "📱 Now test on device using manual test cases above"
```

---

## Test Results Template

```markdown
## Test Results - [Date]

### Environment
- Device: [e.g., iPhone 14 Pro, Android Pixel 7]
- OS Version: [e.g., iOS 17.1, Android 14]
- App Version: [e.g., 1.2.3]
- Tester: [Name]

### Quick Tests
- [ ] Test 1: Migration Only Runs Once - PASS/FAIL
- [ ] Test 2: Read Status Persists - PASS/FAIL
- [ ] Test 3: No FK Errors - PASS/FAIL

### Comprehensive Tests
- [ ] Test 4: Multiple Groups - PASS/FAIL
- [ ] Test 5: Slow Network - PASS/FAIL
- [ ] Test 6: Parent Row Missing - PASS/FAIL
- [ ] Test 7: Health Check - PASS/FAIL
- [ ] Test 8: Monitoring Data - PASS/FAIL

### Performance Benchmarks
- Group Save (50 groups): [XXX]ms (Target: < 2000ms)
- Migration Check: [XX]ms (Target: < 50ms)
- Parent Row Check: [X]ms (Target: < 10ms)

### Issues Found
[List any issues discovered during testing]

### Notes
[Any additional observations]

### Overall Result
✅ PASS / ❌ FAIL

### Sign-off
Tested by: [Name]
Date: [Date]
Approved for: [ ] Staging [ ] Production
```

---

## Troubleshooting

### Issue: Migration runs on every launch
**Symptom:** Logs show "Migrating tables" on every app open

**Diagnosis:**
1. Check if `group_members` table has CASCADE
2. Run: `PRAGMA foreign_key_list(group_members);`
3. Look for `on_delete: 'CASCADE'`

**Fix:** Clear app data and relaunch (migration should run once)

---

### Issue: FK errors still occurring
**Symptom:** Logs show "FOREIGN KEY constraint failed (code 787)"

**Diagnosis:**
1. Check if parent row checks are running
2. Look for logs: "⚠️ Group XXX not in SQLite yet"
3. If no warning, parent check might be failing

**Fix:** Verify parent row check logic in `memberOperations.ts`

---

### Issue: "FIRST TIME" appears multiple times
**Symptom:** Same group shows "FIRST TIME" on every open

**Diagnosis:**
1. Check if migration is running on every launch
2. Check if group_members row is being created
3. Check if row persists after app restart

**Fix:** Verify migration fix is in place

---

## Success Criteria Summary

✅ **PASS** if ALL of the following are true:
- Migration only runs once per database
- Read status persists across app restarts
- Zero FK constraint errors
- All groups saved successfully
- Health checks pass
- Monitoring data flows correctly
- Performance targets met

❌ **FAIL** if ANY of the following occur:
- Migration runs on every launch
- Read status lost on restart
- FK errors in logs
- App crashes
- Performance targets missed

---

**Ready to Test?** Start with Quick Tests (5 min), then move to Comprehensive Tests if all pass.
