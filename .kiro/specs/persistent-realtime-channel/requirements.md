# Requirements Document

## Introduction

This spec addresses the critical issue where realtime INSERT handlers fail to trigger when users switch between group chats. The root cause is that the current implementation recreates the Supabase Realtime channel on every group switch, causing the WebSocket connection to be torn down and rebuilt repeatedly. This results in messages being missed and falling back to REST API fetches, creating a poor user experience with delayed message delivery.

## Glossary

- **Realtime Channel**: A Supabase Realtime WebSocket connection that listens for database changes (INSERT, UPDATE, DELETE events)
- **INSERT Handler**: A callback function registered on a Realtime Channel that fires when a new row is inserted into a database table
- **Active Group**: The chat group currently being viewed by the user in the UI
- **Background Group**: Any chat group that the user is a member of but not currently viewing
- **Channel Recreation**: The process of calling `removeChannel()` and creating a new channel, which tears down and rebuilds the WebSocket connection
- **Handler Rebinding**: The process of detaching old INSERT handlers and attaching new ones to an existing channel without recreating it
- **REST Fallback**: The backup mechanism that fetches messages via REST API when realtime INSERT handlers fail to trigger
- **SQLite**: Local database used for offline message storage and caching
- **FCM**: Firebase Cloud Messaging, used for push notifications when the app is backgrounded

## Requirements

### Requirement 1: Persistent Channel Management

**User Story:** As a user switching between group chats, I want messages to arrive instantly via realtime without delays, so that my chat experience feels responsive like WhatsApp.

#### Acceptance Criteria

1. WHEN the application initializes, THE System SHALL create a single Realtime Channel with a stable name that persists for the lifetime of the user session
2. WHEN a user switches from one group chat to another, THE System SHALL NOT call `removeChannel()` or recreate the Realtime Channel
3. WHEN a user switches from one group chat to another, THE System SHALL detach the previous INSERT handler and attach a new INSERT handler with the updated group filter
4. WHEN the Realtime Channel is created, THE System SHALL attach the first INSERT handler with the initial group filter before calling subscribe()
5. WHEN the Realtime Channel is created, THE System SHALL subscribe to it once and maintain the subscription across all group switches
6. WHEN the user logs out or the session expires, THE System SHALL remove the Realtime Channel and clean up all resources

### Requirement 2: Dynamic Handler Management

**User Story:** As a developer maintaining the realtime system, I want a clean way to manage INSERT handlers per group, so that the code is maintainable and doesn't leak memory.

#### Acceptance Criteria

1. WHEN an INSERT handler is attached for a group, THE System SHALL store a reference to the handler removal function
2. WHEN switching to a new group, THE System SHALL call the stored removal function to detach the previous handler before attaching the new one
3. WHEN a handler is detached, THE System SHALL ensure no memory leaks occur by properly cleaning up all event listener references
4. WHEN multiple rapid group switches occur, THE System SHALL handle them gracefully without creating duplicate handlers or race conditions
5. WHEN the active group changes, THE System SHALL update the postgres_changes filter to match the new groupid (note: column name is 'groupid' not 'group_id') without resubscribing the channel

### Requirement 3: Background Message Handling

**User Story:** As a user receiving messages in groups I'm not currently viewing, I want those messages to be saved locally and update unread counts, so that I don't miss any conversations.

#### Acceptance Criteria

1. WHEN a message INSERT event is received for a background group, THE System SHALL save the message to SQLite
2. WHEN a message INSERT event is received for a background group, THE System SHALL update the unread count for that group
3. WHEN a message INSERT event is received for a background group, THE System SHALL NOT add the message to the React state messages array
4. WHEN a message INSERT event is received for a background group, THE System SHALL dispatch a custom event to notify the dashboard to refresh the group list
5. WHEN a user navigates to a background group that received messages, THE System SHALL load those messages from SQLite

### Requirement 4: Fallback Mechanism Preservation

**User Story:** As a user, I want messages to still arrive even if the realtime connection fails, so that I have a reliable messaging experience.

#### Acceptance Criteria

1. WHEN the Realtime Channel enters a CHANNEL_ERROR state, THE System SHALL attempt to recover the session and reattach handlers
2. WHEN the Realtime Channel enters a CLOSED or TIMED_OUT state, THE System SHALL trigger the existing reconnection logic
3. WHEN a message is received via FCM push notification and realtime is not working, THE System SHALL use the REST API fallback to fetch the message
4. WHEN the REST API fallback is triggered, THE System SHALL log a warning indicating that realtime INSERT handlers are not working
5. WHEN the Realtime Channel successfully reconnects, THE System SHALL fetch any missed messages since the disconnection

### Requirement 5: Diagnostic Logging

**User Story:** As a developer debugging realtime issues, I want clear logging that shows when handlers are attached/detached and when messages are received, so that I can quickly identify problems.

#### Acceptance Criteria

1. WHEN a Realtime Channel is created, THE System SHALL log the channel name and subscription status
2. WHEN an INSERT handler is attached, THE System SHALL log the group_id filter and handler registration
3. WHEN an INSERT handler is detached, THE System SHALL log the group_id and confirmation of removal
4. WHEN a message INSERT event is received, THE System SHALL log the message id, group_id, and whether it was for the active or background group
5. WHEN the REST API fallback is triggered, THE System SHALL log a warning with the reason why realtime failed
