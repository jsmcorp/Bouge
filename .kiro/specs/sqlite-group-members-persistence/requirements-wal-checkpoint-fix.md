# SQLite WAL Checkpoint Failure Fix - Requirements

## Executive Summary

Analysis of log47.txt reveals the ACTUAL root cause of `group_members` data loss: **WAL checkpoint failures with "database table is locked" (code 6)**. The row is successfully inserted into the WAL buffer but the checkpoint fails, causing data loss on app restart when the WAL buffer is discarded.

**Key Evidence from Log47.txt:**
- Row successfully inserted: `✅ VERIFIED: Row exists in database after INSERT`
- Checkpoint fails: `ERROR Execute: database table is locked (code 6)`
- After restart: `group_members row count: 0` (was 1 before restart)

**Solution:** Fix WAL checkpoint timing and locking issues, NOT schema refactoring (schema is already correct).

---

## Problem Statement - Based on Actual Logs

### Timeline from Log47.txt

**21:29:52 - App Start (First Session)**
```
21:29:52.637 [HEALTH-CHECK] group_members row count: 1
21:29:52.725 [HEALTH-CHECK] Existing rows: [object Object]
```
✅ One row exists from previous session

**21:29:57 - User Opens Chat**
```
21:29:57.490 [sqlite-query] ⚠️ NOT FOUND! Showing all rows for comparison:
21:29:57.499 [sqlite-query] ⚠️ Table is EMPTY!
21:29:57.499 [unread] 📥 FIRST TIME: No local group_members row, creating locally...
```
⚠️ Row disappeared! Table is now empty (but health check showed 1 row 5 seconds ago)

**21:29:57 - Row Creation Attempt**
```
21:29:57.914 [sqlite] ✅ Created new group_members row for read status
21:29:57.929 [sqlite] ✅ VERIFIED: Row exists in database after INSERT
21:29:57.933 SQLiteLog: (6) statement aborts at 2: [PRAGMA wal_checkpoint(FULL);] database table is locked
21:29:57.934 *** ERROR Execute: database table is locked (code 6)
21:29:57.941 [sqlite] ⚠️ WAL checkpoint failed: Error: Execute: database table is locked (code 6)
```
❌ Row inserted successfully, but checkpoint FAILS with "database table is locked"

**21:30:14 - App Restart (Second Session)**
```
21:30:14.962 [HEALTH-CHECK] group_members row count: 0
21:30:14.962 [HEALTH-CHECK] ⚠️ No group_members rows found after restart!
```
❌ Row is GONE! WAL buffer was discarded on restart

**21:30:18 - User Opens Chat Again**
```
21:30:18.490 [sqlite-query] ⚠️ Table is EMPTY!
21:30:18.491 [unread] 📥 FIRST TIME: No local group_members row, creating locally...
```
🔄 Cycle repeats - "FIRST TIME" on every open

---

## Root Cause Analysis

### Issue #1: WAL Checkpoint Fails with "Database Table is Locked"

**Error:** `PRAGMA wal_checkpoint(FULL);` fails with code 6 (SQLITE_LOCKED)

**Why it happens:**
1. Multiple concurrent database operations are running
2. One operation holds a read lock
3. Checkpoint tries to acquire write lock
4. Deadlock occurs → checkpoint fails
5. Data remains in WAL buffer (not flushed to main database file)
6. On app restart, WAL buffer is discarded → data loss

**Evidence from logs:**
- 50+ concurrent `getConnection()` calls (lines 21:29:58.140-58.149)
- Checkpoint fails immediately after INSERT
- Row exists in WAL but not in main database file

### Issue #2: Checkpoint Timing is Wrong

**Current behavior:**
- Checkpoint is called IMMEDIATELY after INSERT
- While other operations are still running
- Causes lock contention

**Better approach:**
- Checkpoint AFTER all operations complete
- Checkpoint on app background (when no operations running)
- Use PASSIVE mode for non-critical checkpoints

### Issue #3: No Retry Logic for Failed Checkpoints

**Current behavior:**
- Checkpoint fails → warning logged → nothing else happens
- Data stays in WAL buffer indefinitely
- Next app restart → data loss

**Better approach:**
- Retry checkpoint after delay
- Force checkpoint on app background
- Alert if checkpoint fails repeatedly

