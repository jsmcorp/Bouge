# SQLite WAL Checkpoint Failure Fix - Design Document

## Overview

This design addresses the critical data persistence bug in the `group_members` table where rows successfully insert but disappear after app restart. Log analysis reveals the root cause: **WAL checkpoint failures with "database table is locked" (SQLITE_LOCKED, code 6)**.

The solution involves three key changes:
1. **Remove immediate checkpoints** that cause lock contention
2. **Add background checkpoints** triggered by app lifecycle events
3. **Configure synchronous=FULL** to guarantee commit durability

This is NOT a schema refactor - the schema is already correct. This is a WAL management fix.

---

## Architecture

### Current Architecture (Problematic)

```
User Action (mark as read)
  ↓
updateLocalLastReadAt()
  ↓
INSERT INTO group_members
  ↓
PRAGMA wal_checkpoint(FULL) ← FAILS with "database table is locked"
  ↓
Data in WAL buffer (not flushed to disk)
  ↓
App Restart
  ↓
WAL buffer discarded → DATA LOSS
```

### New Architecture (Fixed)

```
User Action (mark as read)
  ↓
BEGIN IMMEDIATE (acquire write lock)
  ↓
INSERT INTO group_members
  ↓
COMMIT (release lock, data in WAL)
  ↓
[NO immediate checkpoint]
  ↓
App continues normally
  ↓
App Backgrounds
  ↓
AppLifecycleManager detects background
  ↓
Wait 100ms for operations to complete
  ↓
PRAGMA wal_checkpoint(FULL) with retry
  ↓
Data flushed to disk → PERSISTS
```


---

## Components and Interfaces

### 1. DatabaseManager (Enhanced)

**File:** `src/lib/sqliteServices_Refactored/database.ts`

**New Methods:**

```typescript
class DatabaseManager {
  // Existing methods...
  
  /**
   * Checkpoint WAL with retry logic
   * @param mode - PASSIVE (non-blocking), FULL (blocking), TRUNCATE (reset WAL)
   * @param retries - Number of retry attempts (default: 3)
   * @returns Success status and metrics
   */
  async checkpointWAL(
    mode: 'PASSIVE' | 'FULL' | 'TRUNCATE',
    retries: number = 3
  ): Promise<{
    success: boolean;
    framesCheckpointed: number;
    walSizeBefore: number;
    walSizeAfter: number;
    duration: number;
    retriesNeeded: number;
  }>;

  /**
   * Get current WAL file size
   * @returns WAL size in bytes and frame count
   */
  async getWALSize(): Promise<{
    sizeBytes: number;
    sizeMB: number;
    frameCount: number;
  }>;

  /**
   * Configure database for maximum durability
   * Called during openEncryptedDatabase()
   */
  private async configureDurability(): Promise<void>;
}
```

**Configuration Changes:**

```typescript
// In openEncryptedDatabase(), add after connection opens:
await db.execute('PRAGMA synchronous = FULL'); // Force fsync on commit
await db.execute('PRAGMA wal_autocheckpoint = 1000'); // Checkpoint every 1000 pages
const syncMode = await db.query('PRAGMA synchronous');
console.log('[db] ✅ Synchronous mode:', syncMode.values[0][0], '(2 = FULL)');
```


### 2. AppLifecycleManager (New Component)

**File:** `src/lib/appLifecycleManager.ts` (NEW)

**Purpose:** Centralize app lifecycle event handling and trigger checkpoints at safe times.

**Interface:**

```typescript
export class AppLifecycleManager {
  private dbManager: DatabaseManager;
  private isBackgrounded: boolean = false;
  private lastCheckpointTime: number = 0;
  
  constructor(dbManager: DatabaseManager);
  
  /**
   * Initialize lifecycle listeners
   * Call once during app startup
   */
  initialize(): void;
  
  /**
   * Handle app state change (background/foreground)
   */
  private async handleAppStateChange(state: AppState): Promise<void>;
  
  /**
   * Force checkpoint when app backgrounds
   */
  private async onBackground(): Promise<void>;
  
  /**
   * Verify integrity when app foregrounds
   */
  private async onForeground(): Promise<void>;
  
  /**
   * Cleanup before app termination
   */
  async cleanup(): Promise<void>;
}
```

**Implementation Pattern:**

