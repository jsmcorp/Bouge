# SQLite group_members Persistence - Design Document

## Overview

This design addresses three critical issues causing `group_members` rows to not persist in SQLite:
1. CASCADE migration running on every app open (drops table)
2. Foreign key constraint violations (missing parent rows)
3. Race conditions during initialization (child operations before parent saves)

## Architecture

### Current Flow (Broken)
```
App Launch
  ↓
Database Init
  ↓
Migration Check (only checks reactions table) ❌
  ↓
If no CASCADE → Drop ALL tables including group_members ❌
  ↓
fetchGroups() → Save to SQLite (fire-and-forget) ❌
  ↓
delay(1000ms) ← Fixed timeout, unreliable ❌
  ↓
fetchMessages() → Try to create group_members row
  ↓
FK Error: group not in SQLite yet ❌
```

### Fixed Flow (Correct)
```
App Launch
  ↓
Database Init
  ↓
Migration Check (checks group_members table specifically) ✅
  ↓
If CASCADE exists → Skip migration ✅
  ↓
Step 0: Save current user to SQLite (await completion) ✅
  ↓
fetchGroups() → Save ALL groups to SQLite (await completion) ✅
  ↓
Log: "✅ Saved 10 groups to SQLite (waited 547ms)" ✅
  ↓
fetchMessages() → Check parent rows exist → Create group_members row ✅
  ↓
Success: Row persists across sessions ✅
```

## Component Design

### 1. Database Migration Fix

**File:** `src/lib/sqliteServices_Refactored/database.ts`

**Current Implementation:**
```typescript
private async migrateForeignKeysWithCascade(): Promise<void> {
  // ❌ Only checks reactions table
  const fkCheck = await this.db!.query('PRAGMA foreign_key_list(reactions);');
  const hasCascade = (fkCheck.values || []).some((fk: any) => 
    fk.on_delete === 'CASCADE'
  );
  
  if (hasCascade) {
    return; // Skip migration
  }
  
  // Drops ALL tables including group_members
  // ... migration code ...
}
```

**Fixed Implementation:**
```typescript
private async migrateForeignKeysWithCascade(): Promise<void> {
  console.log('🔄 Checking if foreign key CASCADE migration is needed...');
  
  // ✅ Check group_members table specifically (primary concern)
  const gmFkCheck = await this.db!.query('PRAGMA foreign_key_list(group_members);');
  const gmHasCascade = (gmFkCheck.values || []).some((fk: any) => 
    fk.on_delete === 'CASCADE'
  );
  
  if (gmHasCascade) {
    console.log('✅ group_members already has CASCADE, skipping migration');
    return; // Don't drop the table!
  }
  
  // Also check reactions as secondary verification
  const fkCheck = await this.db!.query('PRAGMA foreign_key_list(reactions);');
  const hasCascade = (fkCheck.values || []).some((fk: any) => 
    fk.on_delete === 'CASCADE'
  );
  
  if (hasCascade) {
    console.log('✅ Foreign keys already have CASCADE, skipping migration');
    return;
  }
  
  console.log('🔄 Migrating tables to add ON DELETE CASCADE...');
  // ... rest of migration code ...
}
```

**Why This Works:**
- Checks the actual table we care about (`group_members`)
- Prevents unnecessary table drops
- Migration only runs once per database
- Subsequent launches preserve all data

### 2. Foreign Key Validation

**File:** `src/lib/sqliteServices_Refactored/memberOperations.ts`

**Functions to Update:**
- `updateLocalLastReadAt()` - Used when marking messages as read
- `syncReadStatusFromSupabase()` - Used when syncing from server

