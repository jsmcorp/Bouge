# 🔍 Parameter Mismatch Diagnostic - ENHANCED

## 🎉 BREAKTHROUGH CONFIRMED!

The row **IS persisting** across app restarts! Health check proves it:

```
03:06:01.492 - HEALTH-CHECK: group_members row count: 1 ✅
03:06:01.545 - HEALTH-CHECK: Existing rows: {...} ✅
```

## 🚨 THE REAL BUG: Query Parameter Mismatch

### Evidence

**Health Check (App Startup):**
- ✅ Row count = 1 (row exists!)
- ✅ Row data visible

**Chat Open Query (3 seconds later):**
- ❌ Query returns "NOT FOUND"
- ❌ Code creates duplicate/replacement row
- ❌ "FIRST TIME" logs appear

### Hypothesis

The `SELECT` query is using **different parameters** than what's stored in the database.

Possible causes:
1. **UUID format mismatch** (with/without dashes)
2. **Case sensitivity** (uppercase vs lowercase)
3. **Whitespace** (trailing spaces, newlines)
4. **Different group/user ID** being passed

## 🔧 Enhanced Diagnostics Implemented

### 1. Health Check Enhancement (`database.ts`)

Now shows FULL IDs for comparison:

```typescript
allRows.values.forEach((row: any, idx: number) => {
  console.log(`🏥 [HEALTH-CHECK] 📋 Row ${idx + 1} FULL IDs:`, {
    group_id_full: row.group_id,
    group_id_short: row.group_id?.slice(0, 8),
    user_id_full: row.user_id,
    user_id_short: row.user_id?.slice(0, 8),
    last_read_at: row.last_read_at,
    last_read_message_id_short: row.last_read_message_id?.slice(0, 8)
  });
});
```

### 2. Query Parameter Logging (`memberOperations.ts`)

Shows FULL query parameters:

```typescript
console.log(`[sqlite-query] 🔍 getLocalLastReadAt called with:`, {
  groupId_full: groupId,
  groupId_short: groupId.slice(0, 8),
  groupId_length: groupId.length,
  userId_full: userId,
  userId_short: userId.slice(0, 8),
  userId_length: userId.length
});
```

### 3. NOT FOUND Diagnostic

When query returns no results, shows ALL rows for comparison:

```typescript
if (!result.values || result.values.length === 0) {
  console.warn(`[sqlite-query] ⚠️ NOT FOUND! Showing all rows for comparison:`);
  const allRows = await db.query(`SELECT group_id, user_id, last_read_at FROM group_members`);
  allRows.values.forEach((row: any, idx: number) => {
    const groupMatch = row.group_id === groupId;
    const userMatch = row.user_id === userId;
    console.log(`[sqlite-query] 📋 Row ${idx + 1}:`, {
      group_id: row.group_id,
      group_match: groupMatch ? '✅' : '❌',
      user_id: row.user_id,
      user_match: userMatch ? '✅' : '❌',
      last_read_at: row.last_read_at
    });
  });
}
```

## 📊 What to Look For in Next Test

### Expected Log Sequence

```
1. App Startup:
   🏥 [HEALTH-CHECK] group_members row count: 1
   🏥 [HEALTH-CHECK] 📋 Row 1 FULL IDs:
     group_id_full: "04a965fb-b53d-41bd-9372-5f25a5c1bec9"
     user_id_full: "852432e2-c453-4f00-9ec7-ecf6bda87676"

2. Open Chat:
   [sqlite-query] 🔍 getLocalLastReadAt called with:
     groupId_full: "???"  ← COMPARE THIS
     userId_full: "???"   ← COMPARE THIS
   
   [sqlite-query] 🔍 Query result:
     found: false ← IF FALSE, SHOWS MISMATCH
   
   [sqlite-query] ⚠️ NOT FOUND! Showing all rows:
   [sqlite-query] 📋 Row 1:
     group_id: "04a965fb-b53d-41bd-9372-5f25a5c1bec9"
     group_match: ❌ ← WILL SHOW IF MISMATCH
     user_id: "852432e2-c453-4f00-9ec7-ecf6bda87676"
     user_match: ❌ ← WILL SHOW IF MISMATCH
```

### Key Comparisons

Compare these values:
1. **Health check `group_id_full`** vs **Query `groupId_full`**
2. **Health check `user_id_full`** vs **Query `userId_full`**
3. **String lengths** (should be 36 chars for UUIDs with dashes)
4. **Case** (should match exactly)

## 🎯 Expected Findings

### If UUIDs Match ✅
- `group_match: ✅`
- `user_match: ✅`
- Query should return row
- **This means the bug is elsewhere** (SQLite query issue?)

### If UUIDs Don't Match ❌
- `group_match: ❌` or `user_match: ❌`
- **Root cause found!**
- Need to trace where the wrong ID is coming from

## 🔍 Possible Root Causes

### 1. Different Group ID Being Passed
```typescript
// Health check shows: "04a965fb-b53d-41bd-9372-5f25a5c1bec9"
// Query uses:         "04a965fb-XXXX-XXXX-XXXX-XXXXXXXXXXXX" ← Different!
```

**Fix:** Ensure `activeGroup.id` is the same group that was saved

### 2. UUID Format Mismatch
```typescript
// Stored:  "04a965fb-b53d-41bd-9372-5f25a5c1bec9" (with dashes)
// Query:   "04a965fbb53d41bd93725f25a5c1bec9"     (without dashes)
```

**Fix:** Normalize UUID format before query

### 3. Case Sensitivity
```typescript
// Stored:  "04A965FB-B53D-41BD-9372-5F25A5C1BEC9" (uppercase)
// Query:   "04a965fb-b53d-41bd-9372-5f25a5c1bec9" (lowercase)
```

**Fix:** Use `COLLATE NOCASE` in query or normalize case

### 4. Whitespace
```typescript
// Stored:  "04a965fb-b53d-41bd-9372-5f25a5c1bec9\n" (trailing newline)
// Query:   "04a965fb-b53d-41bd-9372-5f25a5c1bec9"
```

**Fix:** Trim whitespace before storing/querying

## ✅ What's Already Working

1. ✅ CASCADE migration check (no more table drops)
2. ✅ Row creation and updates
3. ✅ Row persistence across restarts
4. ✅ Supabase sync
5. ✅ Timestamp comparison
6. ✅ WAL checkpoint

## 🚀 Next Steps

1. **Test with enhanced diagnostics**
2. **Compare health check IDs vs query IDs**
3. **Identify the mismatch**
4. **Apply targeted fix**

## 📝 Files Modified

- `src/lib/sqliteServices_Refactored/database.ts` - Enhanced health check
- `src/lib/sqliteServices_Refactored/memberOperations.ts` - Query diagnostics

## 🎯 Success Criteria

When fixed, you should see:
```
[sqlite-query] 🔍 Query result:
  found: true ✅
  rowCount: 1
  lastReadAt: 1763933693018
```

And NO MORE:
- ❌ "FIRST TIME" logs on every chat open
- ❌ "NOT FOUND" when row exists
- ❌ Duplicate row creation
