# Design Document

## Overview

The offline messaging feature will enable users to send text messages when disconnected by removing UI restrictions that currently block message sending. The existing backend infrastructure already supports offline messaging through an outbox system, local storage, and automatic synchronization. This design focuses on minimal UI changes to unlock the existing functionality.

## Architecture

The current architecture already includes:
- **Outbox System**: Messages are stored locally when offline and synced when online
- **Local Storage**: SQLite-based storage for offline message persistence  
- **Network Detection**: Automatic detection of online/offline status
- **Background Sync**: Automatic processing of outbox when connectivity returns

The design requires only UI layer modifications to remove blocking restrictions.

## Components and Interfaces

### ChatInput Component (`src/components/chat/ChatInput.tsx`)

**Current Blocking Logic:**
```typescript
// Line 334: Textarea disabled when disconnected
disabled={connectionStatus === 'disconnected' || uploadingFile}

// Line 355: Send button disabled when disconnected  
disabled={(!message.trim() && !selectedImage) || isLoading || uploadingFile || connectionStatus === 'disconnected'}
```

**Modified Logic:**
```typescript
// Textarea: Only disable for uploading files, allow offline text input
disabled={uploadingFile}

// Send button: Disable image sending when offline, allow text messages
disabled={(!message.trim() && !selectedImage) || isLoading || uploadingFile || (connectionStatus === 'disconnected' && selectedImage)}
```

### Image Upload Restrictions

When offline:
- Image upload button will be disabled
- Attempting to send with selected image will be blocked
- Clear error messaging for image upload limitations

## Data Models

No changes to existing data models. The current `Message` interface already supports:
- `delivery_status`: 'sending' | 'sent' | 'delivered' | 'failed'
- Temporary IDs with 'temp-' prefix for offline messages
- All required fields for outbox storage

## Error Handling

### Offline Image Upload
- Disable image upload button when `connectionStatus === 'disconnected'`
- Show toast error if user somehow attempts image upload while offline
- Maintain existing error handling in `sendMessage` function

### Message Sending Failures
- Existing error handling in `messageActions.ts` already covers offline scenarios
- Failed messages show 'failed' delivery status
- Retry mechanism through outbox system already implemented

## Testing Strategy

### Manual Testing
1. **Offline Text Messaging**
   - Disconnect from network
   - Verify message input remains enabled
   - Send text message and verify it appears with "sent" status
   - Reconnect and verify message syncs to server

2. **Image Upload Restrictions**
   - Disconnect from network  
   - Verify image upload button is disabled
   - Verify appropriate error messaging

3. **Connection Status Display**
   - Verify disconnected status shows appropriate message
   - Verify status doesn't block text message sending

### Integration Testing
- Test outbox processing when returning online
- Verify message ordering and synchronization
- Test ghost mode and confession messages offline

## Implementation Notes

This is a minimal change design that leverages existing robust offline infrastructure. The changes focus on:

1. **Removing UI Blocks**: Allow text input and sending when offline
2. **Selective Restrictions**: Only block image uploads when offline  
3. **Maintaining UX**: Keep connection status visible for user awareness

The existing `sendMessage` function in `messageActions.ts` already handles all offline scenarios correctly, including:
- Local storage persistence
- Outbox queuing
- Automatic retry logic
- Background synchronization