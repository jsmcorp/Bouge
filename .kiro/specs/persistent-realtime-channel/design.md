# Design Document

## Overview

This design implements a persistent Realtime Channel architecture that maintains a single WebSocket connection throughout the user session. Instead of recreating channels on every group switch, we keep one channel alive and dynamically rebind INSERT handlers with updated filters. This approach eliminates the message loss and delays caused by channel recreation while maintaining all existing fallback mechanisms.

## Architecture

### High-Level Flow

```
App Init → Create Channel → Attach Handler (groupid filter) → Subscribe → Connected
                ↓
User Switches Group → Detach Old Handler → Attach New Handler (new groupid) → Continue
                ↓
Message Arrives → Handler Fires → Process Message → Update UI/SQLite
                ↓
Session Ends → Cleanup Channel → Remove All Handlers → Disconnect
```

### Key Architectural Decisions

1. **Single Channel Instance**: One channel named `active-chat-{userId}` persists for the entire session
2. **Handler Token System**: Store removal functions to cleanly detach handlers without affecting the channel
3. **Filter-Based Routing**: Use postgres_changes filter parameter to target specific groups
4. **Lazy Cleanup**: Keep channel alive even when on dashboard (no active group) to avoid reconnection overhead
5. **Backward Compatibility**: Maintain existing REST fallback and FCM push notification systems

## Components and Interfaces

### 1. Persistent Channel Manager (`src/lib/realtimeActive.ts`)

New module that encapsulates channel lifecycle management.

```typescript
interface RealtimeActiveManager {
  // Initialize and return the persistent channel
  ensureChannel(): Promise<RealtimeChannel>;
  
  // Bind INSERT handler for a specific group
  bindActive(groupId: string, onInsert: (row: any) => void): Promise<void>;
  
  // Unbind current handler without destroying channel
  unbindActive(): void;
  
  // Cleanup channel on logout/session end
  cleanup(): Promise<void>;
  
  // Get current channel status
  getStatus(): 'disconnected' | 'connecting' | 'connected';
}
```

**Key Implementation Details:**
- Channel is created once with `supabase.realtime.channel('active-chat-{userId}')`
- Subscribe is called once during initialization
- Handler specs are stored in a `currentHandler` variable for removal
- Uses `channel.on('postgres_changes', {...}, handler)` to register handlers
- Detachment is done by calling the stored removal function

### 2. Modified Realtime Actions (`src/store/chatstore_refactored/realtimeActions.ts`)

Update existing realtime actions to use the persistent channel manager.

**Changes to `setupSimplifiedRealtimeSubscription`:**
- Replace channel creation logic with `ensureChannel()` call
- Replace handler registration with `bindActive(groupId, handler)` call
- Remove `removeChannel()` calls on group switch
- Keep all existing heartbeat, presence, and poll handlers

**Changes to `cleanupRealtimeSubscription`:**
- Call `unbindActive()` instead of removing the entire channel
- Only call `cleanup()` on logout or session expiration
- Remove the 5-second delay timer (no longer needed)

**New Method `switchActiveGroup`:**
```typescript
async switchActiveGroup(newGroupId: string): Promise<void> {
  // Detach old handler
  await realtimeActive.unbindActive();
  
  // Attach new handler with updated filter
  await realtimeActive.bindActive(newGroupId, (row) => {
    // Existing message processing logic
    handleMessageInsert(row);
  });
  
  log(`Switched active group to ${newGroupId} (channel reused)`);
}
```

### 3. Message Processing Pipeline

**Active Group Messages:**
```
INSERT Event → Handler Fires → buildMessageFromRow() → attachMessageToState() → 
Save to SQLite → Update UI → Auto-scroll
```

**Background Group Messages:**
```
INSERT Event → Handler Fires → buildMessageFromRow() → Save to SQLite → 
Update Unread Count → Dispatch 'message:background' Event → Skip UI Update
```

### 4. Filter Construction

The postgres_changes filter must use the actual database column name `groupid` (not `group_id`):