**Implementation Pattern:**
```typescript
public async updateLocalLastReadAt(
  groupId: string,
  userId: string,
  lastReadAt: number,
  lastReadMessageId: string
): Promise<void> {
  await this.dbManager.checkDatabaseReady();
  const db = this.dbManager.getConnection();

  // ✅ STEP 1: Check if group exists
  const groupCheck = await db.query(
    `SELECT id FROM groups WHERE id = ?`,
    [groupId]
  );
  
  if (!groupCheck.values || groupCheck.values.length === 0) {
    console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
    return; // Graceful degradation
  }

  // ✅ STEP 2: Check if user exists (CRITICAL!)
  const userCheck = await db.query(
    `SELECT id FROM users WHERE id = ?`,
    [userId]
  );
  
  if (!userCheck.values || userCheck.values.length === 0) {
    console.warn(`[sqlite] ⚠️ User ${userId.slice(0, 8)} not in SQLite yet, skipping group_members creation (will retry later)`);
    console.warn(`[sqlite] 💡 TIP: Current user should be saved during first-time init Step 0`);
    return; // Prevents FK constraint error
  }

  // ✅ STEP 3: Check if row exists
  const checkSql = `SELECT role, joined_at FROM group_members WHERE group_id = ? AND user_id = ?`;
  const existing = await db.query(checkSql, [groupId, userId]);
  
  if (existing.values && existing.values.length > 0) {
    // Row exists, just update
    await db.run(
      `UPDATE group_members 
       SET last_read_at = ?, last_read_message_id = ?
       WHERE group_id = ? AND user_id = ?;`,
      [lastReadAt, lastReadMessageId, groupId, userId]
    );
    console.log('[sqlite] ✅ Updated existing group_members row');
  } else {
    // Row doesn't exist, create it
    await db.run(
      `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
       VALUES (?, ?, 'participant', ?, ?, ?);`,
      [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
    );
    console.log('[sqlite] ✅ Created new group_members row for read status');
  }
  
  console.log('[sqlite] ✅ Updated local read status:', {
    groupId: groupId.slice(0, 8),
    userId: userId.slice(0, 8),
    lastReadAt: new Date(lastReadAt).toISOString(),
    messageId: lastReadMessageId.slice(0, 8)
  });
}
```

