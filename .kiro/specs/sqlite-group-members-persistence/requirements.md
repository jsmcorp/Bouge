# SQLite group_members Persistence Issue - Requirements

## Problem Statement

The `group_members` table row in SQLite is not persisting across app sessions, causing read status (last_read_at, last_read_message_id) to be lost on every app restart or chat reopen. This results in:

1. **Unread separator appearing incorrectly** - Shows on every chat open, even for old messages
2. **Read status never persisting** - User's read progress is lost between sessions
3. **"FIRST TIME" behavior on every open** - System treats every chat open as if it's the first time
4. **Foreign key constraint errors** - When trying to create group_members rows before parent rows exist

## Current Behavior (Broken)

### Symptom 1: Row Recreation on Every Chat Open
```
Chat Open #1 (22:14:50):
[unread] 📥 FIRST TIME: No local group_members row, creating locally...
[unread] ✅ Created local group_members row (never read)
[unread] 📊 LOCAL: last_read_message_id=355d1b31 (synced from Supabase)

Chat Reopen #2 (22:14:57) - Just 7 seconds later:
[unread] 📥 FIRST TIME: No local group_members row ← WHY AGAIN?!
[unread] ✅ Created local group_members row ← RECREATING!
[unread] 📊 LOCAL: last_read_message_id=null ← BACK TO NULL!
```

### Symptom 2: Foreign Key Constraint Failures
```
18:59:31.695 [unread] 📥 FIRST TIME: No local group_members row, creating locally...
18:59:31.721 *** ERROR Run: FOREIGN KEY constraint failed (code 787)
18:59:31.730 [unread] ⚠️ Failed to ensure local group_members row
```

## Root Causes Identified

### Root Cause #1: CASCADE Migration Running on Every App Open

**Location:** `src/lib/sqliteServices_Refactored/database.ts` - `migrateForeignKeysWithCascade()`

**Issue:** The migration check only examines the `reactions` table to determine if CASCADE migration is needed. If `reactions` doesn't have CASCADE, it assumes NO tables have it and runs the ENTIRE migration, which drops and recreates ALL tables including `group_members`.

**Code:**
```typescript
// ❌ BUG: Only checks reactions table
const fkCheck = await this.db!.query('PRAGMA foreign_key_list(reactions);');
const hasCascade = (fkCheck.values || []).some((fk: any) => 
  fk.on_delete === 'CASCADE'
);

if (hasCascade) {
  return; // Skip migration
}

// If reactions doesn't have CASCADE, run ENTIRE migration
// This drops ALL tables including group_members!
await this.db!.execute('DROP TABLE group_members;');
await this.db!.execute('ALTER TABLE group_members_new RENAME TO group_members;');
```

**Impact:** Every time the app opens and the check fails, the `group_members` table is dropped and recreated, losing all read status data.

### Root Cause #2: Foreign Key Constraint Violations

**Location:** `src/lib/sqliteServices_Refactored/memberOperations.ts` - `updateLocalLastReadAt()` and `syncReadStatusFromSupabase()`

**Issue:** When creating a `group_members` row, the code doesn't verify that the parent rows exist in the `groups` and `users` tables. The `group_members` table has two foreign keys:
- `group_id` → `groups(id)` 
- `user_id` → `users(id)`

**Code:**
```typescript
// ❌ No parent row existence check
await db.run(
  `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
   VALUES (?, ?, 'participant', ?, ?, ?);`,
  [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
);
```

**Impact:** If either the group or user doesn't exist in SQLite yet, the INSERT fails with FK constraint error (code 787), preventing the read status from being saved.

### Root Cause #3: Race Condition in First-Time Initialization

**Location:** `src/store/chatstore_refactored/fetchActions.ts` - `fetchMessages()`

**Issue:** During first-time initialization, the orchestrator calls operations in sequence:
1. `fetchGroups()` - Saves groups to SQLite in background (async, no await)
2. Wait 1000ms
3. `fetchGroupMembers()` - Requires groups to exist
4. Wait 500ms
5. `fetchMessages()` - Tries to create group_members row

**Problem:** `fetchMessages()` may be called before `fetchGroups()` has finished saving all groups to SQLite, causing FK constraint errors for groups that haven't been saved yet.

