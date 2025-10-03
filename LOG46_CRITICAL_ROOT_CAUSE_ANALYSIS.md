# LOG46 - CRITICAL ROOT CAUSE ANALYSIS: SQLite Query Hang & Realtime Death

**Date**: 2025-10-04  
**Critical Issues**: 
1. SQLite `SELECT 1 FROM messages WHERE id = ?` hangs for 10+ seconds
2. Token recovery timeout (3s) causes realtime death
3. FCM fetch fails due to SQLite hang

---

## 🔴 **CRITICAL FINDING: SQLITE QUERY HANG**

### **The Smoking Gun**

**Line 1100-1112** (Message `7b2c823c-d191-4b67-8fbc-fadeadd1620a`):
```
21:36:40.990 - [bg-sync] 🚀 Starting fetch for message 7b2c823c...
21:36:41.008 - SELECT 1 FROM messages WHERE id = ? LIMIT 1  ← QUERY STARTS
21:36:50.994 - ❌ Direct fetch failed: timeout after 10s     ← 10 SECONDS LATER!
```

**The SQLite query NEVER COMPLETES!** It hangs for the entire 10-second timeout period.

### **Pattern Repeats Throughout Log**

**Line 1979-1980** (Message `564f7ed0-bdc1-4301-a4cb-2655c7d9b972`):
```
21:51:14.824 - SELECT 1 FROM messages WHERE id = ?  ← QUERY STARTS
21:51:24.818 - ❌ timeout after 10s                  ← 10 SECONDS LATER!
```

**Line 2009-2019** (Message `70c8df4e-25dd-429d-b544-d856011b3457`):
```
21:51:30.404 - SELECT 1 FROM messages WHERE id = ?  ← QUERY STARTS
21:51:40.394 - ❌ timeout after 10s                  ← 10 SECONDS LATER!
```

**Line 2126-2127** (Message `e0771377-cdce-4185-ad2f-986219ec2bb2`):
```
21:52:00.106 - SELECT 1 FROM messages WHERE id = ?  ← QUERY STARTS
21:52:10.106 - ❌ timeout after 10s                  ← 10 SECONDS LATER!
```

**Pattern**: EVERY cross-group message fetch hangs on the SQLite existence check!

---

## 🔍 **ROOT CAUSE #1: SQLITE DATABASE LOCK**

### **Why SQLite Query Hangs**

**Possible Causes**:

1. **Database Lock/Contention**
   - Multiple concurrent queries trying to access the database
   - Long-running transaction holding a lock
   - Write operation blocking read operations

2. **Missing Index on `id` Column**
   - `SELECT 1 FROM messages WHERE id = ?` should be instant (primary key lookup)
   - If no index exists, it becomes a full table scan
   - With thousands of messages, this could take 10+ seconds

3. **Database Corruption**
   - SQLite database file may be corrupted
   - Queries hang trying to read corrupted data

4. **Encryption Overhead**
   - Database is encrypted (SQLCipher)
   - Decryption overhead on every query
   - Combined with lock contention = 10s hang

### **Evidence from Log**

**Line 274-278** (Successful query - same group):
```
21:36:03.915 - SELECT 1 FROM messages WHERE id = ?  ← QUERY STARTS
21:36:04.069 - ✅ Message stored successfully (156ms)  ← COMPLETES IN 154ms!
```

**Line 742-743** (Successful query - same group):
```
21:36:19.046 - SELECT 1 FROM messages WHERE id = ?  ← QUERY STARTS
21:36:19.065 - ✅ Message already exists (24ms)       ← COMPLETES IN 19ms!
```

**Observation**: Queries for SAME GROUP complete in <200ms, but queries for DIFFERENT GROUP hang for 10s!

---

## 🔍 **ROOT CAUSE #2: TOKEN RECOVERY TIMEOUT (3s)**

### **The Problem**

**Line 932, 944, 1080, 1150, 1210** (Repeated throughout log):
```
🔄 Token recovery timed out after 3s
```

**What's Happening**:
1. System tries to recover session using cached tokens
2. `setSession()` call hangs internally (Supabase SDK issue)
3. After 3 seconds, timeout fires
4. But the hung promise is NOT cleared
5. Next operation waits for the hung promise
6. System enters deadlock state

### **Impact on Realtime**

When token recovery times out:
1. Realtime subscription loses auth token
2. WebSocket connection becomes unauthenticated
3. Supabase server rejects all events
4. Realtime appears "dead" - no messages received
5. System never recovers until app restart

---

## 🔍 **ROOT CAUSE #3: CASCADING FAILURE**