```typescript
import { App, AppState } from '@capacitor/app';
import { DatabaseManager } from './sqliteServices_Refactored/database';
import { sqliteMonitoring } from './sqliteMonitoring';

export class AppLifecycleManager {
  private dbManager: DatabaseManager;
  private isBackgrounded: boolean = false;
  private lastCheckpointTime: number = 0;
  
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }
  
  initialize(): void {
    App.addListener('appStateChange', (state: AppState) => {
      this.handleAppStateChange(state);
    });
    
    console.log('[lifecycle] ✅ App lifecycle manager initialized');
  }
  
  private async handleAppStateChange(state: AppState): Promise<void> {
    if (!state.isActive && !this.isBackgrounded) {
      // App going to background
      await this.onBackground();
    } else if (state.isActive && this.isBackgrounded) {
      // App coming to foreground
      await this.onForeground();
    }
  }
  
  private async onBackground(): Promise<void> {
    this.isBackgrounded = true;
    console.log('[lifecycle] 📱 App backgrounded, forcing checkpoint...');
    
    // Wait for active operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const startTime = Date.now();
    const result = await this.dbManager.checkpointWAL('FULL', 3);
    const duration = Date.now() - startTime;
    
    if (result.success) {
      console.log(`[lifecycle] ✅ Background checkpoint succeeded (${duration}ms)`);
      sqliteMonitoring.trackCheckpoint('background', 'FULL', true, duration);
    } else {
      console.error(`[lifecycle] ❌ Background checkpoint failed after ${result.retriesNeeded} retries`);
      sqliteMonitoring.trackCheckpoint('background', 'FULL', false, duration);
    }
    
    this.lastCheckpointTime = Date.now();
  }
  
  private async onForeground(): Promise<void> {
    this.isBackgrounded = false;
    console.log('[lifecycle] 📱 App foregrounded, verifying integrity...');
    
    // Check WAL size
    const walSize = await this.dbManager.getWALSize();
    if (walSize.sizeMB > 5) {
      console.warn(`[lifecycle] ⚠️ WAL file large: ${walSize.sizeMB.toFixed(2)}MB, forcing checkpoint`);
      await this.dbManager.checkpointWAL('FULL', 3);
    }
    
    // Run health check
    await this.dbManager.performHealthCheck();
  }
  
  async cleanup(): Promise<void> {
    console.log('[lifecycle] 🧹 Cleaning up before termination...');
    await this.dbManager.checkpointWAL('FULL', 1);
    // Database close handled by DatabaseManager
  }
}
```


### 3. MemberOperations (Modified)

**File:** `src/lib/sqliteServices_Refactored/memberOperations.ts`

**Changes:**

1. **Remove immediate checkpoints** from `updateLocalLastReadAt()` and `syncReadStatusFromSupabase()`
2. **Add explicit transactions** to prevent checkpoint during write
3. **Keep verification queries** (SELECT to verify row exists)

**Before (Problematic):**

```typescript
async updateLocalLastReadAt(...) {
  // ... parent checks ...
  await db.run(`INSERT OR REPLACE INTO group_members ...`);
  
  // Verify row exists
  const verify = await db.query(`SELECT * FROM group_members ...`);
  
  // PROBLEM: Immediate checkpoint causes lock contention
  await db.execute('PRAGMA wal_checkpoint(FULL)');
}
```

**After (Fixed):**

```typescript
async updateLocalLastReadAt(
  groupId: string,
  userId: string,
  lastReadAt: number,
  lastReadMessageId: string
): Promise<void> {
  await this.dbManager.checkDatabaseReady();
  const db = this.dbManager.getConnection();
  
  // BEGIN IMMEDIATE acquires write lock immediately
  await db.execute('BEGIN IMMEDIATE');
  
  try {
    // Parent row checks (already implemented)
    const parentCheck = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM groups WHERE id = ?) as group_exists,
        (SELECT COUNT(*) FROM users WHERE id = ?) as user_exists
    `, [groupId, userId]);
    
    const groupExists = parentCheck.values[0][0] > 0;
    const userExists = parentCheck.values[0][1] > 0;
    
    if (!groupExists || !userExists) {
      await db.execute('ROLLBACK');
      console.warn('[member-ops] ⚠️ Parent row missing, skipping update');
      return; // Graceful degradation
    }
    
    // Check if row exists
    const existing = await db.query(`
      SELECT * FROM group_members 
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
    
    if (existing.values && existing.values.length > 0) {
      // Update existing row
      await db.run(`
        UPDATE group_members 
        SET last_read_at = ?, last_read_message_id = ?
        WHERE group_id = ? AND user_id = ?
      `, [lastReadAt, lastReadMessageId, groupId, userId]);
    } else {
      // Insert new row
      await db.run(`
        INSERT INTO group_members (group_id, user_id, last_read_at, last_read_message_id)
        VALUES (?, ?, ?, ?)
      `, [groupId, userId, lastReadAt, lastReadMessageId]);
    }
    
    // COMMIT releases lock
    await db.execute('COMMIT');
    console.log('[member-ops] ✅ Transaction committed');
    
    // Verify row exists (reads from WAL)
    const verify = await db.query(`
      SELECT * FROM group_members 
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
    
    if (verify.values && verify.values.length > 0) {
      console.log('[member-ops] ✅ Row verified in database');
    }
    
    // NO immediate checkpoint - rely on background checkpoint
    
  } catch (error) {
    await db.execute('ROLLBACK');
    console.error('[member-ops] ⛔ Transaction rolled back:', error);
    throw error;
  }
}
```


### 4. SQLite Monitoring (Enhanced)

**File:** `src/lib/sqliteMonitoring.ts`

**New Methods:**

```typescript
interface CheckpointMetrics {
  trigger: 'background' | 'idle' | 'manual' | 'bulk-complete';
  mode: 'PASSIVE' | 'FULL' | 'TRUNCATE';
  success: boolean;
  duration: number;
  walSizeBefore?: number;
  walSizeAfter?: number;
  retriesNeeded?: number;
}