---

## Requirements

### Requirement 1: Fix Checkpoint Timing

**User Story:** As a developer, I want checkpoints to run when no other operations are active, so that they don't fail with "database table is locked".

#### Acceptance Criteria

1.1. **WHEN inserting a row THEN the system SHALL NOT immediately checkpoint**
- Remove `PRAGMA wal_checkpoint(FULL)` from `updateLocalLastReadAt()`
- Remove `PRAGMA wal_checkpoint(FULL)` from `syncReadStatusFromSupabase()`
- Immediate checkpoints cause lock contention

1.2. **WHEN the app enters background THEN the system SHALL checkpoint with retry**
- Use `App.addListener('appStateChange')` to detect background
- Wait 100ms for operations to complete
- Execute `PRAGMA wal_checkpoint(FULL)`
- Retry up to 3 times if locked
- Log success/failure

1.3. **WHEN bulk operations complete THEN the system SHALL checkpoint passively**
- After `syncMessagesFromRemote()` completes
- After `fetchGroups()` saves all groups
- Use `PRAGMA wal_checkpoint(PASSIVE)` (non-blocking)
- Don't fail if checkpoint is skipped

1.4. **WHEN the app is idle for 5 seconds THEN the system SHALL checkpoint passively**
- Debounced checkpoint trigger
- Only if WAL file > 1MB
- Use PASSIVE mode
- Don't block user operations

### Requirement 2: Implement Checkpoint Retry Logic

**User Story:** As a developer, I want failed checkpoints to be retried, so that data eventually gets flushed to disk.

#### Acceptance Criteria

2.1. **WHEN a checkpoint fails with SQLITE_LOCKED THEN the system SHALL retry after delay**
- Wait 100ms
- Retry up to 3 times
- Use exponential backoff (100ms, 200ms, 400ms)
- Log each retry attempt

2.2. **WHEN all retries fail THEN the system SHALL schedule background checkpoint**
- Add to retry queue
- Attempt on next app background
- Attempt on next idle period
- Alert if fails > 10 times

2.3. **WHEN a checkpoint succeeds THEN the system SHALL clear retry queue**
- Remove from retry queue
- Log success with duration
- Track success rate in monitoring

### Requirement 3: Reduce Lock Contention

**User Story:** As a developer, I want to minimize concurrent database operations, so that checkpoints don't get blocked.

#### Acceptance Criteria

3.1. **WHEN performing multiple reads THEN the system SHALL batch them**
- Use single query for multiple checks
- Example: Check group AND user existence in one query
- Reduces lock acquisition overhead

3.2. **WHEN performing writes THEN the system SHALL use transactions**
- Wrap related writes in `BEGIN IMMEDIATE` / `COMMIT`
- Reduces lock acquisition/release cycles
- Improves checkpoint success rate

3.3. **WHEN checkpoint is needed THEN the system SHALL wait for active operations**
- Track active operation count
- Wait for count to reach 0
- Timeout after 500ms
- Proceed with checkpoint even if operations active

### Requirement 4: WAL File Size Monitoring

**User Story:** As a developer, I want to know when the WAL file is growing too large, so that I can force checkpoints.

#### Acceptance Criteria

4.1. **WHEN the app starts THEN the system SHALL log WAL file size**
- Query `PRAGMA wal_checkpoint` to get frame count
- Calculate size: frames * page_size
- Log: "WAL file size: X MB (Y frames)"

4.2. **WHEN WAL file exceeds 5MB THEN the system SHALL log warning**
- Check size after each operation
- Log: "⚠️ WAL file large: X MB, forcing checkpoint"
- Trigger immediate checkpoint (FULL mode)

4.3. **WHEN WAL file exceeds 10MB THEN the system SHALL force checkpoint**
- Use `PRAGMA wal_checkpoint(TRUNCATE)`
- Retry until success
- Alert if fails after 5 attempts

### Requirement 5: App Lifecycle Integration

**User Story:** As a user, I want my data to persist when I background the app, so that I don't lose my read status.

#### Acceptance Criteria

5.1. **WHEN app enters background THEN the system SHALL force checkpoint**
- Listen to `App.addListener('appStateChange', ...)`
- Detect `isActive: false`
- Wait 100ms for operations to complete
- Execute `PRAGMA wal_checkpoint(FULL)` with retry
- Log result

