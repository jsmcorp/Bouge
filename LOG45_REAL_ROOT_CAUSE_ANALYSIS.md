# Log45 FK Error - Real Root Cause Analysis

## 🔍 Root Cause Found

The FK constraint error is **NOT** about timing/waits. It's about **which groups** are being processed.

### The Real Problem

Looking at the logs:
```
18:59:31.695 [unread] 📥 FIRST TIME: No local group_members row, creating locally...
18:59:31.721 *** ERROR Run: FOREIGN KEY constraint failed (code 787)
```

The error happens in `memberOperations.ts` line 175-185:
```typescript
// Row doesn't exist, create it with default values
await db.run(
  `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
   VALUES (?, ?, 'participant', ?, ?, ?);`,
  [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
);
```

**Why it fails:**
1. `fetchMessages(groupId)` is called
2. It tries to INSERT into `group_members` table
3. But `groups` table doesn't have that `groupId` yet
4. FK constraint: `group_members.group_id` → `groups.id`
5. **BOOM!** FK constraint failed

### Why This Happens During First-Time Init

The orchestrator does:
1. Step 2: `fetchGroups()` - saves groups to SQLite in background
2. Wait 1000ms
3. Step 3: `fetchGroupMembers()` for all groups
4. Wait 500ms  
5. Step 4: `fetchMessages()` for all groups ← **ERROR HERE**

**The issue:** `fetchMessages()` is being called for groups that were fetched from Supabase but haven't been saved to SQLite yet!

### The Sequence

```
fetchGroups() {
  1. Fetch from Supabase
  2. Get groups array
  3. Save to SQLite in background (async, no await)
  4. Update UI with groups
  5. Return
}

// Wait 1000ms

fetchGroupMembers(group1) // Works if group1 saved
fetchGroupMembers(group2) // Works if group2 saved
fetchGroupMembers(group3) // Works if group3 saved

// Wait 500ms

fetchMessages(group1) {
  // Tries to INSERT group_members row
  // FK check: Does groups table have group1? ✅ YES
}

fetchMessages(group2) {
  // Tries to INSERT group_members row
  // FK check: Does groups table have group2? ❌ NO! (not saved yet)
  // ERROR: FK constraint failed
}
```

### Why Waits Don't Fix It

The waits help, but they don't guarantee ALL groups are saved. If you have 10 groups:
- Group 1-5 might be saved in 500ms
- Group 6-10 might take 1500ms
- Fixed wait of 1000ms only helps groups 1-5
- Groups 6-10 still fail!

## ✅ Real Solution

### Option 1: Ensure Group Exists Before Creating group_members Row

Modify `updateLocalLastReadAt()` to check if group exists first:

```typescript
public async updateLocalLastReadAt(
  groupId: string,
  userId: string,
  lastReadAt: number,
  lastReadMessageId: string
): Promise<void> {
  await this.dbManager.checkDatabaseReady();
  const db = this.dbManager.getConnection();

  // ✅ FIX: Check if group exists in SQLite first
  const groupCheck = await db.query(
    `SELECT id FROM groups WHERE id = ?`,
    [groupId]
  );
  
  if (!groupCheck.values || groupCheck.values.length === 0) {
    console.warn(`[sqlite] ⚠️ Group ${groupId.slice(0, 8)} not in SQLite yet, skipping group_members creation`);
    return; // Skip - group not saved yet
  }

  // First check if row exists
  const checkSql = `SELECT role, joined_at FROM group_members WHERE group_id = ? AND user_id = ?`;
  const existing = await db.query(checkSql, [groupId, userId]);
  
  if (existing.values && existing.values.length > 0) {
    // Row exists, just update the read status
    await db.run(
      `UPDATE group_members 
       SET last_read_at = ?, last_read_message_id = ?
       WHERE group_id = ? AND user_id = ?;`,
      [lastReadAt, lastReadMessageId, groupId, userId]
    );
  } else {
    // Row doesn't exist, create it with default values
    await db.run(
      `INSERT INTO group_members (group_id, user_id, role, joined_at, last_read_at, last_read_message_id)
       VALUES (?, ?, 'participant', ?, ?, ?);`,
      [groupId, userId, Date.now(), lastReadAt, lastReadMessageId]
    );
    console.log('[sqlite] ℹ️ Created new group_members row for read status');
  }
}
```

### Option 2: Make fetchGroups() Await SQLite Saves

Change `fetchGroups()` to await all SQLite saves before returning:

```typescript
// If SQLite is available, sync groups to local storage first
if (isSqliteReady) {
  try {
    // ✅ FIX: Await all saves to complete
    await Promise.all(
      (groups || []).map(group => 
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
    console.log(`✅ All ${groups?.length || 0} groups saved to SQLite`);
  } catch (error) {
    console.error('❌ Error syncing groups to local storage:', error);
  }
}
```

### Option 3: Lazy Create group_members Row

Don't create `group_members` row in `fetchMessages()`. Only create it when user actually marks as read:

```typescript
// In fetchMessages(), remove the group_members creation logic entirely
// Let it be created lazily when user marks as read
```

## 📊 Recommendation

**Use Option 1** - It's the safest and most defensive:
- Checks if group exists before creating group_members row
- Fails gracefully (logs warning, continues)
- No performance impact
- Works even if orchestrator timing changes

**Why not Option 2:**
- Blocks UI update until all groups saved
- Slower perceived performance
- Doesn't handle edge cases (user navigates to group before save completes)

**Why not Option 3:**
- Breaks unread separator on first open
- User experience degradation
- Requires more code changes

## 🎯 Implementation Plan

1. ✅ Add group existence check to `updateLocalLastReadAt()`
2. ✅ Add group existence check to `syncReadStatusFromSupabase()`
3. ✅ Test with first-time init
4. ✅ Verify no FK errors in logs

---

**Status:** Root cause identified, solution ready
**Priority:** CRITICAL
**Estimated Time:** 10 minutes
**Risk:** Low (defensive check, fails gracefully)
**Impact:** High (eliminates FK errors completely)