**Timing Issue:**
- If you have 10 groups, groups 1-5 might be saved in 500ms
- Groups 6-10 might take 1500ms
- Fixed wait of 1000ms only helps groups 1-5
- Groups 6-10 still fail with FK errors

## Expected Behavior (Fixed)

### First App Launch (After Clear Data)
```
🔄 Checking if foreign key CASCADE migration is needed...
🔄 Migrating tables to add ON DELETE CASCADE...
✅ Foreign key CASCADE migration completed
```

### Second App Launch (And All Subsequent Launches)
```
🔄 Checking if foreign key CASCADE migration is needed...
✅ group_members already has CASCADE, skipping migration
```

### First Chat Open
```
[unread] 📥 FIRST TIME: No local group_members row, creating locally...
[unread] 📊 LOCAL: last_read_message_id=null (FIRST TIME)
[unread] ✅ Created local group_members row
```

### Second Chat Open (SHOULD NOT Say "FIRST TIME")
```
[unread] 📊 LOCAL: last_read_message_id=abc123 (from previous session)
[unread] 📊 Separator will show BELOW abc123
```

### After Marking Messages as Read
```
[unread] 📊 LOCAL: last_read_message_id=xyz789 (updated)
[sqlite] ✅ Updated local read status
```

### Next App Open (Read Status Persisted)
```
[unread] 📊 LOCAL: last_read_message_id=xyz789 (PERSISTED!)
```

## Requirements

### REQ-1: Prevent CASCADE Migration from Running on Every App Open
**Priority:** CRITICAL  
**Description:** The CASCADE migration check must examine the `group_members` table specifically (not just `reactions`) to determine if migration is needed. This prevents the table from being dropped and recreated on every app launch.

**Acceptance Criteria:**
- Migration check queries `PRAGMA foreign_key_list(group_members)` 
- If `group_members` already has CASCADE, skip migration entirely
- Log "✅ group_members already has CASCADE, skipping migration" when skipped
- Migration only runs once per database (on first launch after clear data)
- Subsequent app launches skip migration and preserve all data

### REQ-2: Validate Parent Row Existence Before Creating group_members Row
**Priority:** CRITICAL  
**Description:** Before inserting a row into `group_members`, verify that both parent rows exist in the `groups` and `users` tables to prevent FK constraint violations.

**Acceptance Criteria:**
- Check if `groups` table contains the `group_id` before INSERT
- Check if `users` table contains the `user_id` before INSERT
- If either parent row is missing, log warning and skip INSERT gracefully
- Log includes helpful message: "💡 TIP: Current user should be saved during first-time init Step 0"
- No FK constraint errors (code 787) in logs
- System continues to function even if INSERT is skipped

### REQ-3: Ensure Current User Exists in SQLite Before Creating group_members Rows
**Priority:** HIGH  
**Description:** The first-time initialization orchestrator must ensure the current user is saved to the `users` table in SQLite before any operations that create `group_members` rows.

**Acceptance Criteria:**
- Step 0 of orchestrator: Save current user to SQLite
- Log: "✅ [INIT-ORCHESTRATOR] Step 0/5 complete: Current user saved to SQLite"
- This step completes before any group operations
- User row includes: id, display_name, phone_number, avatar_url, is_onboarded, created_at
- Subsequent operations can safely create group_members rows

### REQ-4: Persist group_members Row Across App Sessions
**Priority:** CRITICAL  
**Description:** Once a `group_members` row is created with read status, it must persist across app restarts, chat reopens, and navigation events.

**Acceptance Criteria:**
- Row survives app restart (cold start)
- Row survives chat close/reopen
- Row survives navigation away and back
- `last_read_at` and `last_read_message_id` values are preserved
- No "FIRST TIME" log on subsequent opens (only on truly first open)
- Database uses persistent storage (not in-memory)

### REQ-5: Use INSERT OR REPLACE for group_members Row Creation
**Priority:** MEDIUM  
**Description:** When creating or updating `group_members` rows, use `INSERT OR REPLACE` or check-then-insert pattern to handle cases where row may already exist.

**Acceptance Criteria:**
- Check if row exists before INSERT
- If exists, UPDATE only the read status fields
- If not exists, INSERT with default values
- No duplicate key errors
- Preserves existing `role` and `joined_at` values when updating

### REQ-6: Graceful Degradation When SQLite Operations Fail
**Priority:** MEDIUM  
**Description:** If SQLite operations fail (FK errors, write errors, etc.), the app should continue to function with degraded read status tracking rather than crashing.