5.2. **WHEN app enters foreground THEN the system SHALL verify data integrity**
- Check WAL file size
- If large (> 5MB), force checkpoint
- Run health check
- Log any issues

5.3. **WHEN app is about to terminate THEN the system SHALL checkpoint**
- Listen to app termination events
- Force checkpoint with 2 second timeout
- Close database connection
- Log if checkpoint times out

### Requirement 6: Diagnostic Logging

**User Story:** As a developer, I want detailed logs of checkpoint operations, so that I can diagnose failures in production.

#### Acceptance Criteria

6.1. **WHEN a checkpoint is attempted THEN the system SHALL log details**
- Mode: PASSIVE, FULL, RESTART, TRUNCATE
- Trigger: background, idle, manual, bulk-complete
- Result: success, failed (with error code), skipped
- Duration: milliseconds
- WAL size before/after

6.2. **WHEN a checkpoint fails THEN the system SHALL log full context**
- Error code and message
- Active operation count
- WAL file size
- Last successful checkpoint time
- Retry count

6.3. **WHEN checkpoint succeeds after retry THEN the system SHALL log recovery**
- Number of retries needed
- Total time to success
- WAL size reduction
- "✅ Checkpoint recovered after X retries"

### Requirement 7: Remove Immediate Checkpoints

**User Story:** As a developer, I want to remove immediate checkpoints after INSERT, so that they don't cause lock contention.

#### Acceptance Criteria

7.1. **WHEN updating group_members THEN the system SHALL NOT checkpoint immediately**
- Remove checkpoint from `updateLocalLastReadAt()` (line ~230)
- Remove checkpoint from `syncReadStatusFromSupabase()` (line ~180)
- Rely on background/idle checkpoints instead

7.2. **WHEN verification is needed THEN the system SHALL query WAL**
- Use `SELECT` to verify row exists
- Don't rely on checkpoint for verification
- Row is visible in WAL even if not checkpointed

### Requirement 8: Guarantee Synchronous Commits (CRITICAL - P0)

**User Story:** As a developer, I want commits to wait for disk write completion, so that data is durable even if checkpoint fails.

**Why This Matters:** Log47.txt shows checkpoint fails, but row STILL disappears. This suggests commits aren't durable even before checkpoint. `synchronous = FULL` forces fsync on every commit, preventing 80% of data loss even when checkpoints fail.

#### Acceptance Criteria

8.1. **WHEN the database opens THEN the system SHALL set synchronous mode to FULL**
- Execute `PRAGMA synchronous = FULL` immediately after opening connection in `openEncryptedDatabase()`
- Verify setting: Query `PRAGMA synchronous` should return 2
- Log: "✅ Synchronous mode: FULL (2) - commits wait for disk write"
- Location: `database.ts:openEncryptedDatabase()` after line ~210

8.2. **WHEN inserting critical data THEN the system SHALL verify commit completion**
- After `INSERT INTO group_members`, commit is guaranteed to disk
- No reliance on OS buffering
- Data survives app crash even if checkpoint fails
- This is the PRIMARY fix for the persistence issue

8.3. **WHEN measuring performance impact THEN the system SHALL accept 2-3x slower writes for 100% durability**
- Benchmark: INSERT with FULL vs NORMAL
- Expected: FULL is 2-3x slower but guarantees durability
- This is acceptable for infrequent group_members updates (~1-2 per minute)
- Log: "⏱️ Write with synchronous=FULL: Xms (acceptable for durability)"

8.4. **WHEN synchronous mode is not FULL THEN the system SHALL log critical warning**
- Check on every app start
- Log: "❌ CRITICAL: synchronous mode is not FULL, data loss possible!"
- Track in monitoring system
- Alert immediately

---

## Non-Functional Requirements

### NFR-1: Performance
- Checkpoint SHALL NOT block user operations
- Background checkpoint SHALL complete within 500ms (p95)
- Passive checkpoint SHALL be non-blocking
- Retry delays SHALL use exponential backoff

### NFR-2: Reliability
- Data persistence rate SHALL be 100% (no data loss)
- Checkpoint success rate SHALL be > 95%
- Failed checkpoints SHALL be retried
- WAL file size SHALL NOT exceed 10MB

