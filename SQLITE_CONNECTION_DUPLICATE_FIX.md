# SQLite Connection Duplicate Fix

## Problem

The app was crashing during initialization with the error:
```
CreateConnection: Connection confessr_db already exists
```

This error occurred because multiple parts of the code were calling `sqliteService.initialize()` concurrently, and each call attempted to create a new database connection with the same name. The SQLite plugin doesn't allow duplicate connections.

## Root Cause

The `DatabaseManager.initialize()` method had two issues:

1. **No connection reuse**: The `openEncryptedDatabase()` method always called `createConnection()` without checking if a connection already existed
2. **No concurrency protection**: Multiple concurrent calls to `initialize()` could all pass the `if (this.isInitialized)` check before any of them set the flag

## Solution

### 1. Connection Reuse in `openEncryptedDatabase()`

Added logic to check if a connection already exists and reuse it:

```typescript
// Check if connection already exists
const existingConn = await this.sqlite.isConnection(this.dbName, false);
if (existingConn.result) {
  console.log('♻️ Connection already exists, retrieving existing connection...');
  this.db = await this.sqlite.retrieveConnection(this.dbName, false);
  
  // Verify the connection is open
  const isOpen = await this.db.isDBOpen();
  if (!isOpen.result) {
    console.log('🔓 Connection exists but closed, reopening...');
    await this.db.open();
  }
  console.log('✅ Using existing encrypted database connection');
} else {
  // Create new connection only if it doesn't exist
  const conn = await this.sqlite.createConnection(...);
  await conn.open();
  this.db = conn;
}
```

### 2. Concurrency Protection

Added an `isInitializing` flag to prevent concurrent initialization:

```typescript
private isInitializing = false;

public async initialize(): Promise<void> {
  if (this.isInitialized) {
    console.log('✅ Database already initialized, skipping...');
    return;
  }
  
  if (this.isInitializing) {
    console.log('⏳ Database initialization already in progress, waiting...');
    // Wait for the ongoing initialization to complete
    while (this.isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (this.isInitialized) {
      console.log('✅ Database initialized by concurrent call');
      return;
    }
  }
  
  this.isInitializing = true;
  try {
    // ... initialization logic ...
  } finally {
    this.isInitializing = false;
  }
}
```

## Benefits

1. **Prevents duplicate connection errors**: The app will no longer crash with "Connection already exists"
2. **Handles concurrent initialization**: Multiple parts of the code can safely call `initialize()` at the same time
3. **Efficient resource usage**: Reuses existing connections instead of creating new ones
4. **Better error handling**: The `finally` block ensures the lock is always released

## Testing

After deploying this fix:
1. The app should start successfully without SQLite connection errors
2. All database operations (contacts sync, group members, messages) should work correctly
3. The logs should show either "Using existing encrypted database connection" or "Creating new encrypted database connection" but never the duplicate connection error

## Files Modified

- `src/lib/sqliteServices_Refactored/database.ts`
  - Added `isInitializing` flag
  - Modified `initialize()` method with concurrency protection
  - Modified `openEncryptedDatabase()` to check for and reuse existing connections