**Acceptance Criteria:**
- FK constraint errors are caught and logged as warnings
- User can still view and send messages
- Unread separator may not appear (acceptable degradation)
- Error logs include context: group_id, user_id, operation attempted
- No app crashes or UI freezes

### REQ-7: Verify Database Persistence Configuration
**Priority:** HIGH  
**Description:** Ensure the SQLite database is configured for persistent storage (not in-memory) and uses proper encryption settings.

**Acceptance Criteria:**
- Database name: `confessr_db`
- Location: `Library/CapacitorDatabase` (iOS) or equivalent (Android)
- Encryption: Enabled with secret mode
- Not using `:memory:` database
- Database file persists across app restarts
- Can be verified with file system inspection

### REQ-8: Synchronous Parent Row Guarantees (Race Condition Fix)
**Priority:** CRITICAL  
**Description:** Ensure parent rows (`groups` and `users`) are committed to SQLite **before** any child operations attempt to create `group_members` rows. Replace brittle fixed timeouts with actual completion signals.

**Problem:** Current implementation uses fixed delays (wait 1000ms) which assumes all groups will be saved within that time. This is unreliable:
- If you have 10 groups, groups 1-5 might save in 500ms
- Groups 6-10 might take 1500ms  
- Fixed wait of 1000ms only protects groups 1-5
- Groups 6-10 fail with FK errors

**Acceptance Criteria:**
- `fetchGroups()` returns a Promise that resolves **only when ALL groups are saved to SQLite**
- `fetchGroupMembers()` awaits `fetchGroups()` completion before starting
- `fetchMessages()` awaits both `fetchGroups()` and user save completion before creating group_members rows
- No fixed timeouts (no `await delay(1000)`) - use actual completion signals
- Log includes actual wait time: "✅ Saved 10 groups to SQLite (waited 547ms)"
- 100% guarantee parent rows exist before child inserts
- If save fails, operation is skipped with warning (not error)

**Implementation Pattern:**
```typescript
// ❌ BAD: Fire and forget with fixed timeout
fetchGroups(); // async, might not finish
await delay(1000); // Hope it's done?
fetchGroupMembers(); // Might fail with FK error

// ✅ GOOD: Wait for actual completion
await fetchGroupsSync(); // Returns when SQLite writes complete
await fetchGroupMembersSync(); // Safe because groups exist
await fetchMessagesSync(); // Safe because groups + members exist
```

**Code Changes Required:**
1. `fetchGroups()` - Change SQLite save from fire-and-forget to awaited Promise.all()
2. `fetchGroupMembers()` - Add precondition check: verify group exists in SQLite
3. `fetchMessages()` - Add precondition checks: verify group AND user exist in SQLite
4. First-time init orchestrator - Remove fixed delays, use await on each step

### REQ-9: Defensive Precondition Checks in All Child Operations
**Priority:** HIGH  
**Description:** Every operation that creates a `group_members` row must verify parent rows exist BEFORE attempting INSERT, even if orchestrator guarantees are in place. This provides defense-in-depth.

**Acceptance Criteria:**
- All functions that INSERT into `group_members` check parent rows first
- Check both `groups` table and `users` table
- If parent missing, log warning with context and skip operation gracefully
- Warning includes: operation name, group_id, user_id, which parent is missing
- Operation continues without throwing error
- Retry mechanism: Operation can be retried later when parent exists

**Functions Requiring Checks:**
- `memberOperations.updateLocalLastReadAt()`
- `memberOperations.syncReadStatusFromSupabase()`
- `fetchActions.fetchMessages()` (when creating initial group_members row)
- Any other function that INSERTs into `group_members`

