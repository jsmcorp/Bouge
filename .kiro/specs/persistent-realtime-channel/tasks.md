# Implementation Plan

- [x] 1. Create persistent channel manager module





  - Create `src/lib/realtimeActive.ts` with channel lifecycle management
  - Implement `ensureChannel()` to create and subscribe to a single persistent channel
  - Implement `bindActive()` to attach INSERT handler with groupid filter
  - Implement `unbindActive()` to detach current handler without destroying channel
  - Implement `cleanup()` to remove channel on logout/session end
  - Implement `getStatus()` to return current connection status
  - Add diagnostic logging with `[realtime-active]` prefix
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 5.1, 5.2, 5.3_

- [x] 2. Update realtime actions to use persistent channel

  - [x] 2.1 Modify `setupSimplifiedRealtimeSubscription()` to use `ensureChannel()`


    - Replace channel creation logic with call to `realtimeActive.ensureChannel()`
    - Ensure first handler is attached BEFORE calling subscribe()
    - Use `groupid` (not `group_id`) in postgres_changes filter
    - Keep all existing heartbeat, presence, and poll handlers
    - Remove `removeChannel()` calls on group switch
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.5, 5.1_

  - [x] 2.2 Create `switchActiveGroup()` method for group transitions


    - Call `realtimeActive.unbindActive()` to detach old handler
    - Call `realtimeActive.bindActive(newGroupId, handler)` to attach new handler
    - Log group switch with diagnostic message
    - Handle rapid group switches gracefully (no race conditions)
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.4, 5.3_

  - [x] 2.3 Update `cleanupRealtimeSubscription()` for lazy cleanup


    - Call `unbindActive()` instead of removing entire channel
    - Only call `cleanup()` on logout or session expiration
    - Remove 5-second delay timer (no longer needed)
    - Keep channel alive when on dashboard (no active group)
    - _Requirements: 1.6, 2.2, 2.3_

  - [x] 2.4 Update message INSERT handler for active vs background groups

    - Check if message is for active group or background group
    - For active group: call `attachMessageToState()` and update UI
    - For background group: save to SQLite only, skip UI update
    - Dispatch `message:background` event for background messages
    - Update unread counts for background groups
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.4_

- [x] 3. Fix filter construction to use correct column name

  - Update all postgres_changes filters to use `groupid` instead of `group_id`
  - Verify filter syntax: `groupid=eq.{groupId}` for single group
  - Test filter with special characters in group IDs
  - Add comment explaining database column name vs JavaScript property name
  - _Requirements: 2.5, 5.2_

- [x] 4. Preserve existing fallback mechanisms

  - [x] 4.1 Keep REST API fallback for failed realtime connections

    - Ensure REST fallback triggers when channel enters CHANNEL_ERROR state
    - Log warning when REST fallback is used
    - Maintain existing `backgroundMessageSync.ts` logic
    - _Requirements: 4.1, 4.4, 5.5_

  - [x] 4.2 Keep FCM push notification handling

    - Ensure FCM notifications still trigger when app is backgrounded
    - Maintain existing push notification handler in `push.ts`
    - Verify push notifications work when realtime is disconnected
    - _Requirements: 4.3_

  - [x] 4.3 Implement missed message fetch after reconnection

    - When channel reconnects, fetch messages missed during disconnection
    - Use existing `fetchMissedMessagesSinceRealtimeDeath()` logic
    - Ensure no duplicate messages after reconnection
    - _Requirements: 4.5_

- [x] 5. Add comprehensive diagnostic logging

  - Log channel creation with channel name and user ID
  - Log handler attachment with group ID and filter
  - Log handler detachment with group ID
  - Log message INSERT events with message ID, group ID, and active/background status
  - Log REST fallback triggers with reason
  - All logs prefixed with `[realtime-active]` for easy filtering
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6. Update error handling for persistent channel


  - Handle CHANNEL_ERROR by attempting session refresh and handler reattachment
  - Handle CLOSED/TIMED_OUT by triggering reconnection logic
  - Handle rapid group switches without creating duplicate handlers
  - Handle channel death during group switch by recreating channel
  - Handle session expiration by cleaning up channel and showing login
  - _Requirements: 4.1, 4.2, 2.4_

- [x] 7. Integration with existing systems


  - [x] 7.1 Update dashboard to listen for `message:background` events


    - Add event listener for `message:background` custom event
    - Refresh group list when background messages arrive
    - Update unread count badges in real-time
    - _Requirements: 3.4_

  - [x] 7.2 Update group navigation to call `switchActiveGroup()`


    - Modify group selection handler to call new method
    - Ensure smooth transition between groups
    - Verify no UI flicker during group switch
    - _Requirements: 1.2, 1.3_

  - [x] 7.3 Update logout flow to cleanup channel


    - Call `realtimeActive.cleanup()` on logout
    - Ensure all handlers are removed
    - Verify no memory leaks after logout
    - _Requirements: 1.6_

- [ ]* 8. Write unit tests for persistent channel manager
  - Test channel creation and subscription
  - Test handler attachment and detachment
  - Test cleanup on logout
  - Test filter construction with various group IDs
  - Test error handling for connection failures
  - _Requirements: All_

- [ ]* 9. Write integration tests for message flow
  - Test message delivery to active group via INSERT handler
  - Test message delivery to background group (SQLite only)
  - Test group switching with message delivery
  - Test reconnection after network failure
  - Test fallback to REST API when realtime fails
  - _Requirements: All_

- [ ]* 10. Manual testing and validation
  - Test basic flow: open app, join group, send message, verify instant delivery
  - Test group switching: switch between groups, verify messages arrive instantly
  - Test background messages: receive messages in non-active groups, verify unread counts
  - Test network conditions: lock phone, turn off WiFi, verify reconnection
  - Test edge cases: rapid group switches, long idle time, force kill app
  - _Requirements: All_
