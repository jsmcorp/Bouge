# Requirements Document

## Introduction

This feature enables users to create new topics within a group. Topics are the primary content units in the app, allowing users to start discussions, share news, or create polls. The implementation must work with the existing Supabase schema without any database modifications.

## Glossary

- **Topic**: A discussion thread within a group containing a title, type, and associated messages
- **Topic_Creator**: The user who creates a topic
- **Group**: The container for topics and members
- **Anonymous_Mode**: When enabled, the topic creator's identity is hidden

## Supabase Schema Reference

**topics table:**
- id (uuid, PK)
- group_id (uuid, FK to groups)
- type (text) - e.g., 'discussion', 'news', 'poll'
- title (text, nullable)
- expires_at (timestamp, nullable)
- views_count (bigint, default 0)
- likes_count (bigint, default 0)
- replies_count (bigint, default 0)
- is_anonymous (boolean, default false)
- created_at (timestamp)

**messages table (linked via topic_id):**
- id (uuid, PK)
- group_id (uuid, FK)
- user_id (uuid, FK)
- content (text)
- is_ghost (boolean)
- message_type (text)
- topic_id (uuid, FK to topics)
- created_at (timestamp)

**topic_likes table:**
- topic_id (uuid, FK)
- user_id (uuid, FK)
- created_at (timestamp)

## Requirements

### Requirement 1: Open Topic Creation Modal

**User Story:** As a group member, I want to tap the + button on the topics page, so that I can create a new topic.

#### Acceptance Criteria

1. WHEN a user taps the + FAB button on GroupTopicsPage, THE System SHALL display a full-screen modal for topic creation
2. THE Modal SHALL slide up from the bottom with smooth animation on iOS
3. THE Modal SHALL include a close button in the header to dismiss without saving

### Requirement 2: Topic Type Selection

**User Story:** As a user, I want to select the type of topic I'm creating, so that it's categorized correctly.

#### Acceptance Criteria

1. THE System SHALL display three topic type options: Discussion, News, Poll
2. WHEN a user selects a topic type, THE System SHALL visually highlight the selected option
3. THE System SHALL default to 'discussion' type if no selection is made

### Requirement 3: Topic Content Input

**User Story:** As a user, I want to enter a title and content for my topic, so that others understand what I'm sharing.

#### Acceptance Criteria

1. THE System SHALL provide a title input field (optional, max 100 characters)
2. THE System SHALL provide a content textarea (required, max 1000 characters)
3. WHEN content is empty, THE System SHALL disable the post button
4. THE System SHALL show character count for content field

### Requirement 4: Anonymous Posting Toggle

**User Story:** As a user, I want to post anonymously, so that my identity is hidden from other group members.

#### Acceptance Criteria

1. THE System SHALL display an anonymous toggle switch
2. WHEN anonymous is enabled, THE System SHALL set is_anonymous to true in the topics table
3. WHEN anonymous is enabled, THE System SHALL set is_ghost to true for the associated message

### Requirement 5: Submit Topic

**User Story:** As a user, I want to submit my topic, so that it appears in the group's topic feed.

#### Acceptance Criteria

1. WHEN a user taps the Post button with valid content, THE System SHALL insert a new row into the topics table
2. THE System SHALL insert a corresponding message row with the topic_id reference
3. WHEN submission succeeds, THE System SHALL close the modal and refresh the topics list
4. WHEN submission fails, THE System SHALL display an error toast message
5. THE System SHALL show a loading state on the Post button during submission