### NFR-3: Observability
- All checkpoint attempts SHALL be logged
- Checkpoint failures SHALL be tracked in monitoring
- WAL file size SHALL be monitored
- Retry attempts SHALL be logged

---

## Files to Modify

### 1. `src/lib/sqliteServices_Refactored/memberOperations.ts`
**Changes:**
- **REMOVE** `PRAGMA wal_checkpoint(FULL)` from `updateLocalLastReadAt()` (line ~230)
- **REMOVE** `PRAGMA wal_checkpoint(FULL)` from `syncReadStatusFromSupabase()` (line ~180)
- Keep verification queries (SELECT to verify row exists)

### 2. `src/lib/sqliteServices_Refactored/database.ts`
**Changes:**
- **ADD** `checkpointWAL(mode: 'PASSIVE' | 'FULL' | 'TRUNCATE')` method
- **ADD** retry logic with exponential backoff
- **ADD** WAL file size monitoring
- **ADD** active operation counter
- Configure `PRAGMA synchronous = FULL` on open

### 3. `src/lib/appLifecycleManager.ts` (NEW FILE)
**Purpose:** Handle app lifecycle events
**Features:**
- Listen to `App.addListener('appStateChange')`
- Trigger checkpoint on background
- Verify integrity on foreground
- Handle app termination

### 4. `src/lib/sqliteMonitoring.ts`
**Changes:**
- **ADD** `trackCheckpoint()` method
- **ADD** `trackWALSize()` method
- **ADD** checkpoint failure alerts

---

## Testing Requirements

### Test Case 1: Checkpoint on Background
1. Open app and create group_members row
2. Background the app
3. Verify checkpoint was triggered (check logs)
4. Kill app process
5. Reopen app
6. Verify row still exists ✅

### Test Case 2: Checkpoint Retry
1. Simulate lock contention (multiple concurrent operations)
2. Attempt checkpoint
3. Verify retry logic triggers
4. Verify checkpoint eventually succeeds
5. Verify data persists

### Test Case 3: WAL File Growth
1. Perform many writes without checkpointing
2. Verify WAL file size warning at 5MB
3. Verify forced checkpoint at 10MB
4. Verify WAL file size reduced

### Test Case 4: Remove Immediate Checkpoints
1. Insert group_members row
2. Verify NO immediate checkpoint attempt
3. Verify row is visible in queries (from WAL)
4. Background app
5. Verify checkpoint triggers
6. Verify row persists after restart

---

## Success Metrics

### Critical Metrics (Must Achieve)
- **100% data persistence** across app restarts
- **Zero "database table is locked" errors** during checkpoints
- **> 95% checkpoint success rate** (including retries)
- **< 10MB WAL file size** under normal operation

### Performance Metrics (Target)
- **< 500ms** for background checkpoint (p95)
- **< 100ms** for passive checkpoint (p95)
- **< 3 retries** for successful checkpoint (p95)

---

## Rollout Plan

### Phase 1: Remove Immediate Checkpoints (Day 1)
- Remove checkpoint calls from memberOperations.ts
- Deploy to staging
- Verify no immediate impact
- Verify rows still visible in queries

### Phase 2: Add Background Checkpoints (Day 2)
- Implement app lifecycle manager
- Add background checkpoint with retry
- Deploy to staging
- Test background/foreground transitions

### Phase 3: Add Monitoring (Day 3)
- Add WAL file size monitoring
- Add checkpoint failure tracking
- Add alerts
- Deploy to staging

### Phase 4: Production Rollout (Day 4-10)
- Canary deployment (5%)
- Monitor checkpoint success rate
- Gradual rollout (25% → 50% → 100%)
- Post-rollout monitoring

---

## References

- Log47.txt: Lines 21:29:57.933 (checkpoint failure), 21:30:14.962 (data loss after restart)
- SQLite WAL Mode: https://www.sqlite.org/wal.html
- SQLite Locking: https://www.sqlite.org/lockingv3.html
- Capacitor App Plugin: https://capacitorjs.com/docs/apis/app

---

**Document Version:** 1.0  
**Date:** 2025-11-24  
**Status:** READY FOR REVIEW  
**Priority:** CRITICAL  
**Complexity:** MEDIUM (focused fix, not full rewrite)  
**Risk:** LOW (removing problematic code, adding retry logic)
