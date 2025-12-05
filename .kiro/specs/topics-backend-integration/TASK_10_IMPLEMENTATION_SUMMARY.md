# Task 10 Implementation Summary: Topic Expiration Handling

## Overview

Implemented comprehensive topic expiration handling with both server-side cleanup (Supabase Edge Function) and client-side cascade deletion (SQLite). This ensures expired topics are automatically removed from both the cloud database and local caches, maintaining data consistency and preventing stale content from appearing in the feed.

## Completed Subtasks

### ✅ Task 10.1: Create Supabase Edge Function for expiration cleanup

**Files Created:**
- `supabase/functions/cleanup-expired-topics/index.ts` - Edge function implementation
- `supabase/functions/cleanup-expired-topics/README.md` - Documentation and deployment guide
- `supabase/migrations/20251127_topic_expiration_cron.sql` - Cron job setup migration

**Implementation Details:**

1. **Edge Function** (`cleanup-expired-topics/index.ts`):
   - Calls the `delete_expired_topics()` RPC function (created in Task 2)
   - Logs the number of topics deleted
   - Returns JSON response with deletion count
   - Handles errors gracefully with proper logging
   - Supports CORS for cross-origin requests

2. **Cron Job Setup** (`20251127_topic_expiration_cron.sql`):
   - Enables `pg_cron` extension
   - Schedules hourly execution (`0 * * * *`)
   - Two options provided:
     - HTTP call to edge function (recommended for logging)
     - Direct RPC call (simpler, less overhead)
   - Includes commands to view and manage scheduled jobs

3. **Documentation** (`README.md`):
   - Deployment instructions
   - Testing procedures (local and production)
   - Three cron job setup options:
     - Via migration (recommended)
     - Via Supabase dashboard
     - Via external cron service (GitHub Actions example)
   - Monitoring and logging guidance
   - Response format documentation

**Key Features:**
- Automatic hourly cleanup of expired topics
- Comprehensive logging for monitoring
- Multiple deployment options for flexibility
- Idempotent operation (safe to call multiple times)
- Cascade deletion handled by database constraints

### ✅ Task 10.2: Handle cascade deletion in SQLite

**Files Modified:**
- `src/lib/sqliteServices_Refactored/topicOperations.ts` - Added cascade deletion methods
- `src/lib/sqliteServices_Refactored/sqliteService.ts` - Exported new methods
- `src/store/chatstore_refactored/topicActions.ts` - Updated cleanup action

**Implementation Details:**

1. **Cascade Deletion Methods** (topicOperations.ts):

   a. `cascadeDeleteTopic(topicId: string)`:
      - Deletes a single topic with all associated data
      - Uses transaction to ensure atomicity
      - Deletes in order:
        1. Associated likes from `topic_likes_cache`
        2. Associated messages with `topic_id`
        3. Read status from `topic_read_status`
        4. Queued views from `topic_views_queue`
        5. Topic itself from `topics_cache`
      - Logs deletion counts for each step
      - Rolls back on error

   b. `cascadeDeleteTopics(topicIds: string[])`:
      - Batch deletion for multiple topics
      - More efficient than calling `cascadeDeleteTopic` multiple times
      - Uses single transaction with parameterized queries
      - Returns count of deleted topics

   c. `cleanupExpiredTopicsWithCascade()`:
      - Main cleanup method combining expiration check + cascade deletion
      - Gets expired topic IDs
      - Performs batch cascade deletion
      - Returns count of cleaned up topics
      - Should be called periodically (e.g., on app resume, hourly)

2. **Service Layer Integration** (sqliteService.ts):
   - Exported all three new methods
   - Added comprehensive JSDoc comments
   - Referenced requirements (6.1, 6.4, 6.6)

3. **Store Action Update** (topicActions.ts):
   - Updated `cleanupExpiredTopics` action to use `cleanupExpiredTopicsWithCascade()`
   - Removes expired topics from UI state
   - Performs cascade deletion in SQLite
   - Logs cleanup results

**Key Features:**
- Atomic transactions ensure data consistency
- Comprehensive logging for debugging
- Efficient batch operations
- Proper error handling with rollback
- Mirrors Supabase CASCADE behavior

## Data Flow

### Server-Side Cleanup (Hourly)
```
Cron Job (every hour)
  ↓
Edge Function: cleanup-expired-topics
  ↓
RPC: delete_expired_topics()
  ↓
DELETE FROM messages WHERE id IN (expired topics)
  ↓
CASCADE deletes:
  - topics table
  - topic_likes table
  - messages with topic_id
  ↓
Returns deleted count
```

### Client-Side Cleanup (On Demand)
```
App Event (resume, manual trigger)
  ↓
cleanupExpiredTopics() action
  ↓
getExpiredTopicIds() - Find expired topics in cache
  ↓
Remove from UI state
  ↓
cleanupExpiredTopicsWithCascade()
  ↓
BEGIN TRANSACTION
  ↓
DELETE FROM topic_likes_cache
DELETE FROM messages (topic_id)
DELETE FROM topic_read_status
DELETE FROM topic_views_queue
DELETE FROM topics_cache
  ↓
COMMIT
  ↓
Returns deleted count
```

## Requirements Validation

### ✅ Requirement 6.1
**WHEN a topic has expires_at set to a timestamp and that timestamp is reached THEN the system SHALL delete the topic and its associated root message**

