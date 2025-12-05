# Requirements Document

## Introduction

This document specifies the requirements for integrating the Topics Page with the Supabase backend and local SQLite persistence layer. The Topics Page displays a feed of user-generated content (text posts, polls, confessions, news, images) where each topic has its own dedicated chat room for discussions. The system must support real-time updates, offline functionality, and seamless synchronization between Supabase and SQLite.

## Glossary

- **Topic**: A user-generated post displayed in the feed that can be of type text, poll, confession, news, or image. Each topic has its own chat room.
- **Topic Feed**: The main view displaying all topics for a group in reverse chronological order.
- **Topic Chat Room**: A dedicated message thread where users can discuss a specific topic.
- **Topic Metadata**: Additional information about a topic including views, likes, replies count, and expiration time.
- **Supabase**: The cloud-based PostgreSQL database and real-time service used as the primary data store.
- **SQLite**: The local on-device database used for offline persistence and fast data access.
- **Supabase Pipeline**: The abstraction layer that manages communication between the application and Supabase.
- **SQLite Service**: The service layer that manages local database operations and synchronization.
- **Ghost Mode**: Anonymous posting mode where the author's identity is hidden and replaced with a pseudonym.
- **Topic Expiration**: The automatic deletion of topics after a specified duration (24 hours, 1 week, etc.).
- **Topic Like**: A user's positive reaction to a topic (distinct from message reactions).
- **Topic View**: A count of how many times a topic has been viewed by users.
- **Root Message**: The parent message that represents the topic itself in the messages table.
- **Thread Message**: A reply message that belongs to a topic's chat room.

## Requirements

### Requirement 1

**User Story:** As a user, I want to view a feed of topics in my group, so that I can see what discussions are happening and participate in them.

#### Acceptance Criteria

1. WHEN a user navigates to the topics page for a group THEN the system SHALL load topics in batches of 20 in reverse chronological order
2. WHEN a user scrolls to the bottom of the feed THEN the system SHALL load the next batch of 20 topics
3. WHEN a new topic is created by any user THEN the system SHALL update the feed in real-time without requiring a page refresh
4. WHEN a topic expires THEN the system SHALL remove it from the feed automatically
5. WHILE the user is offline THEN the system SHALL display cached topics from SQLite with pagination
6. WHEN displaying each topic THEN the system SHALL show the author information, content, timestamp, type tag, views count, likes count, replies count, and unread count

### Requirement 2

**User Story:** As a user, I want to create different types of topics, so that I can share text posts, polls, confessions, news, or images with my group.

#### Acceptance Criteria

1. WHEN a user clicks the create topic button THEN the system SHALL display a modal with options to select topic type and set expiration duration (24 hours, 7 days, or never)
2. WHEN a user creates a text topic THEN the system SHALL create a root message with message_type 'text' and a corresponding topic entry
3. WHEN a user creates a poll topic THEN the system SHALL create a root message with message_type 'poll', a poll entry, and a corresponding topic entry
4. WHEN a user creates a confession topic THEN the system SHALL create an anonymous root message and a corresponding topic entry with is_anonymous set to true
5. WHEN a user creates an image topic THEN the system SHALL upload the image, create a root message with image_url, and a corresponding topic entry
6. WHEN a user selects "24 hours" or "7 days" expiration THEN the system SHALL set the expires_at timestamp accordingly
7. WHEN a user selects "never" expiration THEN the system SHALL set expires_at to null
8. WHEN the user is offline THEN the system SHALL queue the topic creation in the outbox for later synchronization

### Requirement 3

**User Story:** As a user, I want to interact with topics by liking them, so that I can show appreciation for content I find interesting.

#### Acceptance Criteria

1. WHEN a user taps the like button on a topic THEN the system SHALL toggle the like status for that user
2. WHEN a like is added THEN the system SHALL increment the likes_count for that topic
3. WHEN a like is removed THEN the system SHALL decrement the likes_count for that topic
4. WHEN a user likes a topic THEN the system SHALL create an entry in the topic_likes table with a unique constraint on (topic_id, user_id)
5. WHEN displaying a topic THEN the system SHALL indicate whether the current user has liked it
6. WHEN the user is offline THEN the system SHALL queue the like action in the outbox for later synchronization

### Requirement 4

**User Story:** As a user, I want to view and participate in topic-specific chat rooms, so that I can discuss topics with other group members.

#### Acceptance Criteria

1. WHEN a user taps on a topic THEN the system SHALL navigate to the topic's dedicated chat room
2. WHEN displaying a topic chat room THEN the system SHALL show the topic content pinned at the top
3. WHEN displaying messages in a topic chat room THEN the system SHALL filter messages where topic_id matches the current topic
4. WHEN a user sends a message in a topic chat room THEN the system SHALL create a message with the topic_id field set
5. WHEN a new message is added to a topic chat room THEN the system SHALL increment the replies_count for that topic
6. WHEN displaying the topic feed THEN the system SHALL show an unread count badge for topics with unread messages
7. WHEN a user views a topic chat room THEN the system SHALL update the local read status in SQLite immediately
8. WHEN the user comes back online THEN the system SHALL sync the local read status to Supabase in the background