**Why This Works:**
- Validates both parent rows before INSERT
- Fails gracefully with warning (doesn't crash)
- Can be retried later when parent rows exist
- Provides helpful diagnostic messages

### 3. Race Condition Fix - Synchronous Guarantees

**File:** `src/store/chatstore_refactored/fetchActions.ts`

**Current Implementation (Broken):**
```typescript
fetchGroups: async () => {
  // ... fetch from Supabase ...
  
  // ❌ Fire and forget - doesn't wait for completion
  for (const group of groups || []) {
    sqliteService.saveGroup(group); // No await!
  }
  
  set({ groups: groups || [] });
  return; // Returns immediately
}

// Later in orchestrator:
await fetchGroups();
await delay(1000); // ❌ Hope it's done?
await fetchMessages(); // ❌ Might fail with FK error
```

**Fixed Implementation:**
```typescript
fetchGroups: async () => {
  try {
    set({ isLoading: true });
    
    const isNative = Capacitor.isNativePlatform();
    const isSqliteReady = isNative && await sqliteService.isReady();
    
    // Load from local first (local-first approach)
    let localDataLoaded = false;
    if (isSqliteReady) {
      const localGroups = await sqliteService.getGroups();
      if (localGroups && localGroups.length > 0) {
        // Show local data immediately
        set({ groups: convertToGroups(localGroups), isLoading: false });
        localDataLoaded = true;
      }
    }
    
    // Check network
    const { online } = get();
    if (!online) {
      if (!localDataLoaded) {
        set({ groups: [], isLoading: false });
      }
      return;
    }
    
    // Fetch from Supabase
    const client = await supabasePipeline.getDirectClient();
    const { data: groups, error } = await client
      .from('groups')
      .select('*')
      .in('id', groupIds);
    
    if (error) throw error;
    
    // ✅ FIX: Await ALL SQLite saves before returning
    if (isSqliteReady && groups && groups.length > 0) {
      const saveStartTime = Date.now();
      
      try {
        // ✅ Use Promise.all to wait for ALL saves to complete
        await Promise.all(
          groups.map(group => 
            sqliteService.saveGroup({
              id: group.id,
              name: group.name,
              description: group.description || null,
              invite_code: group.invite_code || 'offline',
              created_by: group.created_by || '',
              created_at: new Date(group.created_at).getTime(),
              last_sync_timestamp: Date.now(),
              avatar_url: group.avatar_url || null,
              is_archived: 0
            })
          )
        );
        
        const saveTime = Date.now() - saveStartTime;
        console.log(`✅ Saved ${groups.length} groups to SQLite (waited ${saveTime}ms)`);
        
        // Refresh from SQLite to ensure consistency
        const updatedLocalGroups = await sqliteService.getGroups();
        set({ groups: convertToGroups(updatedLocalGroups), isLoading: false });
      } catch (error) {
        console.error('❌ Error syncing groups to local storage:', error);
        // Fallback to remote data
        set({ groups: groups || [], isLoading: false });
      }
    } else {
      set({ groups: groups || [], isLoading: false });
    }
  } catch (error) {
    console.error('Error fetching groups:', error);
    set({ groups: [], isLoading: false });
  }
}
```

**Why This Works:**
- `Promise.all()` waits for ALL saves to complete
- Returns only when SQLite writes are done
- Logs actual wait time (not fixed delay)
- Subsequent operations guaranteed to have parent rows

### 4. First-Time Initialization Orchestrator

**File:** `src/store/chatstore_refactored/firstTimeInit.ts` (or similar)

**Current Implementation (Broken):**
```typescript
async function firstTimeInit() {
  await fetchGroups();
  await delay(1000); // ❌ Fixed timeout
  
  await fetchGroupMembers();
  await delay(500); // ❌ Fixed timeout
  
  await fetchMessages(); // ❌ Might fail
}
```

**Fixed Implementation:**
```typescript
async function firstTimeInit() {
  console.log('🎬 [INIT-ORCHESTRATOR] Starting first-time initialization...');
  
  // ✅ STEP 0: Ensure current user exists in SQLite
  console.log('👤 [INIT-ORCHESTRATOR] Step 0/5: Ensuring current user in SQLite...');
  const session = await supabasePipeline.getCachedSession();
  if (!session?.user) {
    throw new Error('No session available for first-time init');
  }
  
  const client = await supabasePipeline.getDirectClient();
  const { data: userData } = await client
    .from('users')
    .select('*')
    .eq('id', session.user.id)
    .single();
  
  if (userData) {
    await sqliteService.saveUser({
      id: userData.id,
      display_name: userData.display_name,
      phone_number: userData.phone_number || null,
      avatar_url: userData.avatar_url || null,
      is_onboarded: 1,
      created_at: new Date(userData.created_at).getTime()
    });
    console.log('✅ [INIT-ORCHESTRATOR] Step 0/5 complete: Current user saved to SQLite');
  }
  
  // ✅ STEP 1: Fetch and save ALL groups (await completion)
  console.log('📁 [INIT-ORCHESTRATOR] Step 1/5: Fetching groups...');
  await fetchGroups(); // Now waits for ALL SQLite saves
  console.log('✅ [INIT-ORCHESTRATOR] Step 1/5 complete: Groups loaded and saved');
  
  // ✅ STEP 2: Fetch group members (parent rows guaranteed to exist)
  console.log('👥 [INIT-ORCHESTRATOR] Step 2/5: Fetching group members...');
  await fetchGroupMembers(); // Safe - groups exist
  console.log('✅ [INIT-ORCHESTRATOR] Step 2/5 complete: Group members loaded');
  
  // ✅ STEP 3: Fetch messages (parent rows guaranteed to exist)
  console.log('💬 [INIT-ORCHESTRATOR] Step 3/5: Fetching messages...');
  await fetchMessages(); // Safe - groups + user exist
  console.log('✅ [INIT-ORCHESTRATOR] Step 3/5 complete: Messages loaded');
  
  console.log('🎉 [INIT-ORCHESTRATOR] First-time initialization complete!');
}
```

**Why This Works:**
- Step 0 ensures user exists (prevents FK errors)
- Each step awaits actual completion (no fixed delays)
- Parent rows guaranteed before child operations
- Clear logging shows progress and timing

### 5. Monitoring and Analytics

**File:** `src/lib/analytics.ts` (new file)

```typescript
interface SQLiteMetrics {
  fkErrors: number;
  migrationStatus: 'success' | 'failed' | 'skipped';
  groupSaveTime: number;
  firstTimeLogCount: number;
}

class SQLiteMonitoring {
  private metrics: SQLiteMetrics = {
    fkErrors: 0,
    migrationStatus: 'skipped',
    groupSaveTime: 0,
    firstTimeLogCount: 0
  };
  
  // Track FK constraint errors
  trackFKError(context: {
    operation: string;
    groupId: string;
    userId: string;
    errorCode: number;
  }) {
    this.metrics.fkErrors++;
    
    // Log to analytics
    console.error('[analytics] FK constraint error:', context);
    
    // Send to remote analytics (Firebase, Sentry, etc.)
    this.sendToAnalytics('sqlite_fk_error', context);
    
    // Alert if threshold exceeded
    if (this.metrics.fkErrors > 5) {
      this.sendAlert('CRITICAL: Multiple FK errors detected');
    }
  }
  
  // Track migration status
  trackMigration(status: 'success' | 'failed' | 'skipped', duration: number) {
    this.metrics.migrationStatus = status;
    
    console.log(`[analytics] Migration ${status} in ${duration}ms`);
    
    this.sendToAnalytics('sqlite_migration', {
      status,
      duration
    });
  }
  
  // Track "FIRST TIME" log frequency
  trackFirstTimeLog(groupId: string, userId: string) {
    this.metrics.firstTimeLogCount++;
    
    // Alert if same group shows "FIRST TIME" multiple times
    const key = `${groupId}:${userId}`;
    const count = this.getFirstTimeCount(key);
    
    if (count > 2) {
      console.warn(`[analytics] ⚠️ Group ${groupId.slice(0, 8)} showing FIRST TIME ${count} times`);
      this.sendAlert(`Possible persistence issue for group ${groupId}`);
    }
  }
  
  // Health check on app launch
  async performHealthCheck() {
    const checks = {
      tableExists: false,
      hasCascade: false,
      hasRows: false,
      isEncrypted: false
    };
    
    try {
      // Check if group_members table exists
      const tableCheck = await db.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='group_members'`
      );
      checks.tableExists = tableCheck.values && tableCheck.values.length > 0;
      
      // Check if CASCADE is configured
      const fkCheck = await db.query('PRAGMA foreign_key_list(group_members);');
      checks.hasCascade = (fkCheck.values || []).some((fk: any) => 
        fk.on_delete === 'CASCADE'
      );
      
      // Check if user has any rows
      const rowCheck = await db.query(
        `SELECT COUNT(*) as count FROM group_members WHERE user_id = ?`,
        [currentUserId]
      );
      checks.hasRows = rowCheck.values?.[0]?.count > 0;
      
      // Check encryption
      const encryptCheck = await db.query('PRAGMA cipher_version;');
      checks.isEncrypted = encryptCheck.values && encryptCheck.values.length > 0;
      
      console.log('[analytics] Health check:', checks);
      this.sendToAnalytics('sqlite_health_check', checks);
      
      // Alert on failures
      if (!checks.tableExists || !checks.hasCascade) {
        this.sendAlert('CRITICAL: Database health check failed');
      }
      
      return checks;
    } catch (error) {
      console.error('[analytics] Health check failed:', error);
      this.sendAlert('CRITICAL: Health check exception');
      return checks;
    }
  }
  
  private sendToAnalytics(event: string, data: any) {
    // Implement your analytics provider here
    // Examples: Firebase Analytics, Sentry, Mixpanel, etc.
  }
  
  private sendAlert(message: string) {
    // Implement your alerting system here
    // Examples: PagerDuty, Slack, Email, etc.
  }
  
  private getFirstTimeCount(key: string): number {
    // Track in memory or localStorage
    return 0; // Placeholder
  }
}