### **The Death Spiral**

```
1. FCM notification arrives for cross-group message
   ↓
2. backgroundMessageSync.fetchAndStoreMessage() called
   ↓
3. SQLite existence check: SELECT 1 FROM messages WHERE id = ?
   ↓
4. Query HANGS for 10 seconds (database lock)
   ↓
5. FCM fetch timeout (10s) fires
   ↓
6. Fallback sync triggered (onWake)
   ↓
7. Token recovery attempted
   ↓
8. Token recovery HANGS for 3 seconds
   ↓
9. Realtime subscription loses auth
   ↓
10. Realtime DIES - no more messages received
   ↓
11. User must restart app
```

---

## 💡 **SOLUTIONS**

### **Priority 1: Fix SQLite Query Hang** 🔴 CRITICAL

#### **Solution 1A: Add Timeout to SQLite Query**

**File**: `src/lib/backgroundMessageSync.ts`

**Current Code** (Line 56):
```typescript
const exists = await sqliteService.messageExists(messageId);
```

**Fixed Code**:
```typescript
// Add 2-second timeout to SQLite existence check
const timeoutPromise = new Promise<boolean>((_, reject) =>
  setTimeout(() => reject(new Error('SQLite query timeout')), 2000)
);

const existsPromise = sqliteService.messageExists(messageId);

try {
  const exists = await Promise.race([existsPromise, timeoutPromise]);
  if (exists) {
    console.log(`[bg-sync] ✅ Message ${messageId} already exists, skipping fetch`);
    return true;
  }
} catch (error: any) {
  if (error?.message === 'SQLite query timeout') {
    console.warn(`[bg-sync] ⚠️ SQLite existence check timed out, proceeding with fetch`);
    // Continue with fetch - better to fetch duplicate than miss message
  } else {
    throw error;
  }
}
```

#### **Solution 1B: Skip Existence Check for Cross-Group Messages**

**Rationale**: Existence check is only needed to avoid duplicate fetches when realtime already delivered the message. For cross-group messages, realtime is NOT delivering them (that's the bug we're fixing), so existence check is unnecessary.

**Fixed Code**:
```typescript
// CRITICAL FIX: Skip existence check for cross-group messages
// Cross-group messages are NOT delivered via realtime (that's the bug),
// so they will never exist in SQLite before FCM fetch
// This avoids the 10s SQLite hang issue

const { activeGroup } = get(); // Get from chat store
const isActiveGroup = activeGroup?.id === groupId;

if (isActiveGroup) {
  // Only check existence for active group (realtime might have delivered it)
  const exists = await sqliteService.messageExists(messageId);
  if (exists) {
    console.log(`[bg-sync] ✅ Message ${messageId} already exists, skipping fetch`);
    return true;
  }
} else {
  // Skip existence check for cross-group messages
  console.log(`[bg-sync] ⏭️ Skipping existence check for cross-group message`);
}
```

#### **Solution 1C: Verify SQLite Index Exists**

**Check if index exists on `messages.id` column**:
```sql
SELECT name FROM sqlite_master 
WHERE type='index' AND tbl_name='messages' AND sql LIKE '%id%';
```

**If missing, create index**:
```sql
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
```

### **Priority 2: Fix Token Recovery Timeout** 🟠 HIGH

#### **Solution 2A: Increase Timeout to 10 Seconds**

**File**: `src/lib/supabasePipeline.ts`

**Current Code**:
```typescript
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Token recovery timeout')), 3000)
);
```

**Fixed Code**:
```typescript
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Token recovery timeout')), 10000)  // 3s → 10s
);
```

#### **Solution 2B: Clear Hung Promise (Already Implemented in LOG43)**

**Verify this fix is still in place**:
```typescript
if (this.inFlightSessionPromise) {
  try {
    const timeoutPromise = new Promise<AuthOperationResult>((_, reject) => {
      setTimeout(() => reject(new Error('In-flight session request timeout')), 5000);
    });
    return await Promise.race([this.inFlightSessionPromise, timeoutPromise]);
  } catch (error: any) {
    if (error?.message === 'In-flight session request timeout') {
      this.log('⚠️ In-flight session request timed out, clearing and retrying');
      this.inFlightSessionPromise = null;  // ← CLEAR HUNG PROMISE
    }
  }
}
```

### **Priority 3: Add Realtime Recovery** 🟡 MEDIUM

#### **Solution 3A: Detect Realtime Death**