**Example Check:**
```typescript
// Check #1: Group exists
const groupCheck = await db.query(`SELECT id FROM groups WHERE id = ?`, [groupId]);
if (!groupCheck.values || groupCheck.values.length === 0) {
  console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
  return; // Skip - group not saved yet
}

// Check #2: User exists (CRITICAL - this is usually the missing one!)
const userCheck = await db.query(`SELECT id FROM users WHERE id = ?`, [userId]);
if (!userCheck.values || userCheck.values.length === 0) {
  console.warn(`[sqlite] ⚠️ User ${userId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
  console.warn(`[sqlite] 💡 TIP: Current user should be saved during first-time init Step 0`);
  return; // Skip - user not saved yet, prevents FK constraint error
}
```

## Monitoring and Observability Requirements

### MON-1: Production Error Tracking
**Priority:** HIGH  
**Description:** Track and alert on SQLite-related errors in production to detect if bugs return or new issues emerge.

**Metrics to Track:**
- FK constraint errors (code 787) - Alert if rate > 1% of users
- "FIRST TIME" log frequency - Alert if appears > 2x per user per day per group
- Migration failures - Alert if any user fails migration
- group_members row creation failures - Track success/failure rate
- Parent row missing warnings - Track frequency by group_id and user_id

**Dashboard Requirements:**
- Migration success rate (% of users)
- FK error rate by group_id (identify problematic groups)
- Average time to create group_members row
- Read status persistence rate (% of users with working read status)
- Time-series graph of FK errors (detect regressions)

**Alert Thresholds:**
- CRITICAL: FK error rate > 5% of users
- WARNING: FK error rate > 1% of users
- WARNING: "FIRST TIME" log > 3x per user per group per day
- INFO: Migration took > 5 seconds

### MON-2: Health Checks on App Launch
**Priority:** MEDIUM  
**Description:** Verify database integrity on every app launch and report issues to analytics.

**Checks to Perform:**
- `group_members` table exists
- `group_members` has CASCADE foreign keys (verify migration ran)
- At least 1 row exists in `group_members` for current user (after first group join)
- Database file is persistent (not in-memory)
- Encryption is enabled

**On Check Failure:**
- Log full context to analytics (which check failed, database state)
- Show user notification: "Updating chat database..." (if auto-fix attempted)
- Attempt auto-fix if possible (e.g., re-run migration)
- If auto-fix fails, log error and continue with degraded functionality

**Success Criteria:**
- Health check completes in < 100ms
- No false positives (checks are accurate)
- User is informed if database needs repair
- Analytics capture 100% of health check failures

### MON-3: User-Reported Issues
**Priority:** MEDIUM  
**Description:** Provide tools for users to report read status issues and capture diagnostic data.

**In-App Bug Report:**
- Add button in settings: "Report read status issue"
- Captures last 500 lines of logs
- Includes database schema dump (table structure, not data)
- Includes row counts for key tables (groups, users, group_members)
- Includes migration status (did it run? when?)
- Uploads to analytics with user consent

**Crash Reports:**
- Include SQLite error logs in crash reports
- Include last 10 SQLite operations before crash
- Include database health check results
- Include migration history

**User Feedback:**
- Prompt user after 7 days: "Is your read status working correctly?"
- If user says "No", trigger bug report flow
- Track % of users reporting issues

### MON-4: Performance Monitoring
**Priority:** LOW  
**Description:** Track performance of SQLite operations to detect slowdowns.

**Metrics to Track:**
- Time to save group to SQLite (p50, p95, p99)
- Time to create group_members row (p50, p95, p99)
- Time to query read status (p50, p95, p99)
- Time for migration to complete (p50, p95, p99)
- Number of groups processed per second during init

**Alert Thresholds:**
- WARNING: p95 > 500ms for any operation
- CRITICAL: p95 > 2000ms for any operation

## Non-Functional Requirements

### NFR-1: Performance
- Migration check should complete in < 50ms
- Parent row existence checks should complete in < 10ms each
- No blocking operations during message display
- Background operations should not delay UI updates
- `fetchGroups()` with SQLite save should complete in < 2 seconds for 50 groups
- First-time init should complete in < 10 seconds total

### NFR-2: Data Integrity
- No data loss during migration
- Foreign key constraints enforced
- Transactions used for multi-step operations
- Rollback on error
- Atomic operations: Either all groups saved or none
- Idempotent operations: Can be safely retried

### NFR-3: Observability
- Clear log messages for each operation
- Error logs include full context (IDs, operation, error code)
- Success logs confirm data persistence
- Migration status logged on every app launch
- Timing logs for all async operations (actual wait time, not just "done")
- Log level: INFO for success, WARN for skipped operations, ERROR for failures

### NFR-4: Maintainability
- Defensive coding: Check preconditions before operations
- Fail gracefully: Continue with degraded functionality on error
- Clear comments explaining FK relationships
- Consistent error handling patterns
- No magic numbers: Use named constants for timeouts/limits
- Self-documenting code: Function names describe what they guarantee

## Out of Scope

- Syncing read status to Supabase (separate feature)
- Optimistic UI updates for read status
- Batch operations for multiple groups
- Migration rollback mechanism
- Database backup/restore functionality

## Testing Requirements

### Test Case 1: Fresh Install
1. Install app on clean device
2. Complete onboarding
3. Open a chat
4. Verify "FIRST TIME" log appears
5. Close and reopen chat
6. Verify NO "FIRST TIME" log on second open
7. Verify read status persists

### Test Case 2: App Restart
1. Open chat and mark messages as read
2. Note the `last_read_message_id` in logs
3. Force close app
4. Reopen app
5. Open same chat
6. Verify same `last_read_message_id` is loaded
7. Verify separator appears in correct position

### Test Case 3: Multiple Groups
1. Join 10+ groups
2. Open each group sequentially
3. Verify no FK constraint errors in logs
4. Verify all groups create group_members rows successfully
5. Verify read status persists for all groups

### Test Case 4: Migration Idempotency
1. Clear app data
2. Launch app (migration runs)
3. Verify "✅ Foreign key CASCADE migration completed" in logs
4. Close and reopen app
5. Verify "✅ group_members already has CASCADE, skipping migration" in logs
6. Verify no data loss

### Test Case 5: Race Condition Handling
1. Clear app data
2. Launch app (first-time init)
3. Monitor logs for FK constraint errors
4. Verify all groups are processed successfully
5. Verify no crashes or hangs
6. Verify logs show actual wait times (not fixed delays)
7. Verify "✅ Saved X groups to SQLite (waited Yms)" appears

### Test Case 6: Slow Network Conditions
1. Enable network throttling (slow 3G)
2. Clear app data
3. Launch app (first-time init with 20+ groups)
4. Verify no FK constraint errors even with slow saves
5. Verify all groups eventually saved
6. Verify no timeouts or hangs
7. Verify read status works after init completes

### Test Case 7: Parent Row Missing Scenario
1. Manually delete a group from SQLite (simulate corruption)
2. Try to open that group's chat
3. Verify warning logged: "Group not in SQLite yet"
4. Verify no FK constraint error
5. Verify app continues to function
6. Verify group is re-synced from Supabase

### Test Case 8: Migration Idempotency Under Load
1. Clear app data
2. Launch app 10 times in rapid succession (force close between launches)
3. Verify migration only runs once (on first launch)
4. Verify subsequent launches skip migration
5. Verify no data corruption
6. Verify all group_members rows persist

## Success Metrics

### Critical Metrics (Must Achieve)
- **Zero FK constraint errors** in production logs (< 0.1% acceptable during rollout)
- **Zero "FIRST TIME" logs** on subsequent chat opens (after first open for same group)
- **100% read status persistence** across app restarts
- **Zero data loss** during migrations
- **100% migration success rate** (all users complete migration successfully)

### Performance Metrics (Target)
- **< 100ms** for group_members row operations (p95)
- **< 2 seconds** for fetchGroups() with SQLite save for 50 groups (p95)
- **< 10 seconds** for complete first-time initialization (p95)
- **< 50ms** for migration check (p95)

### Quality Metrics (Target)
- **> 95%** user satisfaction with read status feature
- **< 1%** of users report read status issues
- **< 5** bug reports per 1000 users per month related to read status
- **Zero** crashes related to SQLite operations

### Monitoring Metrics (Operational)
- **100%** of FK errors captured in analytics
- **100%** of migration failures captured in analytics
- **< 1 hour** time to detect production issues (via alerts)
- **< 24 hours** time to deploy hotfix for critical issues

## Dependencies

- `@capacitor-community/sqlite` - SQLite plugin
- `@capacitor/core` - Capacitor platform detection
- Supabase client - For remote sync (out of scope for this fix)

## Files Affected

1. `src/lib/sqliteServices_Refactored/database.ts` - Migration check fix
2. `src/lib/sqliteServices_Refactored/memberOperations.ts` - FK validation
3. `src/store/chatstore_refactored/fetchActions.ts` - Race condition handling
4. `capacitor.config.ts` - Database configuration (verify only)

## Rollout Plan

### Phase 1: Fix CASCADE Migration (CRITICAL)
**Timeline:** Day 1  
**Tasks:**
- Update migration check to examine `group_members` table
- Add logging for migration status
- Deploy to staging environment
- Test with 10 devices (fresh install + upgrade scenarios)
- Verify migration only runs once
- Verify no data loss

**Success Criteria:**
- 100% of test devices complete migration successfully
- Zero FK errors in staging logs
- Migration check completes in < 50ms

### Phase 2: Fix Race Conditions (CRITICAL)
**Timeline:** Day 2-3  
**Tasks:**
- Replace fixed delays with actual completion signals
- Make `fetchGroups()` await SQLite saves
- Add precondition checks to all child operations
- Add timing logs for all async operations
- Deploy to staging
- Test with slow network conditions (throttled 3G)
- Test with 50+ groups

**Success Criteria:**
- Zero FK errors even with slow network
- All groups saved successfully
- Logs show actual wait times (not fixed delays)
- No timeouts or hangs

### Phase 3: Add Monitoring (HIGH)
**Timeline:** Day 4  
**Tasks:**
- Implement analytics tracking for FK errors
- Implement health checks on app launch
- Add performance monitoring
- Set up alerts for critical thresholds
- Deploy to staging
- Verify analytics data flows correctly

**Success Criteria:**
- FK errors appear in analytics dashboard
- Health check runs on every app launch
- Alerts trigger correctly in test scenarios

### Phase 4: Canary Rollout (5% of users)
**Timeline:** Day 5-7  
**Tasks:**
- Deploy to 5% of production users
- Monitor analytics dashboard 24/7
- Watch for FK error rate
- Watch for migration failures
- Collect user feedback

**Success Criteria:**
- FK error rate < 1%
- Migration success rate > 99%
- No increase in crash rate
- No critical alerts triggered

### Phase 5: Gradual Rollout (25% → 50% → 100%)
**Timeline:** Day 8-14  
**Tasks:**
- Increase to 25% of users (Day 8)
- Monitor for 2 days
- Increase to 50% of users (Day 10)
- Monitor for 2 days
- Increase to 100% of users (Day 12)
- Monitor for 2 days

**Success Criteria at Each Stage:**
- FK error rate remains < 1%
- No increase in user-reported issues
- Read status persistence working for > 95% of users

### Phase 6: Post-Rollout Monitoring
**Timeline:** Day 15-30  
**Tasks:**
- Continue monitoring analytics
- Respond to user reports within 24 hours
- Collect feedback on read status feature
- Measure success metrics

**Success Criteria:**
- All critical metrics achieved
- User satisfaction > 95%
- Zero critical bugs reported

## Risks and Mitigations

### Risk 1: Migration Breaks Existing Data
**Mitigation:** Migration check prevents re-running on existing databases. Only runs on fresh installs.

### Risk 2: Performance Impact from FK Checks
**Mitigation:** Checks are simple SELECT queries with indexed columns. Impact < 10ms per operation.

### Risk 3: Users Need to Clear App Data
**Mitigation:** If migration already ran incorrectly, users may need to clear data. Document this in release notes.

### Risk 4: Race Conditions Still Occur
**Mitigation:** 
- Replace fixed delays with actual completion signals (REQ-8)
- Add defensive precondition checks (REQ-9)
- FK validation provides graceful degradation
- System continues to function even if some operations fail
- Operations can be retried later when parent rows exist

### Risk 5: Monitoring Overhead Impacts Performance
**Mitigation:**
- Analytics calls are async and non-blocking
- Health checks run only on app launch (not on every operation)
- Performance monitoring uses sampling (not 100% of operations)
- Logs are buffered and uploaded in batches

### Risk 6: False Positive Alerts
**Mitigation:**
- Alert thresholds are set conservatively (> 1% error rate)
- Alerts require sustained error rate (not single spike)
- Dashboard shows context (which groups, which users)
- On-call engineer can investigate before escalating

### Risk 7: Users Don't Report Issues
**Mitigation:**
- Proactive prompt after 7 days: "Is read status working?"
- Easy bug report button in settings
- Analytics capture issues automatically (don't rely on user reports)
- Health checks detect issues before user notices

## References

- Log45: FK constraint error evidence
- SQLITE_ROW_DELETION_FIX.md: CASCADE migration issue
- LOG45_REAL_ROOT_CAUSE_ANALYSIS.md: FK constraint analysis
- Database schema: `src/lib/sqliteServices_Refactored/database.ts`