export const sqliteMonitoring = new SQLiteMonitoring();
```

## Data Flow Diagrams

### Diagram 1: Migration Check Flow
```
App Launch
    ↓
Database.initialize()
    ↓
migrateForeignKeysWithCascade()
    ↓
Query: PRAGMA foreign_key_list(group_members)
    ↓
    ├─→ Has CASCADE? → Skip migration → Log success
    │                                      ↓
    │                                   Continue
    │
    └─→ No CASCADE? → Run migration → Create tables with CASCADE
                                         ↓
                                      Log success
```

### Diagram 2: Group Save Flow
```
fetchGroups()
    ↓
Fetch from Supabase
    ↓
    ├─→ Error? → Log error → Return empty
    │
    └─→ Success (10 groups)
            ↓
        Start timer
            ↓
        Promise.all([
          saveGroup(group1),
          saveGroup(group2),
          ...
          saveGroup(group10)
        ])
            ↓
        All saves complete
            ↓
        End timer (547ms)
            ↓
        Log: "✅ Saved 10 groups (waited 547ms)"
            ↓
        Return (caller can proceed safely)
```

### Diagram 3: group_members Creation Flow
```
fetchMessages(groupId)
    ↓
Try to create group_members row
    ↓
Check: Does group exist in SQLite?
    ↓
    ├─→ No → Log warning → Skip → Continue (degraded)
    │
    └─→ Yes
            ↓
        Check: Does user exist in SQLite?
            ↓
            ├─→ No → Log warning → Skip → Continue (degraded)
            │
            └─→ Yes
                    ↓
                Check: Does row already exist?
                    ↓
                    ├─→ Yes → UPDATE read status
                    │
                    └─→ No → INSERT new row
                                ↓
                            Success → Log success