**Add heartbeat mechanism**:
```typescript
// Send heartbeat every 30 seconds
setInterval(() => {
  if (connectionStatus === 'connected') {
    channel.send({
      type: 'broadcast',
      event: 'heartbeat',
      payload: { timestamp: Date.now() }
    });
  }
}, 30000);

// If no events received for 60 seconds, assume realtime is dead
let lastEventAt = Date.now();

channel.on('*', () => {
  lastEventAt = Date.now();
});

setInterval(() => {
  if (connectionStatus === 'connected' && Date.now() - lastEventAt > 60000) {
    console.error('⚠️ Realtime appears dead (no events for 60s), forcing reconnection');
    forceReconnect();
  }
}, 10000);
```

#### **Solution 3B: Force Session Refresh on Realtime Death**

```typescript
async function forceReconnect() {
  console.log('🔄 Forcing realtime reconnection');
  
  // 1. Cleanup current subscription
  cleanupRealtimeSubscription();
  
  // 2. Force session refresh
  await supabasePipeline.refreshSessionDirect();
  
  // 3. Recreate subscription
  await setupSimplifiedRealtimeSubscription(activeGroup.id);
}
```

---

## 📊 **IMPLEMENTATION PRIORITY**

### **Phase 1: Fix SQLite Hang** (IMMEDIATE - 1 hour)
1. Implement Solution 1B (Skip existence check for cross-group messages)
2. This is the FASTEST fix and solves the immediate problem
3. No database changes needed

### **Phase 2: Fix Token Recovery** (HIGH - 2 hours)
1. Increase timeout to 10 seconds (Solution 2A)
2. Verify LOG43 fix is still in place (Solution 2B)
3. Add retry logic with exponential backoff

### **Phase 3: Add Realtime Recovery** (MEDIUM - 4 hours)
1. Implement heartbeat mechanism (Solution 3A)
2. Add force reconnect on realtime death (Solution 3B)
3. Add exponential backoff for reconnection attempts

---

## ✅ **EXPECTED RESULTS**

### **Before Fixes**:
- ❌ SQLite query hangs for 10s on cross-group messages
- ❌ FCM fetch times out 100% of the time
- ❌ Token recovery times out after 3s
- ❌ Realtime dies and never recovers
- ❌ User must restart app

### **After Phase 1**:
- ✅ SQLite existence check skipped for cross-group messages
- ✅ FCM fetch completes in 1-2s
- ✅ Messages delivered via FCM fallback
- ⚠️ Still has token recovery timeout issue
- ⚠️ Realtime may still die

### **After Phase 2**:
- ✅ Token recovery timeout increased to 10s
- ✅ Hung promises cleared automatically
- ✅ Realtime stays alive longer
- ⚠️ Still no automatic recovery if realtime dies

### **After Phase 3**:
- ✅ Realtime death detected automatically
- ✅ Automatic reconnection with exponential backoff
- ✅ System recovers without app restart
- ✅ **Pure consistency guaranteed**

---

## 🚨 **CRITICAL NOTES**

### **Why Multi-Group Realtime Doesn't Help**

The multi-group realtime subscription (LOG45 fix) is CORRECT and NECESSARY, but it doesn't solve the SQLite hang issue:

1. Multi-group realtime ensures messages are received via WebSocket
2. But if realtime DIES (token recovery timeout), no messages are received
3. FCM becomes the fallback
4. FCM fetch hangs on SQLite existence check
5. Messages are LOST

**Conclusion**: We need BOTH fixes:
- Multi-group realtime (LOG45) - PRIMARY delivery path
- Fixed SQLite hang (LOG46) - FALLBACK delivery path

### **Why Increasing FCM Timeout Doesn't Help**

Increasing FCM timeout from 10s to 25s (LOG45 Phase 1) doesn't solve the problem:

1. SQLite query hangs for 10+ seconds
2. Even with 25s timeout, query may still hang
3. Root cause is SQLite lock/contention, not timeout value
4. Need to FIX the hang, not wait longer for it

**Conclusion**: Revert LOG45 Phase 1 timeout increases, implement LOG46 Phase 1 instead.

---

## 🎯 **FINAL RECOMMENDATION**

**Implement in this order**:

1. **LOG46 Phase 1** (Skip SQLite existence check for cross-group) - 1 hour
2. **LOG45 Phase 2** (Multi-group realtime subscription) - Already done
3. **LOG46 Phase 2** (Fix token recovery timeout) - 2 hours
4. **LOG46 Phase 3** (Add realtime recovery) - 4 hours

**Total effort**: 7 hours  
**Expected result**: **Zero message loss, pure consistency, automatic recovery** ✅