interface WALSizeMetrics {
  sizeMB: number;
  frameCount: number;
  timestamp: number;
}

class SQLiteMonitoring {
  // Existing methods...
  
  /**
   * Track checkpoint operation
   */
  trackCheckpoint(
    trigger: string,
    mode: string,
    success: boolean,
    duration: number,
    walSizeBefore?: number,
    walSizeAfter?: number,
    retriesNeeded?: number
  ): void;
  
  /**
   * Track WAL file size
   */
  trackWALSize(sizeMB: number, frameCount: number): void;
  
  /**
   * Track transaction duration
   */
  trackTransactionDuration(operation: string, duration: number): void;
  
  /**
   * Get checkpoint success rate
   */
  getCheckpointSuccessRate(): number;
  
  /**
   * Check if checkpoint failure rate exceeds threshold
   */
  shouldAlertCheckpointFailures(): boolean;
}
```

**Implementation:**

```typescript
class SQLiteMonitoring {
  private checkpointAttempts: number = 0;
  private checkpointSuccesses: number = 0;
  private checkpointFailures: number = 0;
  private walSizeHistory: WALSizeMetrics[] = [];
  
  trackCheckpoint(
    trigger: string,
    mode: string,
    success: boolean,
    duration: number,
    walSizeBefore?: number,
    walSizeAfter?: number,
    retriesNeeded?: number
  ): void {
    this.checkpointAttempts++;
    
    if (success) {
      this.checkpointSuccesses++;
      console.log(`[monitoring] ✅ Checkpoint ${trigger}/${mode}: ${duration}ms`);
      
      if (walSizeBefore && walSizeAfter) {
        const reduction = walSizeBefore - walSizeAfter;
        console.log(`[monitoring] 📉 WAL reduced: ${reduction.toFixed(2)}MB`);
      }
      
      if (retriesNeeded && retriesNeeded > 0) {
        console.log(`[monitoring] 🔄 Recovered after ${retriesNeeded} retries`);
      }
    } else {
      this.checkpointFailures++;
      console.error(`[monitoring] ❌ Checkpoint ${trigger}/${mode} failed after ${duration}ms`);
      
      if (this.shouldAlertCheckpointFailures()) {
        console.error('[monitoring] 🚨 ALERT: Checkpoint failure rate > 5%');
      }
    }
  }
  
  trackWALSize(sizeMB: number, frameCount: number): void {
    this.walSizeHistory.push({
      sizeMB,
      frameCount,
      timestamp: Date.now()
    });
    
    // Keep last 100 measurements
    if (this.walSizeHistory.length > 100) {
      this.walSizeHistory.shift();
    }
    
    if (sizeMB > 5) {
      console.warn(`[monitoring] ⚠️ WAL file large: ${sizeMB.toFixed(2)}MB (${frameCount} frames)`);
    }
    
    if (sizeMB > 10) {
      console.error(`[monitoring] 🚨 CRITICAL: WAL file exceeds 10MB: ${sizeMB.toFixed(2)}MB`);
    }
  }
  
  trackTransactionDuration(operation: string, duration: number): void {
    if (duration > 2000) {
      console.warn(`[monitoring] ⚠️ Long transaction: ${operation} took ${duration}ms (blocks checkpoints)`);
    }
  }
  
