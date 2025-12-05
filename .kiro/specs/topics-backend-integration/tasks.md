# Implementation Plan

- [x] 1. Set up database schema and migrations





  - Create Supabase migration for topics and topic_likes tables
  - Add topic_id column to messages table with foreign key constraint
  - Create indexes for performance (group_id + created_at, expires_at, topic_id)
  - Create SQLite schema for topics_cache, topic_likes_cache, topic_read_status, topic_views_queue tables
  - _Requirements: 1.1, 2.2, 2.3, 2.4, 2.5, 4.4, 11.2_

- [x] 2. Implement Supabase RPC functions





  - [x] 2.1 Create increment_topic_view RPC function for atomic view counting

    - _Requirements: 5.1, 5.2_
  

  - [x] 2.2 Create toggle_topic_like RPC function for like/unlike operations

    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [x] 2.3 Create get_topics_paginated RPC function with user-specific data

    - Include pagination parameters (limit, offset)
    - Join with messages, users, user_pseudonyms tables
    - Calculate is_liked_by_user flag
    - Filter out expired topics
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 3.5_
  


  - [x] 2.4 Create delete_expired_topics RPC function for cleanup job

    - _Requirements: 6.1, 6.4_



- [x] 3. Set up Row Level Security (RLS) policies



  - Create RLS policy for reading topics (users can read topics in groups they're members of)
  - Create RLS policy for creating topics (users can create topics in groups they're members of)
  - Create RLS policy for topic_likes (users can manage their own likes)
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1_

- [x] 4. Implement SQLite service methods for topics





  - [x] 4.1 Create methods for topics_cache table operations


    - saveTopicToCache(topic)
    - getTopicsFromCache(groupId, limit, offset)
    - updateTopicMetrics(topicId, metrics)
    - deleteTopicFromCache(topicId)
    - _Requirements: 1.5, 7.1, 7.4_
  
  - [x] 4.2 Create methods for topic_likes_cache table operations

    - saveTopicLike(topicId, userId)
    - deleteTopicLike(topicId, userId)
    - isTopicLikedByUser(topicId, userId)
    - _Requirements: 3.1, 3.5_
  
  - [x] 4.3 Create methods for topic_read_status table operations

    - updateTopicReadStatus(topicId, groupId, userId, lastReadMessageId, lastReadAt)
    - getTopicReadStatus(topicId, userId)
    - getAllTopicReadStatuses(userId, groupId)
    - _Requirements: 4.7, 11.2, 11.3_
  
  - [x] 4.4 Create methods for topic_views_queue table operations

    - queueTopicView(topicId, userId)
    - getUnsynced ViewsQueue()
    - markViewsAsSynced(ids)
    - _Requirements: 5.4_
  
  - [x] 4.5 Create method for calculating topic unread counts

    - calculateTopicUnreadCount(topicId, userId)
    - Use local read status as source of truth
    - Count messages after last_read_at timestamp
    - _Requirements: 4.6, 11.3_

- [x] 5. Create TypeScript interfaces and types





  - Define Topic interface with all required fields
  - Define TopicLike interface
  - Define TopicReadStatus interface
  - Define CreateTopicInput interface
  - Add topic-related state to ChatState interface
  - _Requirements: 1.6, 2.1_

- [x] 6. Implement topic store actions






  - [x] 6.1 Implement fetchTopics action with pagination

    - Load from SQLite cache first (instant display)
    - Fetch from Supabase with pagination parameters
    - Merge and deduplicate by ID
    - Update SQLite cache
    - Handle offline mode (SQLite only)
    - _Requirements: 1.1, 1.2, 1.5, 7.1_
  
  - [ ]* 6.2 Write property test for fetchTopics pagination
    - **Property 1: Pagination batch size consistency**
    - **Property 2: Pagination continuation without duplicates**
    - **Validates: Requirements 1.1, 1.2**
  
  - [x] 6.3 Implement createTopic action for all topic types

    - Generate client-side UUID and dedupe_key
    - Handle text, poll, confession, news, image types
    - Calculate expires_at based on duration ('24h', '7d', 'never')
    - Insert to SQLite immediately (optimistic)
    - Queue in outbox if offline
    - Insert to Supabase (message + topic + poll if applicable)
    - Handle anonymity for confessions
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  
  - [ ]* 6.4 Write property test for createTopic data integrity
    - **Property 6: Topic creation data integrity**
    - **Property 7: Expiration timestamp calculation**
    - **Property 8: Never-expiring topics**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 10.1**
  
  - [x] 6.5 Implement toggleTopicLike action

    - Update SQLite immediately (optimistic)
    - Update UI state instantly
    - Queue in outbox if offline
    - Call toggle_topic_like RPC
    - Handle errors with rollback
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  
  - [ ]* 6.6 Write property test for toggleTopicLike
    - **Property 10: Like toggle idempotence**
    - **Property 11: Like count accuracy**
    - **Property 12: Like uniqueness constraint**
    - **Property 13: User like status accuracy**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  
  - [x] 6.7 Implement incrementTopicView action

    - Update SQLite immediately
    - Queue in outbox if offline
    - Call increment_topic_view RPC
    - Use atomic operation to prevent race conditions
    - _Requirements: 5.1, 5.2, 5.4_
  
  - [ ]* 6.8 Write property test for incrementTopicView
    - **Property 19: View count increment**
    - **Property 20: Atomic view increment**
    - **Validates: Requirements 5.1, 5.2**
  
  - [x] 6.9 Implement markTopicAsRead action (local-first)

    - Update SQLite read status immediately
    - Update UI unread count instantly
    - Queue sync to Supabase in background
    - Don't wait for server confirmation
    - _Requirements: 4.7, 4.8, 11.1, 11.2_
  
  - [ ]* 6.10 Write property test for markTopicAsRead
    - **Property 18: Local-first read status update**
    - **Property 27: Read status local storage**
    - **Validates: Requirements 4.7, 11.2**
  
  - [x] 6.11 Implement getTopicUnreadCount action

    - Calculate from SQLite read status
    - Count messages after last_read_at
    - Don't query server
    - _Requirements: 4.6, 11.3_
  
  - [ ]* 6.12 Write property test for getTopicUnreadCount
    - **Property 17: Unread count calculation**
    - **Property 28: Local-first unread calculation**
    - **Validates: Requirements 4.6, 11.3**
  
  - [x] 6.13 Implement subscribeToTopics action

    - Subscribe to INSERT events on topics table for group
    - Subscribe to UPDATE events for metric changes
    - Handle new topics in real-time
    - Update UI without refresh
    - _Requirements: 1.3, 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [x] 6.14 Implement syncTopicsToServer action

    - Process outbox queue for topics
    - Sync likes, views, read status
    - Batch operations to minimize requests
    - Handle conflicts (server wins)
    - Update local cache with server state
    - _Requirements: 7.3, 7.4, 7.5_
  
  - [ ]* 6.15 Write property test for syncTopicsToServer
    - **Property 25: Sync count consistency**
    - **Property 26: Server-wins conflict resolution**
    - **Validates: Requirements 7.4, 7.5**

- [x] 7. Implement topic message filtering and replies







  - [x] 7.1 Update sendMessage action to support topic_id


    - Add topic_id parameter to sendMessage
    - Set topic_id field when sending in topic chat
    - Increment replies_count for topic
    - _Requirements: 4.4, 4.5_
  
  - [ ]* 7.2 Write property test for topic message association
    - **Property 15: Topic reply association**
    - **Property 16: Replies count accuracy**
    - **Validates: Requirements 4.4, 4.5**
  
  - [x] 7.3 Create getTopicMessages action



    - Filter messages where topic_id matches
    - Load from SQLite first
    - Fetch from Supabase if needed
    - _Requirements: 4.3_
  
  - [ ]* 7.4 Write property test for getTopicMessages
    - **Property 14: Topic message filtering**
    - **Validates: Requirements 4.3**

- [x] 8. Create UI components for topics





  - [x] 8.1 Update GroupTopicsPage component


    - Connect to store (replace MOCK_TOPICS)
    - Implement infinite scroll pagination
    - Display real topic data
    - Handle loading states
    - Show unread count badges
    - Handle like button clicks
    - Navigate to topic chat on click
    - _Requirements: 1.1, 1.2, 1.6, 3.1, 4.1, 4.6_
  
  - [x] 8.2 Create CreateTopicModal component


    - Form to select topic type (text, poll, confession, news, image)
    - Input for content/question
    - Poll options input (for poll type)
    - Image upload (for image type)
    - Expiration duration selector (24h, 7d, never)
    - Submit button to call createTopic action
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  

  - [x] 8.3 Create TopicChatArea component

    - Display topic content pinned at top
    - Show topic metadata (author, timestamp, type)
    - Filter messages for current topic
    - Reuse existing ChatArea message display
    - Update read status on view
    - _Requirements: 4.1, 4.2, 4.3, 4.7_
  
  - [x] 8.4 Add topic navigation to routing


    - Add route for /groups/:groupId/topics
    - Add route for /groups/:groupId/topics/:topicId
    - Handle navigation between topics feed and chat
    - Preserve scroll position
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 9. Implement offline support and synchronization


  - [x] 9.1 Update outbox processor to handle topic operations


    - Process queued topic creations
    - Process queued likes
    - Process queued views
    - Process queued read status updates
    - Batch operations for efficiency
    - _Requirements: 2.8, 3.6, 5.4, 11.4_
  
  - [ ]* 9.2 Write property test for offline queueing
    - **Property 9: Offline operation queueing**
    - **Validates: Requirements 2.8, 3.6, 5.4**
  
  - [x] 9.3 Implement cache invalidation on real-time updates



    - Update SQLite when new topic arrives
    - Update metrics when likes/views change
    - Remove expired topics from cache
    - _Requirements: 1.3, 1.4, 6.6, 7.1_
  
  - [ ]* 9.4 Write property test for cache consistency
    - **Property 24: Topic caching on fetch**
    - **Property 23: Dual-database expiration consistency**
    - **Validates: Requirements 7.1, 6.6**

- [x] 10. Implement topic expiration handling





  - [x] 10.1 Create Supabase Edge Function for expiration cleanup


    - Call delete_expired_topics RPC
    - Schedule to run hourly via cron
    - Log deleted topic count
    - _Requirements: 6.1, 6.5_
  
  - [x] 10.2 Handle cascade deletion in SQLite


    - Delete topic from topics_cache
    - Delete associated likes from topic_likes_cache
    - Delete associated messages with topic_id
    - Delete read status from topic_read_status
    - _Requirements: 6.4, 6.6_
  
  - [ ]* 10.3 Write property test for expiration and deletion
    - **Property 3: Expired topics exclusion**
    - **Property 21: Never-expiring topic persistence**
    - **Property 22: Cascade deletion completeness**
    - **Validates: Requirements 1.4, 6.1, 6.2, 6.4**

- [x] 11. Add error handling and validation





  - [x] 11.1 Implement network error handling


    - Detect offline state
    - Queue operations in outbox
    - Display offline indicator
    - Retry with exponential backoff
    - Handle timeouts with fallback to cache
    - _Requirements: 2.8, 3.6, 5.4_
  
  - [x] 11.2 Implement data validation

    - Validate required fields (content, type, group_id)
    - Validate expiration duration
    - Validate poll options (2-10 items)
    - Sanitize user input
    - Return user-friendly error messages
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [x] 11.3 Implement sync error handling

    - Handle conflicts (server wins)
    - Continue processing on partial failures
    - Mark failed items for retry
    - Don't block UI on failures
    - _Requirements: 7.3, 7.4, 7.5_

- [ ]* 12. Write integration tests for end-to-end flows
  - Test create topic → view in feed → like → reply → mark as read
  - Test create topic offline → come online → verify sync
  - Test pagination: load page 1 → load page 2 → verify no duplicates
  - Test expiration: create topic with 24h expiry → fast-forward time → verify deletion
  - Test real-time: subscribe → create topic in another client → verify update
  - _Requirements: All_

- [x] 13. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Performance optimization and monitoring



  - [x] 14.1 Implement caching strategy


    - Cache topic feed in Zustand state
    - Cache in SQLite for offline
    - Invalidate cache on real-time updates
    - Limit cached pages to last 5 pages (100 topics)
    - _Requirements: 1.5, 7.1_
  
  - [x] 14.2 Implement lazy loading and prefetching


    - Load topic details on demand
    - Prefetch next page at 80% scroll
    - Batch view increments (every 5 seconds)
    - Batch read status syncs (on app background)
    - _Requirements: 1.2, 5.1, 11.4_
  
  - [x] 14.3 Add logging and metrics


    - Log all topic operations
    - Log sync operations
    - Track performance metrics
    - Monitor error rates
    - _Requirements: All_

- [x] 15. Final checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