```typescript
// Single group filter
const filter = `groupid=eq.${groupId}`;

// Multi-group filter (for future enhancement)
const filter = `or=(${groupIds.map(id => `groupid.eq.${id}`).join(',')})`;
```

**Important:** The database column is `groupid` (no underscore), but the JavaScript objects use `group_id` (with underscore). The filter must match the database schema.

## Data Models

### Channel State

```typescript
interface ChannelState {
  channel: RealtimeChannel | null;
  status: 'disconnected' | 'connecting' | 'connected';
  subscribedAt: number | null;
  currentGroupId: string | null;
  currentHandler: (() => void) | null; // Removal function
}
```

### Message Insert Payload

```typescript
interface MessageInsertPayload {
  new: {
    id: string;
    groupid: string;        // Note: database column name
    user_id: string;
    content: string;
    is_ghost: boolean;
    message_type: string;
    category: string | null;
    parent_id: string | null;
    image_url: string | null;
    created_at: string;
    dedupe_key: string | null;
  };
}
```

## Error Handling

### Connection Failures

1. **CHANNEL_ERROR**: Attempt session refresh, reattach handler, log warning
2. **CLOSED**: Trigger reconnection logic, recreate channel if needed
3. **TIMED_OUT**: Same as CLOSED
4. **Network Offline**: Keep channel in memory, reconnect when online

### Handler Failures

1. **Handler Throws Exception**: Log error, continue processing other events
2. **SQLite Save Fails**: Log warning, message still in memory
3. **Duplicate Messages**: Handled by dedupe_key and SQLite INSERT OR REPLACE

### Edge Cases

1. **Rapid Group Switches**: Queue handler changes, process sequentially
2. **Channel Dies During Switch**: Recreate channel, reattach handler
3. **Session Expires**: Cleanup channel, show login screen
4. **App Backgrounded**: Keep channel alive, rely on FCM for notifications

## Testing Strategy

### Unit Tests

1. **Channel Lifecycle**
   - Test channel creation and subscription
   - Test handler attachment and detachment
   - Test cleanup on logout

2. **Handler Management**
   - Test single handler attachment
   - Test handler replacement on group switch
   - Test no duplicate handlers after multiple switches

3. **Filter Construction**
   - Test single group filter format
   - Test multi-group filter format
   - Test filter with special characters in group ID

### Integration Tests

1. **Message Flow**
   - Send message to active group, verify INSERT handler fires
   - Send message to background group, verify saved to SQLite only
   - Switch groups, send message, verify new handler fires

2. **Reconnection**
   - Disconnect network, reconnect, verify channel recovers
   - Kill channel, verify recreation and handler reattachment
   - Expire session, verify cleanup and re-initialization

3. **Fallback Mechanisms**
   - Disable realtime, verify REST fallback works
   - Simulate INSERT handler failure, verify FCM fallback
   - Test missed message fetch after reconnection

### Manual Testing Scenarios

1. **Basic Flow**
   - Open app → Join group A → Send message → Verify instant delivery
   - Switch to group B → Send message → Verify instant delivery
   - Return to group A → Verify messages still load

2. **Background Messages**
   - Open group A → Have friend send to group B → Verify unread count updates
   - Navigate to group B → Verify messages are there

3. **Network Conditions**
   - Lock phone → Unlock → Verify reconnection
   - Turn off WiFi → Turn on → Verify reconnection
   - Switch WiFi to cellular → Verify seamless transition

4. **Edge Cases**
   - Rapidly switch between 5 groups → Verify no crashes
   - Leave app open for 1 hour → Send message → Verify delivery
   - Force kill app → Reopen → Verify channel recreates

## Performance Considerations

### Memory Usage

- **Before**: New channel object created on every group switch (~50KB per channel)
- **After**: Single channel object reused (~50KB total)
- **Savings**: ~50KB per group switch, significant for users who switch frequently

### Network Usage

- **Before**: WebSocket disconnect/reconnect on every switch (~2KB handshake)
- **After**: No disconnect/reconnect, only handler rebinding (~0 bytes)
- **Savings**: ~2KB per group switch, reduces cellular data usage

