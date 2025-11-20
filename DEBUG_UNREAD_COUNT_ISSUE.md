# Debug: Unread Count Issue - Count 31 After Resume

## Problem Analysis from log26.txt

### Timeline

1. **18:12:12** - App starts, fetches count: **29**
2. **18:12:26** - User opens chat, `markGroupAsRead` is called with message `030e2af0-39fc-40ad-8631-79d49681627c`
3. **18:12:26-27** - `markGroupAsRead` hangs at `auth.getUser()` - **NEVER COMPLETES**
4. **18:12:47** - New message arrives via FCM, local count increments: 0 → 1
5. **18:12:52** - App goes to background
6. **18:13:04** - App resumes, fetches count from Supabase: **31** ❌

### Root Cause

**The `mark_group_as_read` RPC call never completed**, so the read status was never saved to Supabase.

#### Why it didn't complete:
- `auth.getUser()` hung because a session refresh was in progress at the same time
- The session refresh itself timed out after 10 seconds
- The `markGroupAsRead` function was waiting for `auth.getUser()` which never returned

#### Why the count is 31:
- The database still has the old `last_read_at` timestamp (from before the user opened the chat)
- When the app resumes, `get_all_unread_counts` counts all messages after that old timestamp
- Result: 31 messages (29 that were already there + 2 new ones)

## The Fix

### 1. Add Timeout to markGroupAsRead

The `auth.getUser()` call can hang indefinitely. We need to add a timeout:

```typescript
// Add timeout wrapper
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
};

// In markGroupAsRead:
try {
  const { data: { user } } = await withTimeout(
    client.auth.getUser(),
    3000 // 3 second timeout
  );
  // ... rest of code
} catch (error) {
  if (error.message === 'Timeout') {
    console.error('[unread] ❌ auth.getUser() timed out after 3s');
    // Fallback: use cached session
    const session = await supabasePipeline.getCachedSession();
    if (session?.user) {
      // Continue with cached user
    }
  }
}
```

### 2. Use Cached User Instead of auth.getUser()

Better approach: Don't call `auth.getUser()` at all - use the cached session:

```typescript
public async markGroupAsRead(groupId: string, lastMessageId: string): Promise<boolean> {
  if (!groupId || !lastMessageId) {
    console.warn('[unread] ⚠️ markGroupAsRead called with missing params, aborting');
    return false;
  }

  try {
    console.log('[unread] 🔵 markGroupAsRead CALLED:', { groupId, lastMessageId });
    
    // Use cached session instead of auth.getUser() to avoid hanging
    const session = await supabasePipeline.getCachedSession();
    
    if (!session?.user) {
      console.warn('[unread] ❌ No cached session, cannot mark as read');
      return false;
    }

    console.log('[unread] ✅ Got cached user:', session.user.id);
    
    const client = await supabasePipeline.getDirectClient();
    
    const { error } = await client.rpc('mark_group_as_read', {
      p_group_id: groupId,
      p_user_id: session.user.id,
      p_last_message_id: lastMessageId,
    });

    if (error) {
      console.error('[unread] ❌ Mark as read RPC error:', error);
      return false;
    }

    console.log('[unread] ✅ Supabase RPC mark_group_as_read succeeded');
    return true;
  } catch (error) {
    console.error('[unread] ❌ Exception in markGroupAsRead:', error);
    return false;
  }
}
```

### 3. Database Investigation Needed

We also need to check why the database is returning 31. Run this query in Supabase SQL Editor:

```sql
-- Check the current read status
SELECT 
  gm.last_read_at,
  gm.last_read_message_id,
  m.created_at as last_message_timestamp,
  m.id as last_message_id
FROM group_members gm
LEFT JOIN messages m ON m.id = gm.last_read_message_id
WHERE gm.group_id = '04a965fb-b53d-41bd-9372-5f25a5c1bec9'
  AND gm.user_id = '852432e2-c453-4f00-9ec7-ecf6bda87676';

-- Count messages after last_read_at
SELECT COUNT(*) as unread_count
FROM messages m
JOIN group_members gm ON m.group_id = gm.group_id
WHERE gm.group_id = '04a965fb-b53d-41bd-9372-5f25a5c1bec9'
  AND gm.user_id = '852432e2-c453-4f00-9ec7-ecf6bda87676'
  AND (gm.last_read_at IS NULL OR m.created_at > gm.last_read_at);

-- Check if the message 030e2af0-39fc-40ad-8631-79d49681627c exists
SELECT id, created_at, content
FROM messages
WHERE id = '030e2af0-39fc-40ad-8631-79d49681627c';
```

## Implementation

Apply the fix by using cached session instead of `auth.getUser()`.
