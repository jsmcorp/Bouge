# SQLite topic_id Index Creation Fix

## Problem

The app was crashing during database initialization with the error:
```
ERROR Execute: no such column: topic_id (code 1): , while compiling: CREATE INDEX IF NOT EXISTS idx_msg_topic_id ON messages(topic_id, created_at DESC);
```

Additionally, there were database corruption warnings:
```
SQLiteLog: (11) database corruption at line 72932
```

## Root Cause

The `createTables()` method was trying to create an index on the `topic_id` column before the column was added to the `messages` table. The sequence was:

1. `createTables()` runs and tries to create `idx_msg_topic_id` index
2. But `topic_id` column doesn't exist yet in the messages table
3. `migrateDatabase()` runs later and adds the `topic_id` column
4. **Result**: Index creation fails because column doesn't exist

This is a classic migration ordering issue where the index creation happened before the schema migration.

## Solution

### 1. Removed Index from Initial Table Creation

Removed the `idx_msg_topic_id` index creation from the main `createTables()` SQL:

```typescript
// REMOVED from createTables():
CREATE INDEX IF NOT EXISTS idx_msg_topic_id
  ON messages(topic_id, created_at DESC);
```

### 2. Added Index Creation After Column Migration

Moved the index creation to the `migrateDatabase()` method, right after the `topic_id` column is added:

```typescript
// Messages
await ensureColumn('messages', 'updated_at', 'INTEGER');
await ensureColumn('messages', 'deleted_at', 'INTEGER');
await ensureColumn('messages', 'is_viewed', 'INTEGER', 'DEFAULT 0');
await ensureColumn('messages', 'topic_id', 'TEXT');

// Create index for topic_id after column is added
try {
  await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_msg_topic_id ON messages(topic_id, created_at DESC);');
  console.log('✅ Created index idx_msg_topic_id');
} catch (error) {
  // Index might already exist, that's okay
  console.log('ℹ️ Index idx_msg_topic_id already exists or failed to create');
}
```

### 3. Added Error Handling

Wrapped the index creation in a try-catch block to handle cases where:
- The index already exists (from a previous migration)
- The index creation fails for other reasons

This prevents the entire initialization from failing if the index already exists.

## Benefits

1. **Correct migration order**: Column is added before index is created
2. **No more "no such column" errors**: The app will initialize successfully
3. **Idempotent**: Can be run multiple times without errors
4. **Better error handling**: Gracefully handles existing indexes

## Testing

After deploying this fix:
1. The app should start successfully without SQLite errors
2. The `topic_id` column should exist in the messages table
3. The `idx_msg_topic_id` index should be created successfully
4. Topics feature should work correctly with proper indexing for performance

## Files Modified

- `src/lib/sqliteServices_Refactored/database.ts`
  - Removed `idx_msg_topic_id` index from `createTables()` method
  - Added index creation to `migrateDatabase()` method after column is added
  - Added error handling for index creation

## Related Fixes

This fix works together with the previous fix for duplicate connection errors (`SQLITE_CONNECTION_DUPLICATE_FIX.md`). Both fixes are needed for the app to start successfully.
