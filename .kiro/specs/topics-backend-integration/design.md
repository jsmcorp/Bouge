# Design Document

## Overview

The Topics Page Backend Integration connects the existing Topics UI to a dual-persistence architecture using Supabase (cloud) and SQLite (local). The design leverages the existing message infrastructure while adding a specialized `topics` metadata layer for feed-specific features like views, likes, expiration, and pagination.

The system follows a local-first architecture where UI updates happen immediately against SQLite, with background synchronization to Supabase. This ensures instant responsiveness while maintaining data consistency across devices.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Topics Page UI                          │
│  (GroupTopicsPage.tsx, TopicChatArea.tsx, CreateTopicModal) │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chat Store (Zustand)                      │
│              (topicActions + existing actions)               │
└────────┬────────────────────────────────┬───────────────────┘
         │                                │
         ▼                                ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│  Supabase Pipeline   │      │     SQLite Service           │
│  (Cloud Database)    │◄────►│  (Local Database)            │
│  - topics table      │      │  - topics_cache              │
│  - topic_likes       │      │  - topic_read_status         │
│  - messages (topic)  │      │  - messages (topic_id)       │
└──────────────────────┘      └──────────────────────────────┘
         │                                │
         ▼                                ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│  Real-time Updates   │      │     Outbox Queue             │
│  (Supabase Channels) │      │  (Offline Operations)        │
└──────────────────────┘      └──────────────────────────────┘
```

### Data Flow

**Topic Creation Flow:**
1. User creates topic → Store action
2. Generate client-side UUID and dedupe_key
3. Insert to SQLite immediately (optimistic)
4. Queue in outbox if offline
5. Insert to Supabase (message + topic + poll if applicable)
6. Real-time broadcast to other clients
7. Update SQLite with server confirmation

**Topic Feed Load Flow:**
1. User opens topics page → fetchTopics(groupId, page)
2. Load from SQLite (instant display)
3. Fetch from Supabase with pagination (offset/limit)
4. Merge and deduplicate by ID
5. Update SQLite cache
6. Subscribe to real-time updates

**Topic View Flow (Local-First):**
1. User taps topic → Navigate to chat
2. Update SQLite read status immediately
3. Update UI unread count instantly
4. Queue view increment in outbox
5. Background: Sync to Supabase
6. Background: Increment views_count via RPC

## Components and Interfaces

### Database Schema Changes

#### Supabase Tables

**topics table:**
```sql
CREATE TABLE topics (
  id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'poll', 'confession', 'news', 'image')),
  title TEXT,
  expires_at TIMESTAMPTZ, -- NULL means never expires
  views_count BIGINT DEFAULT 0,
  likes_count BIGINT DEFAULT 0,
  replies_count BIGINT DEFAULT 0,
  is_anonymous BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX idx_topics_group_created ON topics(group_id, created_at DESC);
CREATE INDEX idx_topics_expires ON topics(expires_at) WHERE expires_at IS NOT NULL;
```

**topic_likes table:**
```sql
CREATE TABLE topic_likes (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (topic_id, user_id)
);