### Latency

- **Before**: 500-2000ms delay for channel recreation and subscription
- **After**: <10ms for handler rebinding
- **Improvement**: 50-200x faster group switching

### Battery Impact

- **Before**: Frequent WebSocket reconnections drain battery
- **After**: Single persistent connection, minimal battery impact
- **Improvement**: Estimated 5-10% battery savings for heavy users

## Migration Strategy

### Phase 1: Implementation (This Spec)

1. Create `realtimeActive.ts` module
2. Update `realtimeActions.ts` to use persistent channel
3. Update filter construction to use `groupid` column name
4. Add diagnostic logging

### Phase 2: Testing

1. Deploy to staging environment
2. Run automated test suite
3. Perform manual testing with QA team
4. Monitor logs for any issues

### Phase 3: Rollout

1. Deploy to 10% of users (canary release)
2. Monitor error rates and performance metrics
3. Gradually increase to 50%, then 100%
4. Keep feature flag for quick rollback if needed

### Phase 4: Cleanup

1. Remove legacy channel recreation code
2. Remove feature flag after 2 weeks of stable operation
3. Update documentation and training materials

## Rollback Plan

If critical issues are discovered:

1. Set `VITE_SIMPLIFIED_REALTIME=false` in environment variables
2. Redeploy application (no code changes needed)
3. Legacy implementation will be used
4. Investigate and fix issues in persistent channel code
5. Re-enable after fixes are validated

## Monitoring and Observability

### Key Metrics

1. **Channel Lifetime**: How long channels stay connected (target: >1 hour)
2. **Handler Switch Time**: Time to rebind handlers (target: <10ms)
3. **Message Delivery Rate**: % of messages delivered via realtime vs REST (target: >95%)
4. **Reconnection Frequency**: How often channels need to reconnect (target: <1 per hour)

### Logging

All logs prefixed with `[realtime-active]` for easy filtering:

- `[realtime-active] Channel created: active-chat-{userId}`
- `[realtime-active] Handler attached for group {groupId}`
- `[realtime-active] Handler detached for group {groupId}`
- `[realtime-active] Message received: {messageId} (active/background)`
- `[realtime-active] Channel cleanup initiated`

### Alerts

1. **High REST Fallback Rate**: Alert if >20% of messages use REST fallback
2. **Frequent Reconnections**: Alert if >5 reconnections per hour per user
3. **Handler Attachment Failures**: Alert if handler attachment fails >3 times
4. **Channel Creation Failures**: Alert immediately on channel creation failure

## Security Considerations

### Authentication

- Channel uses Supabase auth tokens for authentication
- Tokens are refreshed automatically by Supabase client
- Handler filters ensure users only receive messages for their groups

### Authorization

- Row-level security (RLS) policies enforce group membership
- Even if a malicious user modifies the filter, RLS prevents unauthorized access
- All message inserts are validated server-side

### Data Privacy

- Messages are encrypted in transit (WSS protocol)
- Local SQLite database is encrypted on device
- No sensitive data is logged (only message IDs and group IDs)

## Future Enhancements

### Multi-Group Subscription (Phase 2)

Instead of switching handlers, subscribe to all user's groups at once:

```typescript
const allGroupIds = user.groups.map(g => g.id);
const filter = `or=(${allGroupIds.map(id => `groupid.eq.${id}`).join(',')})`;
```

**Benefits:**
- No handler switching needed
- Messages arrive for all groups simultaneously
- Simpler code

**Tradeoffs:**
- More events to process
- Slightly higher memory usage
- Need to filter in handler which group is active

### Presence Optimization (Phase 3)

Currently presence is tracked per-channel. With persistent channel:

- Track presence for all groups user is in
- Show "typing..." indicators across groups
- Show online/offline status for all contacts

### Message Queueing (Phase 4)

If handler processing is slow:

- Queue incoming messages
- Process in batches
- Prevent UI blocking on rapid message bursts
