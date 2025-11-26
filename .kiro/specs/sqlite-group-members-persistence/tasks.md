# Implementation Plan: SQLite WAL Checkpoint Fix

## Overview

This implementation plan converts the design into discrete, actionable coding tasks. Each task builds incrementally on previous tasks, with checkpoints to ensure tests pass before proceeding.

**Key Principle:** Remove problematic immediate checkpoints → Add safe background checkpoints → Configure durability settings

---

## Tasks

- [x] 1. Configure database for maximum durability





  - Add `PRAGMA synchronous = FULL` in `openEncryptedDatabase()` method
  - Add verification query to confirm synchronous mode is set to FULL (value = 2)
  - Add logging: "✅ Synchronous mode: FULL (2) - commits wait for disk write"
  - Add critical warning if synchronous mode is not FULL
  - Location: `src/lib/sqliteServices_Refactored/database.ts` in `openEncryptedDatabase()` method
  - _Requirements: 8.1, 8.4_

- [ ]* 1.1 Write property test for synchronous mode durability
  - **Feature: sqlite-group-members-persistence, Property 3: Synchronous Mode Guarantees Commit Durability**
  - **Validates: Requirements 8.1, 8.2**
  - Generate random INSERT operations
  - Execute INSERT with synchronous=FULL, simulate crash before checkpoint
  - Verify data persists (commit was durable)
  - Run 100 iterations