CREATE INDEX idx_topic_likes_user ON topic_likes(user_id);
```

**messages table update:**
```sql
ALTER TABLE messages ADD COLUMN topic_id UUID REFERENCES topics(id) ON DELETE CASCADE;
CREATE INDEX idx_messages_topic ON messages(topic_id, created_at DESC);
```

#### SQLite Tables

**topics_cache table:**
```sql
CREATE TABLE IF NOT EXISTS topics_cache (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  author_avatar TEXT,
  pseudonym TEXT,
  expires_at INTEGER, -- Unix timestamp, NULL means never
  views_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  is_anonymous INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  synced_at INTEGER,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topics_cache_group_created 
  ON topics_cache(group_id, created_at DESC);
```

**topic_likes_cache table:**
```sql
CREATE TABLE IF NOT EXISTS topic_likes_cache (
  topic_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  synced INTEGER DEFAULT 0,
  PRIMARY KEY (topic_id, user_id)
);
```

**topic_read_status table:**
```sql
CREATE TABLE IF NOT EXISTS topic_read_status (
  topic_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_message_id TEXT,
  last_read_at INTEGER NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_topic_read_status_user_group 
  ON topic_read_status(user_id, group_id);
```

**topic_views_queue table:**
```sql
CREATE TABLE IF NOT EXISTS topic_views_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  synced INTEGER DEFAULT 0
);
```

### TypeScript Interfaces

```typescript
export interface Topic {
  id: string;
  group_id: string;
  message_id: string;
  type: 'text' | 'poll' | 'confession' | 'news' | 'image';
  title?: string;
  content: string;
  author?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
  pseudonym?: string;
  expires_at: number | null; // Unix timestamp, null = never expires
  views_count: number;
  likes_count: number;
  replies_count: number;
  unread_count: number;
  is_anonymous: boolean;
  is_liked_by_user: boolean;
  created_at: number;
  poll?: Poll;
  image_url?: string;
}

export interface TopicLike {
  topic_id: string;
  user_id: string;
  created_at: number;
}

export interface TopicReadStatus {
  topic_id: string;
  group_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: number;
  synced: boolean;
}

export interface CreateTopicInput {
  group_id: string;
  type: 'text' | 'poll' | 'confession' | 'news' | 'image';
  title?: string;
  content: string;
  expires_in: '24h' | '7d' | 'never';
  is_anonymous?: boolean;
  poll_options?: string[];
  image_file?: File;
}
```

### Store Actions

```typescript
export interface TopicActions {
  // Fetch topics with pagination
  fetchTopics: (groupId: string, page: number) => Promise<void>;
  
  // Create a new topic
  createTopic: (input: CreateTopicInput) => Promise<Topic>;
  
  // Like/unlike a topic
  toggleTopicLike: (topicId: string) => Promise<void>;
  
  // Increment view count
  incrementTopicView: (topicId: string) => Promise<void>;
  
  // Mark topic as read (local-first)
  markTopicAsRead: (topicId: string, lastMessageId: string) => Promise<void>;
  
  // Get unread count for a topic
  getTopicUnreadCount: (topicId: string) => Promise<number>;
  
  // Subscribe to topic updates
  subscribeToTopics: (groupId: string) => void;
  
  // Unsubscribe from topic updates
  unsubscribeFromTopics: () => void;
  
  // Sync local changes to server
  syncTopicsToServer: () => Promise<void>;
}
```

### Supabase RPC Functions

```sql
-- Increment topic view count atomically
CREATE OR REPLACE FUNCTION increment_topic_view(p_topic_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE topics
  SET views_count = views_count + 1
  WHERE id = p_topic_id;
END;
$$;

-- Toggle topic like
CREATE OR REPLACE FUNCTION toggle_topic_like(p_topic_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_liked BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  
  -- Check if already liked
  SELECT EXISTS(
    SELECT 1 FROM topic_likes
    WHERE topic_id = p_topic_id AND user_id = v_user_id
  ) INTO v_liked;
  
  IF v_liked THEN
    -- Unlike
    DELETE FROM topic_likes
    WHERE topic_id = p_topic_id AND user_id = v_user_id;
    
    UPDATE topics
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = p_topic_id;
    
    RETURN FALSE;
  ELSE
    -- Like
    INSERT INTO topic_likes (topic_id, user_id)
    VALUES (p_topic_id, v_user_id)
    ON CONFLICT DO NOTHING;
    
    UPDATE topics
    SET likes_count = likes_count + 1
    WHERE id = p_topic_id;
    
    RETURN TRUE;
  END IF;
END;
$$;

-- Get topics with pagination and user-specific data
CREATE OR REPLACE FUNCTION get_topics_paginated(
  p_group_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  group_id UUID,
  type TEXT,
  title TEXT,
  content TEXT,
  author_id UUID,
  author_name TEXT,
  author_avatar TEXT,
  pseudonym TEXT,
  expires_at TIMESTAMPTZ,
  views_count BIGINT,
  likes_count BIGINT,
  replies_count BIGINT,
  is_anonymous BOOLEAN,
  is_liked_by_user BOOLEAN,
  created_at TIMESTAMPTZ,
  message_type TEXT,
  image_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  RETURN QUERY
  SELECT 
    t.id,
    t.group_id,
    t.type,
    t.title,
    m.content,
    CASE WHEN t.is_anonymous THEN NULL ELSE m.user_id END as author_id,
    CASE WHEN t.is_anonymous THEN NULL ELSE u.display_name END as author_name,
    CASE WHEN t.is_anonymous THEN NULL ELSE u.avatar_url END as author_avatar,
    CASE WHEN t.is_anonymous THEN up.pseudonym ELSE NULL END as pseudonym,
    t.expires_at,
    t.views_count,
    t.likes_count,
    t.replies_count,
    t.is_anonymous,
    EXISTS(
      SELECT 1 FROM topic_likes tl
      WHERE tl.topic_id = t.id AND tl.user_id = v_user_id
    ) as is_liked_by_user,
    t.created_at,
    m.message_type,
    m.image_url
  FROM topics t
  INNER JOIN messages m ON t.id = m.id
  LEFT JOIN users u ON m.user_id = u.id
  LEFT JOIN user_pseudonyms up ON up.group_id = t.group_id AND up.user_id = m.user_id
  WHERE t.group_id = p_group_id
    AND (t.expires_at IS NULL OR t.expires_at > NOW())
  ORDER BY t.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Delete expired topics (called by cron job)
CREATE OR REPLACE FUNCTION delete_expired_topics()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete messages (cascade will handle topics and related data)
  WITH deleted AS (
    DELETE FROM messages
    WHERE id IN (
      SELECT id FROM topics
      WHERE expires_at IS NOT NULL AND expires_at <= NOW()
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
END;
$$;
```

## Data Models

### Topic Lifecycle

1. **Creation**: User creates topic → Message + Topic + (Poll if applicable) created atomically
2. **Active**: Topic displayed in feed, users can view, like, and reply
3. **Expiration**: If expires_at is set and reached, topic is deleted via cron job
4. **Manual Deletion**: Admin can delete topic anytime, triggering cascade delete

### Pagination Strategy

- **Page Size**: 20 topics per page
- **Initial Load**: Fetch page 0 (most recent 20)
- **Infinite Scroll**: Load next page when user scrolls to bottom
- **Cache Strategy**: Store all loaded pages in SQLite
- **Deduplication**: Use topic ID as unique key

### Unread Count Calculation

```typescript
// Local-first calculation
function calculateTopicUnreadCount(topicId: string, userId: string): number {
  // Get last read status from SQLite
  const readStatus = sqliteService.getTopicReadStatus(topicId, userId);
  
  if (!readStatus || !readStatus.last_read_message_id) {
    // Never read - count all messages
    return sqliteService.countTopicMessages(topicId);
  }
  
  // Count messages after last read
  return sqliteService.countTopicMessagesAfter(
    topicId,
    readStatus.last_read_at
  );
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property Reflection

After analyzing all acceptance criteria, I've identified several areas where properties can be consolidated:

- Properties 3.2 and 3.3 (like increment/decrement) can be combined into a single property about like count accuracy
- Properties related to offline queueing (2.8, 3.6, 5.4) follow the same pattern and can be generalized
- Topic creation properties (2.2, 2.3, 2.4, 2.5) all test data integrity and can be grouped
- Expiration properties (6.1, 6.2) test opposite cases of the same behavior

The consolidated properties below eliminate redundancy while maintaining comprehensive coverage.

### Correctness Properties

**Property 1: Pagination batch size consistency**
*For any* group with topics, fetching a page should return at most 20 topics in reverse chronological order (newest first)
**Validates: Requirements 1.1**

**Property 2: Pagination continuation without duplicates**
*For any* group with more than 20 topics, loading consecutive pages should return different topics with no duplicates across pages
**Validates: Requirements 1.2**

**Property 3: Expired topics exclusion**
*For any* topic with expires_at set to a past timestamp, that topic should not appear in feed queries
**Validates: Requirements 1.4, 6.1**

**Property 4: Offline pagination from cache**
*For any* cached topics in SQLite, fetching topics while offline should return paginated results matching the same order as online queries
**Validates: Requirements 1.5**

**Property 5: Topic data completeness**
*For any* topic returned in the feed, all required fields (author info, content, timestamp, type, views_count, likes_count, replies_count, unread_count) should be present and non-null
**Validates: Requirements 1.6**

**Property 6: Topic creation data integrity**
*For any* topic creation (text, poll, confession, image), the system should create both a root message and a topic entry with matching IDs and correct type-specific fields
**Validates: Requirements 2.2, 2.3, 2.4, 2.5, 10.1**

**Property 7: Expiration timestamp calculation**
*For any* topic created with "24 hours" or "7 days" expiration, the expires_at timestamp should equal created_at plus the specified duration
**Validates: Requirements 2.6**

**Property 8: Never-expiring topics**
*For any* topic created with "never" expiration, the expires_at field should be null
**Validates: Requirements 2.7**

**Property 9: Offline operation queueing**
*For any* operation (create topic, like, view) performed while offline, an entry should be created in the outbox queue
**Validates: Requirements 2.8, 3.6, 5.4**

**Property 10: Like toggle idempotence**
*For any* topic and user, liking a topic twice should result in the topic being liked (first like) then unliked (second like), returning to the original state
**Validates: Requirements 3.1**

**Property 11: Like count accuracy**
*For any* topic, the likes_count should equal the number of rows in topic_likes for that topic_id
**Validates: Requirements 3.2, 3.3**

**Property 12: Like uniqueness constraint**
*For any* topic and user, attempting to create duplicate like entries should be prevented by the unique constraint on (topic_id, user_id)
**Validates: Requirements 3.4**

**Property 13: User like status accuracy**
*For any* topic and user, the is_liked_by_user flag should be true if and only if a row exists in topic_likes for that (topic_id, user_id) pair
**Validates: Requirements 3.5**

**Property 14: Topic message filtering**
*For any* topic, querying messages for that topic should return only messages where topic_id matches the topic's ID
**Validates: Requirements 4.3**

**Property 15: Topic reply association**
*For any* message sent in a topic chat room, the message should have its topic_id field set to the topic's ID
**Validates: Requirements 4.4**

**Property 16: Replies count accuracy**
*For any* topic, the replies_count should equal the number of messages with that topic_id
**Validates: Requirements 4.5**

**Property 17: Unread count calculation**
*For any* topic and user, the unread_count should equal the number of messages in that topic created after the user's last_read_at timestamp
**Validates: Requirements 4.6**

**Property 18: Local-first read status update**
*For any* topic view action, the read status should be updated in SQLite before any network request is made
**Validates: Requirements 4.7**

**Property 19: View count increment**
*For any* topic view action, the views_count should increase by exactly 1
**Validates: Requirements 5.1**

**Property 20: Atomic view increment**
*For any* topic, concurrent view increments should not result in lost updates (all increments should be counted)
**Validates: Requirements 5.2**

**Property 21: Never-expiring topic persistence**
*For any* topic with expires_at set to null, the topic should remain in the database regardless of how much time has passed since creation
**Validates: Requirements 6.2**

**Property 22: Cascade deletion completeness**
*For any* deleted topic, all associated data (thread messages, likes, poll data) should also be deleted
**Validates: Requirements 6.4**

**Property 23: Dual-database expiration consistency**
*For any* expired topic, the topic should be absent from both Supabase and SQLite
**Validates: Requirements 6.6**

**Property 24: Topic caching on fetch**
*For any* topic fetched from Supabase, an equivalent entry should exist in the SQLite topics_cache table
**Validates: Requirements 7.1**

**Property 25: Sync count consistency**
*For any* topic, after synchronization completes, the local counts (views, likes, replies) should match the server counts
**Validates: Requirements 7.4**

**Property 26: Server-wins conflict resolution**
*For any* topic with conflicting data between local and server, the synchronized result should match the server state
**Validates: Requirements 7.5**

**Property 27: Read status local storage**
*For any* topic view action, the topic_id and last_read_message_id should be stored in the SQLite topic_read_status table
**Validates: Requirements 11.2**

**Property 28: Local-first unread calculation**
*For any* topic unread count calculation, the result should be derived from SQLite topic_read_status, not from server data
**Validates: Requirements 11.3**

## Error Handling

### Network Errors

**Offline Detection:**
- Monitor network connectivity using Capacitor Network plugin
- Automatically queue operations in outbox when offline
- Display offline indicator in UI

**Retry Strategy:**
- Exponential backoff for failed requests (1s, 2s, 4s, 8s, max 30s)
- Maximum 5 retry attempts before marking as failed
- Failed operations remain in outbox for manual retry

**Timeout Handling:**
- Set 10-second timeout for topic fetch operations
- Set 5-second timeout for like/view operations
- Fall back to cached data on timeout

### Data Validation Errors

**Invalid Topic Data:**
- Validate required fields before creation (content, type, group_id)
- Validate expiration duration is one of: '24h', '7d', 'never'
- Validate poll options array has 2-10 items for poll topics
- Return user-friendly error messages

**Constraint Violations:**
- Handle duplicate like attempts gracefully (idempotent)
- Handle missing foreign keys (group, user, message)
- Log constraint violations for debugging

### Synchronization Errors

**Conflict Resolution:**
- Server state always wins for metric counts
- Use last-write-wins for read status
- Log conflicts for monitoring

**Partial Sync Failures:**
- Continue processing remaining items if one fails
- Mark failed items for retry
- Don't block UI on sync failures

### Database Errors

**SQLite Errors:**
- Handle database locked errors with retry
- Handle disk full errors with user notification
- Gracefully degrade to memory-only mode if SQLite fails

**Supabase Errors:**
- Handle RLS policy violations
- Handle rate limiting with backoff
- Handle connection timeouts

## Testing Strategy

### Unit Testing

**Topic Actions:**
- Test createTopic with all topic types
- Test toggleTopicLike idempotence
- Test incrementTopicView atomicity
- Test markTopicAsRead local-first behavior
- Test pagination logic (offset/limit calculation)

**Data Transformation:**
- Test Supabase to SQLite mapping
- Test SQLite to UI model mapping
- Test timestamp conversions (ISO to Unix)
- Test null handling for optional fields

**Error Handling:**
- Test offline queueing
- Test retry logic
- Test timeout handling
- Test validation errors

### Property-Based Testing

The model will use **fast-check** (TypeScript property-based testing library) for implementing correctness properties. Each property-based test will run a minimum of 100 iterations to ensure thorough coverage.

**Property Test Implementation:**
- Each correctness property listed above will be implemented as a separate property-based test
- Tests will be tagged with comments referencing the design document property number
- Tag format: `// Feature: topics-backend-integration, Property X: [property text]`
- Generators will create realistic test data (valid UUIDs, timestamps, topic types, etc.)

**Test Data Generators:**
```typescript
// Generate random topics
const topicArbitrary = fc.record({
  id: fc.uuid(),
  group_id: fc.uuid(),
  type: fc.constantFrom('text', 'poll', 'confession', 'news', 'image'),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  expires_at: fc.option(fc.date(), { nil: null }),
  is_anonymous: fc.boolean(),
});

// Generate random users
const userArbitrary = fc.record({
  id: fc.uuid(),
  display_name: fc.string({ minLength: 1, maxLength: 50 }),
});

// Generate random messages
const messageArbitrary = fc.record({
  id: fc.uuid(),
  topic_id: fc.option(fc.uuid(), { nil: null }),
  content: fc.string({ minLength: 1, maxLength: 1000 }),
  created_at: fc.date(),
});
```

### Integration Testing

**End-to-End Flows:**
- Create topic → View in feed → Like → Reply → Mark as read
- Create topic offline → Come online → Verify sync
- Pagination: Load page 1 → Load page 2 → Verify no duplicates
- Expiration: Create topic with 24h expiry → Fast-forward time → Verify deletion

**Real-time Testing:**
- Subscribe to topics → Create topic in another client → Verify update
- Subscribe to topics → Like topic in another client → Verify count update

**Offline/Online Transitions:**
- Go offline → Create topic → Go online → Verify sync
- Go offline → Like topic → Go online → Verify sync
- Go offline → View topic → Go online → Verify read status sync

### Performance Testing

**Load Testing:**
- Test pagination with 1000+ topics
- Test concurrent likes on same topic
- Test concurrent view increments
- Test bulk sync of 100+ queued operations

**Memory Testing:**
- Monitor memory usage with large topic feeds
- Test SQLite cache size limits
- Test cleanup of old cached data

## Implementation Notes

### Migration Strategy

1. **Database Migration:**
   - Create Supabase migration for topics, topic_likes tables
   - Add topic_id column to messages table
   - Create RPC functions
   - Set up RLS policies

2. **SQLite Schema:**
   - Add topics_cache, topic_likes_cache, topic_read_status tables
   - Create indexes for performance
   - Implement migration in sqliteService

3. **Store Integration:**
   - Create topicActions.ts in chatstore_refactored
   - Add topic state to ChatState interface
   - Integrate with existing message actions

4. **UI Updates:**
   - Update GroupTopicsPage to use real data
   - Create CreateTopicModal component
   - Create TopicChatArea component
   - Add topic navigation to routing

### Performance Optimizations

**Caching Strategy:**
- Cache topic feed in memory (Zustand state)
- Cache in SQLite for offline access
- Invalidate cache on real-time updates

**Lazy Loading:**
- Load topic details (poll data, author info) on demand
- Prefetch next page when user scrolls to 80% of current page
- Limit cached pages to last 5 pages (100 topics)

**Batch Operations:**
- Batch view increments (send every 5 seconds)
- Batch read status syncs (send on app background)
- Batch outbox processing (process every 10 seconds when online)

### Security Considerations

**Row Level Security (RLS):**
```sql
-- Topics: Users can read topics in groups they're members of
CREATE POLICY "Users can read group topics"
  ON topics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = topics.group_id
      AND user_id = auth.uid()
    )
  );

-- Topics: Users can create topics in groups they're members of
CREATE POLICY "Users can create group topics"
  ON topics FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = topics.group_id
      AND user_id = auth.uid()
    )
  );

-- Topic Likes: Users can manage their own likes
CREATE POLICY "Users can manage own likes"
  ON topic_likes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

**Data Validation:**
- Validate topic type is in allowed list
- Validate expiration duration is valid
- Sanitize user input (content, title)
- Validate image uploads (size, type)

**Rate Limiting:**
- Limit topic creation to 10 per hour per user
- Limit like toggles to 100 per minute per user
- Implement on Supabase Edge Functions

### Monitoring and Observability

**Metrics to Track:**
- Topic creation rate
- Like/view rates
- Pagination performance (load time per page)
- Sync queue size
- Sync failure rate
- Cache hit rate

**Logging:**
- Log all topic operations with user_id, topic_id, timestamp
- Log sync operations (success/failure)
- Log offline queue operations
- Log performance metrics (query times)

**Error Tracking:**
- Track sync failures by error type
- Track validation errors
- Track network errors
- Alert on high error rates