  getCheckpointSuccessRate(): number {
    if (this.checkpointAttempts === 0) return 100;
    return (this.checkpointSuccesses / this.checkpointAttempts) * 100;
  }
  
  shouldAlertCheckpointFailures(): boolean {
    const failureRate = (this.checkpointFailures / this.checkpointAttempts) * 100;
    return failureRate > 5;
  }
}

export const sqliteMonitoring = new SQLiteMonitoring();
```


---

## Data Models

No changes to data models. All table schemas remain unchanged. This is purely a WAL management fix.

**Existing Schema (Unchanged):**

```sql
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at INTEGER,
  last_read_at INTEGER DEFAULT 0,
  last_read_message_id TEXT,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Checkpoint Timing Prevents Lock Contention

*For any* database write operation, when the operation completes and releases its lock, then checkpoint operations should not be attempted until all concurrent operations have completed.

**Validates: Requirements 1.1, 3.2**

**Rationale:** Log47.txt shows checkpoint fails with "database table is locked" because it attempts during active operations. By removing immediate checkpoints and using explicit transactions, we ensure checkpoints only run when safe.

**Testing Strategy:** 
- Simulate concurrent writes
- Verify no immediate checkpoint attempts
- Verify checkpoint succeeds after operations complete
- Measure lock contention rate (should be 0%)

### Property 2: Background Checkpoint Guarantees Persistence

*For any* data written to the database, when the app backgrounds and checkpoint succeeds, then that data should persist across app restarts.

**Validates: Requirements 1.2, 2.1, 8.1**

**Rationale:** The primary fix for data loss. Background checkpoint with synchronous=FULL ensures data is flushed to disk before app can be killed.

**Testing Strategy:**
- Write data to database
- Background app
- Verify checkpoint triggered and succeeded
- Kill app process
- Restart app
- Verify data still exists

### Property 3: Synchronous Mode Guarantees Commit Durability

*For any* COMMIT operation, when synchronous mode is FULL, then the commit should not return until data is physically written to disk.

**Validates: Requirements 8.1, 8.2**

**Rationale:** Even if checkpoint fails, synchronous=FULL ensures commits are durable. This is the PRIMARY fix for the persistence issue.

**Testing Strategy:**
- Configure synchronous=FULL
- Perform INSERT
- Verify COMMIT waits for fsync
- Simulate app crash before checkpoint
- Verify data persists (because commit was durable)


### Property 4: Checkpoint Retry Recovers from Transient Failures

*For any* checkpoint operation that fails with SQLITE_LOCKED, when retry logic is applied with exponential backoff, then the checkpoint should eventually succeed within 3 attempts.

**Validates: Requirements 2.1, 2.2**

**Rationale:** Transient lock contention should not cause permanent data loss. Retry with backoff allows operations to complete before retrying.

**Testing Strategy:**
- Simulate lock contention
- Trigger checkpoint
- Verify retry logic activates
- Verify exponential backoff (100ms, 200ms, 400ms)
- Verify checkpoint succeeds within 3 attempts
- Measure retry success rate (should be > 95%)

### Property 5: WAL Size Monitoring Prevents Unbounded Growth

*For any* sequence of database operations, when the WAL file exceeds 10MB, then a forced checkpoint should be triggered to prevent unbounded growth.

**Validates: Requirements 4.2, 4.3**

**Rationale:** Large WAL files indicate checkpoint failures. Monitoring and forced checkpoints prevent disk space issues.

**Testing Strategy:**
- Perform many writes without checkpointing
- Monitor WAL file size
- Verify warning at 5MB
- Verify forced checkpoint at 10MB
- Verify WAL size reduces after checkpoint

### Property 6: Transaction Atomicity Prevents Partial Writes

*For any* write operation wrapped in BEGIN IMMEDIATE / COMMIT, when an error occurs mid-operation, then the transaction should rollback and leave the database in a consistent state.

**Validates: Requirements 3.1, 3.4**

**Rationale:** Explicit transactions ensure atomicity. If parent row check fails or INSERT fails, ROLLBACK prevents partial writes.

**Testing Strategy:**
- Start transaction
- Simulate error mid-operation (e.g., FK constraint violation)
- Verify ROLLBACK triggered
- Verify database state unchanged
- Verify no partial writes

### Property 7: Verification Queries Read from WAL

*For any* row inserted into the database, when a SELECT query is executed before checkpoint, then the row should be visible in the query results (reading from WAL buffer).