### Requirement 5

**User Story:** As a user, I want topics to be tracked for views, so that I can see how popular each topic is.

#### Acceptance Criteria

1. WHEN a user views a topic by tapping on it THEN the system SHALL increment the views_count for that topic
2. WHEN incrementing views THEN the system SHALL use an atomic database operation to prevent race conditions
3. WHEN displaying a topic in the feed THEN the system SHALL show the current views_count
4. WHEN the user is offline THEN the system SHALL queue the view increment in the outbox for later synchronization

### Requirement 6

**User Story:** As a system administrator, I want topics to expire automatically when configured, so that the feed remains fresh and relevant without manual cleanup.

#### Acceptance Criteria

1. WHEN a topic has expires_at set to a timestamp and that timestamp is reached THEN the system SHALL delete the topic and its associated root message
2. WHEN a topic has expires_at set to null THEN the system SHALL not automatically delete the topic
3. WHEN an admin manually deletes a topic THEN the system SHALL delete the topic regardless of expires_at value
4. WHEN a topic is deleted THEN the system SHALL cascade delete all associated data including thread messages, likes, and poll data
5. WHEN checking for expired topics THEN the system SHALL run a scheduled job at regular intervals
6. WHEN a topic expires THEN the system SHALL remove it from both Supabase and SQLite

### Requirement 7

**User Story:** As a developer, I want topics to synchronize between Supabase and SQLite, so that the application works seamlessly online and offline.

#### Acceptance Criteria

1. WHEN topics are fetched from Supabase THEN the system SHALL cache them in SQLite for offline access
2. WHEN the user is offline THEN the system SHALL load topics from SQLite
3. WHEN the user comes back online THEN the system SHALL synchronize any queued topic operations from the outbox
4. WHEN synchronizing topics THEN the system SHALL update views_count, likes_count, and replies_count from Supabase
5. WHEN a conflict occurs during synchronization THEN the system SHALL use the server state as the source of truth

### Requirement 8

**User Story:** As a user, I want to receive real-time updates for topic metrics, so that I can see live engagement without refreshing.

#### Acceptance Criteria

1. WHEN a topic's likes_count changes THEN the system SHALL update the feed display in real-time
2. WHEN a topic's replies_count changes THEN the system SHALL update the feed display in real-time
3. WHEN a topic's views_count changes THEN the system SHALL update the feed display in real-time
4. WHEN subscribed to a group's topics THEN the system SHALL listen for INSERT events on the topics table
5. WHEN subscribed to a group's topics THEN the system SHALL listen for UPDATE events on the topics table for metric changes

### Requirement 9

**User Story:** As a user, I want to navigate between the topic feed and quick chat, so that I can easily switch between browsing topics and general group conversation.

#### Acceptance Criteria

1. WHEN a user is on the topics page THEN the system SHALL display a "Quick Chat" button
2. WHEN a user taps the "Quick Chat" button THEN the system SHALL navigate to the main group chat
3. WHEN a user is in the main group chat THEN the system SHALL provide a way to navigate back to the topics feed
4. WHEN navigating between views THEN the system SHALL preserve the scroll position and state of each view

### Requirement 10

**User Story:** As a developer, I want topics to reuse existing message infrastructure, so that we maintain consistency and avoid code duplication.

#### Acceptance Criteria

1. WHEN creating a topic THEN the system SHALL create a root message in the messages table
2. WHEN creating topic replies THEN the system SHALL create messages with the topic_id field set
3. WHEN handling topic reactions THEN the system SHALL reuse the existing reactions table and logic
4. WHEN handling poll topics THEN the system SHALL reuse the existing polls and poll_votes tables
5. WHEN synchronizing topics THEN the system SHALL reuse the existing message synchronization pipeline

### Requirement 11

**User Story:** As a developer, I want topic read-state tracking to use local-first architecture, so that we minimize server load and provide instant UI updates.

#### Acceptance Criteria

1. WHEN a user views a topic THEN the system SHALL update the local read status in SQLite immediately without waiting for server confirmation
2. WHEN tracking topic read status THEN the system SHALL store topic_id and last_read_message_id in a local SQLite table
3. WHEN calculating unread counts for topics THEN the system SHALL use the local SQLite read status as the source of truth
4. WHEN the application starts or network reconnects THEN the system SHALL sync local read status to Supabase in the background
5. WHEN syncing read status THEN the system SHALL batch updates to minimize server requests
6. WHEN a read status sync fails THEN the system SHALL retry on the next sync cycle without blocking the UI