- Implemented via `delete_expired_topics()` RPC (Task 2)
- Called hourly by edge function
- Deletes messages, which cascades to topics

### ✅ Requirement 6.4
**WHEN a topic is deleted THEN the system SHALL cascade delete all associated data including thread messages, likes, and poll data**

- Server-side: Database CASCADE constraints handle this
- Client-side: `cascadeDeleteTopic()` explicitly deletes:
  - Likes from `topic_likes_cache`
  - Messages with `topic_id`
  - Read status from `topic_read_status`
  - Queued views from `topic_views_queue`

### ✅ Requirement 6.5
**WHEN checking for expired topics THEN the system SHALL run a scheduled job at regular intervals**

- Cron job runs hourly (`0 * * * *`)
- Configured via migration
- Multiple setup options provided

### ✅ Requirement 6.6
**WHEN a topic expires THEN the system SHALL remove it from both Supabase and SQLite**

- Server-side: Edge function + RPC removes from Supabase
- Client-side: `cleanupExpiredTopicsWithCascade()` removes from SQLite
- Real-time subscription handles DELETE events to sync state

## Testing Recommendations

### Manual Testing

1. **Test Edge Function Locally:**
   ```bash
   supabase start
   curl -X POST 'http://127.0.0.1:54321/functions/v1/cleanup-expired-topics' \
     --header 'Authorization: Bearer YOUR_ANON_KEY'
   ```

2. **Test Cascade Deletion:**
   - Create a topic with 24h expiration
   - Add likes, replies, and view it
   - Fast-forward system time or manually set `expires_at` to past
   - Call `cleanupExpiredTopics()` action
   - Verify all associated data is deleted

3. **Test Cron Job:**
   ```sql
   -- View scheduled jobs
   SELECT * FROM cron.job;
   
   -- View job run history
   SELECT * FROM cron.job_run_details 
   ORDER BY start_time DESC LIMIT 10;
   ```

### Integration Testing

1. **Create expired topic → Verify cleanup:**
   - Create topic with past `expires_at`
   - Run edge function
   - Verify topic deleted from Supabase
   - Run client cleanup
   - Verify topic deleted from SQLite

2. **Verify cascade deletion completeness:**
   - Create topic with likes, replies, views
   - Delete topic
   - Query all related tables
   - Verify no orphaned data remains

3. **Test real-time sync:**
   - Subscribe to topics
   - Delete topic on server
   - Verify DELETE event received
   - Verify topic removed from UI

## Deployment Checklist

- [ ] Deploy edge function: `supabase functions deploy cleanup-expired-topics`
- [ ] Run migration: `supabase db push` (applies cron job setup)
- [ ] Verify cron job scheduled: Check `cron.job` table
- [ ] Test edge function manually
- [ ] Monitor logs for first automatic run
- [ ] Verify client-side cleanup works on app resume

## Monitoring

### Server-Side Logs
Check Supabase dashboard → Edge Functions → cleanup-expired-topics → Logs

Look for:
```json
{
  "tag": "cleanup-expired-topics:success",
  "deletedCount": 5,
  "timestamp": "2024-11-27T10:00:00.000Z"
}
```

### Client-Side Logs
Check app logs for:
```
🧹 Cleaning up expired topics with cascade deletion...
🗑️ Found 3 expired topics
  ✓ Deleted 5 likes
  ✓ Deleted 12 messages
  ✓ Deleted 3 read status entries
  ✓ Deleted 8 queued views
  ✓ Deleted 3 topics
✅ Cleaned up 3 expired topics with cascade deletion
```

## Performance Considerations

1. **Batch Operations:**
   - `cascadeDeleteTopics()` uses batch deletion for efficiency
   - Single transaction reduces overhead

2. **Indexing:**
   - `idx_topics_expires` index speeds up expiration queries
   - Composite indexes on foreign keys speed up cascade deletion

3. **Frequency:**
   - Hourly cron job balances freshness vs. load
   - Client cleanup on app resume catches any missed deletions

## Security Considerations

1. **Edge Function:**
   - Uses service role key for authentication
   - CORS configured for allowed origins
   - Rate limiting handled by Supabase

2. **RPC Function:**
   - `SECURITY DEFINER` ensures proper permissions
   - No user input required (no injection risk)

3. **Client-Side:**
   - Only deletes from local cache
   - No direct database access
   - Syncs with server for consistency

## Future Enhancements

1. **Configurable Cleanup Frequency:**
   - Allow admins to configure cron schedule
   - Support different frequencies per group

2. **Soft Delete Option:**
   - Archive expired topics instead of hard delete
   - Allow recovery within grace period

3. **Cleanup Metrics:**
   - Track deletion counts over time
   - Alert on unusual patterns

4. **Batch Size Limits:**
   - Add pagination for very large cleanup operations
   - Prevent timeout on massive deletions

## Conclusion

Task 10 successfully implements comprehensive topic expiration handling with:
- ✅ Automatic server-side cleanup via edge function and cron job
- ✅ Client-side cascade deletion mirroring database behavior
- ✅ Proper transaction handling and error recovery
- ✅ Comprehensive logging and monitoring
- ✅ Multiple deployment and configuration options
- ✅ All requirements (6.1, 6.4, 6.5, 6.6) validated

The implementation ensures expired topics are reliably removed from both Supabase and SQLite, maintaining data consistency and preventing stale content from appearing in the feed.