**Validates: Requirements 7.2**

**Rationale:** Removing immediate checkpoints means data stays in WAL longer. Verification queries must read from WAL to confirm writes succeeded.

**Testing Strategy:**
- INSERT row
- Do NOT checkpoint
- Execute SELECT query
- Verify row is visible
- Verify query reads from WAL (not main database file)


---

## Error Handling

### 1. Checkpoint Failures

**Error:** `PRAGMA wal_checkpoint` fails with SQLITE_LOCKED (code 6)

**Handling:**
1. Log error with full context (mode, WAL size, active operations)
2. Retry with exponential backoff (100ms, 200ms, 400ms)
3. If all retries fail, schedule background checkpoint
4. Track failure rate in monitoring
5. Alert if failure rate > 5%
6. App continues to function (graceful degradation)

**Code:**

```typescript
async checkpointWAL(mode: string, retries: number = 3): Promise<CheckpointResult> {
  let attempt = 0;
  let lastError: Error | null = null;
  
  while (attempt < retries) {
    try {
      const startTime = Date.now();
      const walSizeBefore = await this.getWALSize();
      
      await db.execute(`PRAGMA wal_checkpoint(${mode})`);
      
      const walSizeAfter = await this.getWALSize();
      const duration = Date.now() - startTime;
      
      console.log(`[checkpoint] ✅ ${mode} checkpoint succeeded (${duration}ms, attempt ${attempt + 1})`);
      
      return {
        success: true,
        duration,
        walSizeBefore: walSizeBefore.sizeMB,
        walSizeAfter: walSizeAfter.sizeMB,
        retriesNeeded: attempt
      };
      
    } catch (error) {
      lastError = error;
      attempt++;
      
      if (attempt < retries) {
        const backoff = 100 * Math.pow(2, attempt - 1); // 100ms, 200ms, 400ms
        console.warn(`[checkpoint] ⚠️ Attempt ${attempt} failed, retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }
  
  console.error(`[checkpoint] ❌ All ${retries} attempts failed:`, lastError);
  sqliteMonitoring.trackCheckpoint(mode, false, 0);
  
  return {
    success: false,
    duration: 0,
    retriesNeeded: retries
  };
}
```

### 2. Transaction Failures

**Error:** Transaction fails with SQLITE_BUSY or constraint violation

**Handling:**
1. ROLLBACK transaction immediately
2. Log error with operation context
3. For SQLITE_BUSY: retry up to 3 times with backoff
4. For constraint violations: graceful degradation (skip operation)
5. Track retry rate in monitoring
6. Don't crash app - return error to caller

**Code:**

```typescript
async updateLocalLastReadAt(...): Promise<void> {
  let attempt = 0;
  const maxAttempts = 3;
  
  while (attempt < maxAttempts) {
    try {
      await db.execute('BEGIN IMMEDIATE');
      
      // ... operation logic ...
      
      await db.execute('COMMIT');
      return; // Success
      
    } catch (error) {
      await db.execute('ROLLBACK');
      
      if (error.code === 5) { // SQLITE_BUSY
        attempt++;
        if (attempt < maxAttempts) {
          const backoff = 100 * Math.pow(2, attempt - 1);
          console.warn(`[tx] ⚠️ BUSY, retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
      }
      
      // Non-retryable error or max attempts reached
      console.error('[tx] ⛔ Transaction failed:', error);
      throw error;
    }
  }
}
```

### 3. WAL File Growth

**Error:** WAL file exceeds 10MB

**Handling:**
1. Log critical warning
2. Force checkpoint with TRUNCATE mode
3. Retry until success (up to 5 attempts)
4. If still fails, alert for manual investigation
5. Track WAL size history
6. App continues to function

**Code:**

```typescript
async monitorWALSize(): Promise<void> {
  const walSize = await this.getWALSize();
  sqliteMonitoring.trackWALSize(walSize.sizeMB, walSize.frameCount);
  
  if (walSize.sizeMB > 10) {
    console.error(`[wal] 🚨 CRITICAL: WAL file ${walSize.sizeMB.toFixed(2)}MB, forcing TRUNCATE checkpoint`);
    
    let attempt = 0;
    while (attempt < 5) {
      const result = await this.checkpointWAL('TRUNCATE', 1);
      if (result.success) {
        console.log('[wal] ✅ WAL size reduced after TRUNCATE');
        return;
      }
      attempt++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.error('[wal] 🚨 ALERT: Failed to reduce WAL size after 5 attempts');
  } else if (walSize.sizeMB > 5) {
    console.warn(`[wal] ⚠️ WAL file large: ${walSize.sizeMB.toFixed(2)}MB`);
  }
}
```

### 4. App Lifecycle Errors

**Error:** Background checkpoint times out or fails

**Handling:**
1. Log timeout/failure
2. Don't block app backgrounding
3. Schedule retry on next foreground
4. Track background checkpoint success rate
5. Alert if success rate < 90%

**Code:**

```typescript
private async onBackground(): Promise<void> {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Checkpoint timeout')), 500)
    );
    
    const checkpointPromise = this.dbManager.checkpointWAL('FULL', 3);
    
    await Promise.race([checkpointPromise, timeoutPromise]);
    
    console.log('[lifecycle] ✅ Background checkpoint succeeded');
    
  } catch (error) {
    console.error('[lifecycle] ⚠️ Background checkpoint failed/timeout:', error);
    // Don't block backgrounding - schedule retry on foreground
  }
}
```


---

## Testing Strategy

### Unit Tests

Unit tests verify specific behaviors and edge cases:

**Test Suite 1: Checkpoint Logic**
- Test checkpoint with PASSIVE mode (non-blocking)
- Test checkpoint with FULL mode (blocking)
- Test checkpoint with TRUNCATE mode (reset WAL)
- Test checkpoint retry with exponential backoff
- Test checkpoint failure after max retries
- Test WAL size calculation

**Test Suite 2: Transaction Safety**
- Test BEGIN IMMEDIATE acquires write lock
- Test COMMIT releases lock
- Test ROLLBACK on error
- Test retry on SQLITE_BUSY
- Test graceful degradation on constraint violation

**Test Suite 3: App Lifecycle**
- Test background event triggers checkpoint
- Test foreground event runs health check
- Test checkpoint timeout handling
- Test cleanup on app termination

**Test Suite 4: Monitoring**
- Test checkpoint metrics tracking
- Test WAL size tracking
- Test success rate calculation
- Test alert threshold detection

### Property-Based Tests

Property-based tests verify universal properties across many inputs:

**Property Test 1: Checkpoint Timing**
- **Feature: sqlite-group-members-persistence, Property 1: Checkpoint Timing Prevents Lock Contention**
- Generate: Random sequence of concurrent write operations
- Execute: Operations with explicit transactions
- Verify: No checkpoint attempts during active transactions
- Verify: Checkpoint succeeds after all operations complete
- Iterations: 100

**Property Test 2: Background Checkpoint Persistence**
- **Feature: sqlite-group-members-persistence, Property 2: Background Checkpoint Guarantees Persistence**
- Generate: Random data writes
- Execute: Write data, background app, checkpoint, kill process
- Verify: Data persists after restart
- Iterations: 100

**Property Test 3: Synchronous Mode Durability**
- **Feature: sqlite-group-members-persistence, Property 3: Synchronous Mode Guarantees Commit Durability**
- Generate: Random INSERT operations
- Execute: INSERT with synchronous=FULL, simulate crash before checkpoint
- Verify: Data persists (commit was durable)
- Iterations: 100

**Property Test 4: Checkpoint Retry Recovery**
- **Feature: sqlite-group-members-persistence, Property 4: Checkpoint Retry Recovers from Transient Failures**
- Generate: Random lock contention scenarios
- Execute: Checkpoint with retry logic
- Verify: Checkpoint succeeds within 3 attempts
- Verify: Exponential backoff timing
- Iterations: 100

**Property Test 5: WAL Size Monitoring**
- **Feature: sqlite-group-members-persistence, Property 5: WAL Size Monitoring Prevents Unbounded Growth**
- Generate: Random sequences of writes without checkpointing
- Execute: Monitor WAL size, trigger forced checkpoint at 10MB
- Verify: WAL size reduces after checkpoint
- Verify: Warning logged at 5MB
- Iterations: 100

**Property Test 6: Transaction Atomicity**
- **Feature: sqlite-group-members-persistence, Property 6: Transaction Atomicity Prevents Partial Writes**
- Generate: Random write operations with simulated errors
- Execute: Transaction with error mid-operation
- Verify: ROLLBACK triggered
- Verify: Database state unchanged
- Iterations: 100

**Property Test 7: WAL Read Visibility**
- **Feature: sqlite-group-members-persistence, Property 7: Verification Queries Read from WAL**
- Generate: Random INSERT operations
- Execute: INSERT without checkpoint, then SELECT
- Verify: Row visible in SELECT results
- Verify: Data read from WAL buffer
- Iterations: 100

### Integration Tests

Integration tests verify end-to-end flows:

**Integration Test 1: Full Lifecycle**
1. Start app
2. Verify synchronous=FULL configured
3. Write data to group_members
4. Verify row exists (read from WAL)
5. Background app
6. Verify checkpoint triggered
7. Kill app process
8. Restart app
9. Verify data persists

**Integration Test 2: Concurrent Operations**
1. Start app
2. Trigger 10 concurrent write operations
3. Verify no immediate checkpoints
4. Wait for operations to complete
5. Trigger checkpoint
6. Verify checkpoint succeeds
7. Verify all data persists

**Integration Test 3: Checkpoint Failure Recovery**
1. Start app
2. Simulate lock contention
3. Trigger checkpoint
4. Verify retry logic activates
5. Verify checkpoint eventually succeeds
6. Verify data persists

**Integration Test 4: WAL Growth Handling**
1. Start app
2. Perform 1000 writes without checkpointing
3. Verify WAL file grows
4. Verify warning at 5MB
5. Verify forced checkpoint at 10MB
6. Verify WAL size reduces

### Performance Tests

**Performance Test 1: Synchronous=FULL Impact**
- Measure: INSERT latency with synchronous=FULL vs NORMAL
- Expected: 2-3x slower with FULL (acceptable for durability)
- Target: < 50ms p95 with FULL

**Performance Test 2: Background Checkpoint Duration**
- Measure: Time to complete background checkpoint
- Target: < 500ms p95
- Verify: Doesn't block app backgrounding

**Performance Test 3: Bulk Write Performance**
- Measure: Time to sync 1000 messages with explicit transactions
- Target: < 2 seconds
- Verify: Checkpoint after bulk write completes quickly


---

## Implementation Notes

### 1. Why Remove Immediate Checkpoints?

**Problem:** Log47.txt shows checkpoint fails with "database table is locked" immediately after INSERT.

**Root Cause:** Multiple concurrent operations are running. Checkpoint tries to acquire write lock while other operations hold read locks → deadlock.

**Solution:** Remove immediate checkpoints. Rely on background checkpoints when no operations are active.

**Evidence:**
```
21:29:57.914 [sqlite] ✅ Created new group_members row for read status
21:29:57.929 [sqlite] ✅ VERIFIED: Row exists in database after INSERT
21:29:57.933 SQLiteLog: (6) statement aborts at 2: [PRAGMA wal_checkpoint(FULL);] database table is locked
21:29:58.140-58.149 [50+ concurrent getConnection() calls]
```

### 2. Why Synchronous=FULL is Critical

**Problem:** Even with checkpoint failures, data should persist if commit was durable. But log shows data disappears.

**Root Cause:** Default synchronous mode (NORMAL) doesn't force fsync on commit. OS buffers writes. App crash → buffer lost → data loss.

**Solution:** Configure `PRAGMA synchronous = FULL`. Forces fsync on every commit. Data is durable even if checkpoint fails.

**Trade-off:** 2-3x slower writes, but 100% durability. Acceptable for infrequent group_members updates.

### 3. Why Explicit Transactions?

**Problem:** Checkpoint attempts during write operations cause lock contention.

**Solution:** Wrap writes in `BEGIN IMMEDIATE` / `COMMIT`. Holds write lock for entire operation. Checkpoint won't attempt during transaction.

**Benefit:** After COMMIT, lock is released. Checkpoint can safely run without contention.

### 4. Why Background Checkpoints?

**Problem:** Need to flush WAL to disk, but immediate checkpoints fail.

**Solution:** Checkpoint when app backgrounds. No user operations running → no lock contention → checkpoint succeeds.

**Benefit:** Data is flushed before app can be killed by OS. Guarantees persistence.

### 5. Why Retry Logic?

**Problem:** Transient lock contention can cause checkpoint failures.

**Solution:** Retry with exponential backoff (100ms, 200ms, 400ms). Gives operations time to complete.

**Benefit:** Recovers from transient failures. Checkpoint eventually succeeds.

### 6. Why Monitor WAL Size?

**Problem:** If checkpoints keep failing, WAL file grows unbounded → disk space issues.

**Solution:** Monitor WAL size. Force checkpoint at 10MB. Alert if fails.

**Benefit:** Prevents disk space issues. Alerts for investigation.

---

## Migration Strategy

### Phase 1: Add Configuration (No Behavior Change)

1. Add `PRAGMA synchronous = FULL` in `openEncryptedDatabase()`
2. Add `checkpointWAL()` method (not called yet)
3. Add `getWALSize()` method (not called yet)
4. Add monitoring methods (not called yet)
5. Deploy to staging
6. Verify no regressions

### Phase 2: Remove Immediate Checkpoints

1. Remove checkpoint from `updateLocalLastReadAt()`
2. Remove checkpoint from `syncReadStatusFromSupabase()`
3. Keep verification queries
4. Deploy to staging
5. Verify rows still visible (read from WAL)
6. Verify no immediate impact

### Phase 3: Add Background Checkpoints

1. Create `AppLifecycleManager`
2. Initialize in app startup
3. Add background checkpoint with retry
4. Deploy to staging
5. Test background/foreground transitions
6. Verify data persists after restart

### Phase 4: Add Explicit Transactions

1. Wrap write operations in `BEGIN IMMEDIATE` / `COMMIT`
2. Add ROLLBACK on error
3. Deploy to staging
4. Verify atomicity
5. Verify no lock contention

### Phase 5: Production Rollout

1. Canary deployment (5% of users)
2. Monitor checkpoint success rate
3. Monitor data persistence rate
4. Gradual rollout (25% → 50% → 100%)
5. Post-rollout monitoring

---

## Performance Considerations

### 1. Synchronous=FULL Impact

**Expected:** 2-3x slower writes (10-20ms → 30-60ms)

**Mitigation:**
- Batched transactions amortize cost
- Infrequent group_members updates (~1-2 per minute)
- Acceptable trade-off for 100% durability

**Monitoring:** Track p95 write latency. Alert if > 100ms.

### 2. Background Checkpoint Duration

**Expected:** 100-500ms depending on WAL size

**Mitigation:**
- Use timeout (500ms)
- Don't block app backgrounding
- Retry on next foreground if timeout

**Monitoring:** Track background checkpoint duration. Alert if p95 > 500ms.

### 3. Transaction Overhead

**Expected:** Minimal overhead for explicit transactions

**Benefit:** Reduces lock acquisition overhead (single lock for entire operation vs multiple locks)

**Monitoring:** Track transaction duration. Alert if > 2 seconds.

### 4. WAL File Size

**Expected:** < 5MB under normal operation

**Mitigation:**
- Background checkpoints keep WAL small
- Forced checkpoint at 10MB
- TRUNCATE mode resets WAL

**Monitoring:** Track WAL size. Alert if > 10MB.

---

## Rollback Plan

If issues arise in production:

### Immediate Rollback (< 1 hour)

1. Revert to previous version
2. Immediate checkpoints return (with lock contention)
3. Data loss issue returns
4. Investigate root cause

### Partial Rollback (1-24 hours)

1. Keep synchronous=FULL (primary fix)
2. Revert background checkpoints
3. Revert explicit transactions
4. Monitor data persistence
5. Investigate checkpoint failures

### No Rollback (> 24 hours)

1. Fix forward
2. Adjust checkpoint timing
3. Tune retry logic
4. Optimize transaction scope

---

## Success Criteria

### Critical Metrics (Must Achieve)

- ✅ **100% data persistence** across app restarts
- ✅ **Zero "database table is locked" errors** during checkpoints
- ✅ **> 95% checkpoint success rate** (including retries)
- ✅ **< 10MB WAL file size** under normal operation

### Performance Metrics (Target)

- ✅ **< 50ms** for write operations with synchronous=FULL (p95)
- ✅ **< 500ms** for background checkpoint (p95)
- ✅ **< 2 seconds** for bulk write transactions (1000 operations)

### Quality Metrics (Target)

- ✅ **< 0.01%** database corruption rate
- ✅ **> 90%** auto-recovery success rate (checkpoint retry)
- ✅ **< 1%** of users report data loss issues

---

## References

- **Log47.txt:** Lines 21:29:57.933 (checkpoint failure), 21:30:14.962 (data loss after restart)
- **SQLite WAL Mode:** https://www.sqlite.org/wal.html
- **SQLite Locking:** https://www.sqlite.org/lockingv3.html
- **SQLite Synchronous:** https://www.sqlite.org/pragma.html#pragma_synchronous
- **Capacitor App Plugin:** https://capacitorjs.com/docs/apis/app
- **Requirements Document:** `.kiro/specs/sqlite-group-members-persistence/requirements-wal-checkpoint-fix.md`

---

**Document Version:** 1.0  
**Date:** 2025-11-24  
**Status:** READY FOR REVIEW  
**Author:** Kiro AI  
**Reviewers:** Development Team