```

## Error Handling Strategy

### Level 1: Prevention (Precondition Checks)
- Check parent rows exist before INSERT
- Await completion of async operations
- Validate data before database operations

### Level 2: Graceful Degradation
- If FK error occurs, log warning and continue
- User can still view/send messages
- Unread separator may not appear (acceptable)

### Level 3: Retry Mechanism
- Operations can be retried later
- Background sync will eventually fix state
- User doesn't see errors

### Level 4: Monitoring and Alerting
- Track all FK errors in analytics
- Alert if error rate exceeds threshold
- Dashboard shows health metrics

## Performance Considerations

### Optimization 1: Batch Operations
```typescript
// Instead of:
for (const group of groups) {
  await saveGroup(group); // Sequential - slow
}

// Use:
await Promise.all(
  groups.map(group => saveGroup(group)) // Parallel - fast
);
```

### Optimization 2: Cached Schema Checks
```typescript
// Cache table schema to avoid repeated PRAGMA queries
const tableSchemaCache = new Map<string, Set<string>>();

const getTableColumns = async (table: string): Promise<Set<string>> => {
  if (tableSchemaCache.has(table)) {
    return tableSchemaCache.get(table)!; // Cache hit
  }
  
  const res = await db.query(`PRAGMA table_info(${table});`);
  const columns = new Set(res.values.map(r => r.name));
  tableSchemaCache.set(table, columns);
  return columns;
};
```

### Optimization 3: Single Query for Multiple Checks
```typescript
// Instead of 2 queries:
const groupExists = await db.query('SELECT id FROM groups WHERE id = ?', [groupId]);
const userExists = await db.query('SELECT id FROM users WHERE id = ?', [userId]);

// Use 1 query with JOIN:
const result = await db.query(`
  SELECT 
    (SELECT COUNT(*) FROM groups WHERE id = ?) as group_exists,
    (SELECT COUNT(*) FROM users WHERE id = ?) as user_exists
`, [groupId, userId]);

const groupExists = result.values[0].group_exists > 0;
const userExists = result.values[0].user_exists > 0;
```

## Testing Strategy

### Unit Tests
- Test migration check logic
- Test FK validation logic
- Test Promise.all completion
- Mock SQLite operations

### Integration Tests
- Test full initialization flow
- Test with slow network (throttled)
- Test with 50+ groups
- Test migration idempotency

### E2E Tests
- Fresh install scenario
- App restart scenario
- Multiple groups scenario
- Race condition scenario

## Rollback Plan

If issues are discovered in production:

### Step 1: Immediate Rollback
- Revert to previous version
- Monitor error rates

### Step 2: Root Cause Analysis
- Analyze production logs
- Identify which fix caused issue
- Create hotfix

### Step 3: Gradual Re-Rollout
- Deploy hotfix to 5% of users
- Monitor for 24 hours
- Gradually increase to 100%

## Success Criteria

- ✅ Zero FK constraint errors in production
- ✅ Migration only runs once per database
- ✅ Read status persists across app restarts
- ✅ No "FIRST TIME" logs on subsequent opens
- ✅ All operations complete within performance targets
- ✅ Health checks pass on 100% of devices

## Implementation Checklist

- [ ] Fix migration check in `database.ts`
- [ ] Add FK validation to `memberOperations.ts`
- [ ] Fix race conditions in `fetchActions.ts`
- [ ] Update orchestrator to await completions
- [ ] Add Step 0 (save current user)
- [ ] Implement monitoring and analytics
- [ ] Add health checks
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Deploy to staging
- [ ] Test on staging (all scenarios)
- [ ] Deploy to production (canary)
- [ ] Monitor production metrics
- [ ] Gradual rollout to 100%