- [ ] 2. Add WAL checkpoint management methods to DatabaseManager
  - Implement `checkpointWAL(mode, retries)` method with retry logic and exponential backoff
  - Implement `getWALSize()` method to query WAL file size and frame count
  - Add checkpoint result tracking (success, duration, WAL size before/after, retries needed)
  - Add logging for each checkpoint attempt and result
  - Location: `src/lib/sqliteServices_Refactored/database.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 4.1_

- [ ]* 2.1 Write property test for checkpoint retry recovery
  - **Feature: sqlite-group-members-persistence, Property 4: Checkpoint Retry Recovers from Transient Failures**
  - **Validates: Requirements 2.1, 2.2**
  - Generate random lock contention scenarios
  - Execute checkpoint with retry logic
  - Verify checkpoint succeeds within 3 attempts
  - Verify exponential backoff timing (100ms, 200ms, 400ms)
  - Run 100 iterations

- [ ]* 2.2 Write unit tests for checkpoint methods
  - Test checkpoint with PASSIVE mode (non-blocking)
  - Test checkpoint with FULL mode (blocking)
  - Test checkpoint with TRUNCATE mode (reset WAL)
  - Test WAL size calculation
  - Test checkpoint failure after max retries
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1_

- [x] 3. Remove immediate checkpoints from MemberOperations





  - Remove `PRAGMA wal_checkpoint(FULL)` call from `updateLocalLastReadAt()` method
  - Remove `PRAGMA wal_checkpoint(FULL)` call from `syncReadStatusFromSupabase()` method
  - Keep verification queries (SELECT to verify row exists)
  - Add comment explaining why immediate checkpoints are removed
  - Location: `src/lib/sqliteServices_Refactored/memberOperations.ts`
  - _Requirements: 1.1, 7.1, 7.2_

- [ ]* 3.1 Write property test for checkpoint timing
  - **Feature: sqlite-group-members-persistence, Property 1: Checkpoint Timing Prevents Lock Contention**
  - **Validates: Requirements 1.1, 3.2**
  - Generate random sequence of concurrent write operations
  - Execute operations with explicit transactions
  - Verify no checkpoint attempts during active transactions
  - Verify checkpoint succeeds after all operations complete
  - Run 100 iterations


- [x] 4. Add explicit transactions to write operations





  - Wrap `updateLocalLastReadAt()` in `BEGIN IMMEDIATE` / `COMMIT` transaction
  - Add ROLLBACK on error with proper error logging
  - Add retry logic for SQLITE_BUSY errors (up to 3 attempts with exponential backoff)
  - Add transaction duration logging (warn if > 2 seconds)
  - Keep existing parent row checks and verification queries
  - Location: `src/lib/sqliteServices_Refactored/memberOperations.ts`
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ]* 4.1 Write property test for transaction atomicity
  - **Feature: sqlite-group-members-persistence, Property 6: Transaction Atomicity Prevents Partial Writes**
  - **Validates: Requirements 3.1, 3.4**
  - Generate random write operations with simulated errors
  - Execute transaction with error mid-operation
  - Verify ROLLBACK triggered
  - Verify database state unchanged
  - Run 100 iterations

- [ ]* 4.2 Write unit tests for transaction safety
  - Test BEGIN IMMEDIATE acquires write lock
  - Test COMMIT releases lock
  - Test ROLLBACK on error
  - Test retry on SQLITE_BUSY
  - Test graceful degradation on constraint violation
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Enhance SQLite monitoring with checkpoint tracking
  - Add `trackCheckpoint()` method to track checkpoint operations
  - Add `trackWALSize()` method to track WAL file size
  - Add `trackTransactionDuration()` method to track long transactions
  - Add `getCheckpointSuccessRate()` method to calculate success rate
  - Add `shouldAlertCheckpointFailures()` method to check if failure rate > 5%
  - Add checkpoint metrics storage (attempts, successes, failures)
  - Add WAL size history storage (last 100 measurements)
  - Location: `src/lib/sqliteMonitoring.ts`
  - _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2, 7.3, 7.4_

- [ ]* 5.1 Write unit tests for monitoring methods
  - Test checkpoint tracking (success and failure)
  - Test WAL size tracking and alerts
  - Test transaction duration tracking
  - Test success rate calculation
  - Test alert threshold detection
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 6. Create AppLifecycleManager for background checkpoints




  - Create new file `src/lib/appLifecycleManager.ts`
  - Implement `AppLifecycleManager` class with constructor accepting DatabaseManager
  - Implement `initialize()` method to set up app state change listener
  - Implement `handleAppStateChange()` method to detect background/foreground transitions
  - Implement `onBackground()` method to force checkpoint with retry when app backgrounds
  - Implement `onForeground()` method to verify integrity when app foregrounds
  - Implement `cleanup()` method for app termination
  - Add 100ms delay before background checkpoint to allow operations to complete
  - Add 500ms timeout for background checkpoint
  - Add comprehensive logging for all lifecycle events
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3_

- [ ]* 6.1 Write property test for background checkpoint persistence
  - **Feature: sqlite-group-members-persistence, Property 2: Background Checkpoint Guarantees Persistence**
  - **Validates: Requirements 1.2, 2.1, 8.1**
  - Generate random data writes
  - Execute: Write data, background app, checkpoint, kill process
  - Verify data persists after restart
  - Run 100 iterations

- [ ]* 6.2 Write unit tests for app lifecycle handling
  - Test background event triggers checkpoint
  - Test foreground event runs health check
  - Test checkpoint timeout handling
  - Test cleanup on app termination
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3_

- [ ] 7. Integrate AppLifecycleManager into app startup
  - Import AppLifecycleManager in main app initialization file
  - Create AppLifecycleManager instance with DatabaseManager
  - Call `initialize()` method after DatabaseManager is ready
  - Add error handling for lifecycle manager initialization
  - Location: `src/main.tsx` or app initialization file
  - _Requirements: 2.1, 5.1_

- [ ] 8. Add WAL size monitoring to DatabaseManager
  - Add `monitorWALSize()` method to check WAL file size
  - Call `monitorWALSize()` after bulk operations complete
  - Log warning if WAL size > 5MB
  - Force TRUNCATE checkpoint if WAL size > 10MB
  - Retry TRUNCATE checkpoint up to 5 times if it fails
  - Add critical alert if WAL size cannot be reduced
  - Location: `src/lib/sqliteServices_Refactored/database.ts`
  - _Requirements: 4.1, 4.2, 4.3_

- [ ]* 8.1 Write property test for WAL size monitoring
  - **Feature: sqlite-group-members-persistence, Property 5: WAL Size Monitoring Prevents Unbounded Growth**
  - **Validates: Requirements 4.2, 4.3**
  - Generate random sequences of writes without checkpointing
  - Monitor WAL size, trigger forced checkpoint at 10MB
  - Verify WAL size reduces after checkpoint
  - Verify warning logged at 5MB
  - Run 100 iterations

- [ ] 9. Add passive checkpoints after bulk operations
  - Add checkpoint call after `syncMessagesFromRemote()` completes in MessageOperations
  - Add checkpoint call after bulk group saves in fetchActions
  - Use PASSIVE mode (non-blocking) for bulk operation checkpoints
  - Add logging for checkpoint results
  - Don't fail if checkpoint is skipped (graceful degradation)
  - Location: `src/lib/sqliteServices_Refactored/messageOperations.ts`, `src/store/chatstore_refactored/fetchActions.ts`
  - _Requirements: 1.3_

- [ ]* 9.1 Write property test for WAL read visibility
  - **Feature: sqlite-group-members-persistence, Property 7: Verification Queries Read from WAL**
  - **Validates: Requirements 7.2**
  - Generate random INSERT operations
  - Execute INSERT without checkpoint, then SELECT
  - Verify row visible in SELECT results
  - Verify data read from WAL buffer
  - Run 100 iterations

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Add comprehensive diagnostic logging
  - Add checkpoint attempt logging with mode, trigger, duration, WAL size
  - Add checkpoint failure logging with error code, active operations, retry count
  - Add checkpoint success logging with recovery details if retries were needed
  - Add database configuration logging on app start (journal mode, synchronous mode, WAL size)
  - Add transaction duration warnings for operations > 2 seconds
  - Location: Throughout `database.ts`, `memberOperations.ts`, `appLifecycleManager.ts`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3_

- [ ]* 11.1 Write integration test for full lifecycle
  - Start app
  - Verify synchronous=FULL configured
  - Write data to group_members
  - Verify row exists (read from WAL)
  - Background app
  - Verify checkpoint triggered
  - Kill app process
  - Restart app
  - Verify data persists
  - _Requirements: 1.1, 1.2, 2.1, 8.1_

- [ ]* 11.2 Write integration test for concurrent operations
  - Start app
  - Trigger 10 concurrent write operations
  - Verify no immediate checkpoints
  - Wait for operations to complete
  - Trigger checkpoint
  - Verify checkpoint succeeds
  - Verify all data persists
  - _Requirements: 1.1, 3.1, 3.4_

- [ ]* 11.3 Write integration test for checkpoint failure recovery
  - Start app
  - Simulate lock contention
  - Trigger checkpoint
  - Verify retry logic activates
  - Verify checkpoint eventually succeeds
  - Verify data persists
  - _Requirements: 2.1, 2.2_

- [ ]* 11.4 Write integration test for WAL growth handling
  - Start app
  - Perform 1000 writes without checkpointing
  - Verify WAL file grows
  - Verify warning at 5MB
  - Verify forced checkpoint at 10MB
  - Verify WAL size reduces
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 12. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional (tests and supporting infrastructure)
- Core implementation tasks (1-11) must be completed
- Property-based tests use the testing framework specified in the design document
- Each property test should run a minimum of 100 iterations
- Integration tests verify end-to-end flows
- Checkpoints ensure tests pass before proceeding to next phase
