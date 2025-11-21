# is_viewed Flag - Deployment Checklist

## Pre-Deployment Verification

### Code Quality
- [x] No TypeScript errors
- [x] No ESLint warnings
- [x] All files saved
- [x] Code follows existing patterns
- [x] Error handling in place
- [x] Logging added for debugging

### Database Changes
- [x] Schema updated with `is_viewed` column
- [x] Migration added to `migrateDatabase()`
- [x] Default value set (0)
- [x] Column type correct (INTEGER)
- [x] No breaking changes to existing columns

### Type Safety
- [x] `LocalMessage` interface updated
- [x] All method signatures correct
- [x] Return types specified
- [x] Optional fields marked with `?`

### API Completeness
- [x] `markMessageAsViewed()` implemented
- [x] `markMessagesAsViewed()` implemented
- [x] `isMessageViewed()` implemented
- [x] `getViewedTempMessages()` implemented
- [x] `transferViewedStatus()` implemented
- [x] All methods exposed in public API

### Integration Points
- [x] ChatArea.tsx marks messages as viewed
- [x] realtimeActions.ts transfers viewed status
- [x] unreadTracker.markGroupAsRead() called
- [x] SQLite operations non-blocking
- [x] Error handling for all async operations

## Testing Checklist

### Unit Tests (Manual)
- [ ] Database migration runs successfully
- [ ] `is_viewed` column exists after migration
- [ ] `markMessageAsViewed()` updates database
- [ ] `markMessagesAsViewed()` batch operation works
- [ ] `isMessageViewed()` returns correct boolean
- [ ] `transferViewedStatus()` transfers correctly

### Integration Tests
- [ ] **Test 1**: Online message (baseline)
- [ ] **Test 2**: Offline message viewed before sync
- [ ] **Test 3**: Multiple offline messages
- [ ] **Test 4**: Offline message NOT viewed (control)
- [ ] **Test 5**: Ghost message offline

### Edge Case Tests
- [ ] App crash during sync
- [ ] Force quit before sync
- [ ] Network flakiness (multiple retry attempts)
- [ ] Rapid message sending (10+ messages)
- [ ] Mixed online/offline messages

### Performance Tests
- [ ] Query time < 1ms
- [ ] Batch operation < 5ms for 100 messages
- [ ] No UI lag when marking messages
- [ ] No memory leaks
- [ ] Database size increase acceptable

## Deployment Steps

### Step 1: Backup
```bash
# Backup current database (Android)
adb pull /data/data/com.confessr.app/databases/confessr_db ./backup/

# Backup current database (iOS)
# Use Xcode Device Manager to download app container
```

### Step 2: Build
```bash
# Clean build
npm run clean
npm install

# Build for Android
npm run build:android

# Build for iOS
npm run build:ios
```

### Step 3: Deploy to Test Device
```bash
# Android
npm run android

# iOS
npm run ios
```

### Step 4: Verify Migration
```bash
# Check if column exists
adb shell
cd /data/data/com.confessr.app/databases
sqlite3 confessr_db
.schema messages
# Should see: is_viewed INTEGER DEFAULT 0
.quit
```

### Step 5: Monitor Logs
```bash
# Android
adb logcat | grep -E "\[viewed\]|👁️|is_viewed|transferViewedStatus"

# iOS
# Use Xcode Console with same filters
```

### Step 6: Run Test Scenarios
- [ ] Complete Test 1 (online message)
- [ ] Complete Test 2 (offline message - CRITICAL)
- [ ] Complete Test 3 (multiple offline)
- [ ] Complete Test 4 (not viewed control)
- [ ] Complete Test 5 (ghost message)

### Step 7: Verify Results
- [ ] No unread separator above viewed offline messages
- [ ] Unread separator appears for non-viewed messages
- [ ] No errors in logs
- [ ] No crashes
- [ ] Performance acceptable

## Post-Deployment Monitoring

### Day 1
- [ ] Monitor crash reports
- [ ] Check error logs for SQLite errors
- [ ] Verify user reports (if any)
- [ ] Check performance metrics

### Week 1
- [ ] Review analytics for unread count accuracy
- [ ] Check for any edge cases reported
- [ ] Monitor database size growth
- [ ] Verify no performance degradation

### Month 1
- [ ] Confirm bug is fixed (no user reports)
- [ ] Review any related issues
- [ ] Consider cleanup of old viewed flags (optional)

## Rollback Procedure

If critical issues arise:

### Step 1: Identify Issue
- Check logs for specific error
- Reproduce issue if possible
- Determine if it's related to is_viewed flag

### Step 2: Quick Fix (If Possible)
- Fix specific bug
- Deploy hotfix
- Monitor

### Step 3: Full Rollback (If Necessary)

**Code Changes:**
```typescript
// 1. database.ts - Comment out column
// is_viewed INTEGER DEFAULT 0

// 2. database.ts - Comment out migration
// await ensureColumn('messages', 'is_viewed', 'INTEGER', 'DEFAULT 0');

// 3. ChatArea.tsx - Comment out marking logic
// Lines 130-150 (markMessagesAsViewed block)

// 4. realtimeActions.ts - Comment out transfer logic
// Lines 370-395 (transferViewedStatus block)
```

**Rebuild and Deploy:**
```bash
npm run clean
npm install
npm run build:android  # or build:ios
npm run android        # or ios
```

**Verify Rollback:**
- [ ] App runs without errors
- [ ] No SQLite errors in logs
- [ ] Original bug returns (expected)
- [ ] No new issues introduced

## Success Metrics

### Immediate (Day 1)
- ✅ Zero crashes related to is_viewed
- ✅ Zero SQLite errors in logs
- ✅ All test scenarios pass

### Short-term (Week 1)
- ✅ No user reports of unread separator bug
- ✅ Performance metrics unchanged
- ✅ Database size increase < 1%

### Long-term (Month 1)
- ✅ Bug confirmed fixed
- ✅ No related issues reported
- ✅ Feature stable in production

## Documentation

### Updated Documents
- [x] `IS_VIEWED_FLAG_IMPLEMENTATION.md` - Technical details
- [x] `TEST_IS_VIEWED_FLAG.md` - Testing guide
- [x] `IS_VIEWED_IMPLEMENTATION_SUMMARY.md` - Executive summary
- [x] `IS_VIEWED_FLOW_DIAGRAM.md` - Visual flow
- [x] `IS_VIEWED_DEPLOYMENT_CHECKLIST.md` - This document

### Code Comments
- [x] Database schema commented
- [x] Migration logic commented
- [x] Critical methods documented
- [x] Integration points explained

## Sign-off

### Developer
- [x] Code complete
- [x] Self-tested
- [x] Documentation complete
- [ ] Ready for QA

### QA
- [ ] Test plan executed
- [ ] All tests passed
- [ ] Edge cases verified
- [ ] Performance acceptable
- [ ] Ready for production

### Product Owner
- [ ] Feature reviewed
- [ ] Acceptance criteria met
- [ ] User impact understood
- [ ] Approved for production

## Emergency Contacts

**If issues arise:**
1. Check logs first (see monitoring section)
2. Review test scenarios to reproduce
3. Check rollback procedure if critical
4. Document any new edge cases found

## Notes

- This is a **low-risk change** (isolated, easy rollback)
- The fix addresses a **real user pain point**
- Implementation is **aligned with architecture** (local-first)
- Solution is **future-proof** (extensible pattern)

---

**Deployment Status**: ⏳ Ready for Testing
**Risk Level**: 🟢 Low
**Rollback Difficulty**: 🟢 Easy
**User Impact**: 🟢 Positive (bug fix)
