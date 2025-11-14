# WhatsApp-Style Message Selection Feature

## Overview
Implemented a comprehensive message selection and management feature for the chat screen, similar to WhatsApp's interface.

## Features Implemented

### 1. Long-Press Message Interaction
- **Long press (500ms)** on any message bubble shows a quick reaction bar
- Quick reactions bar displays 6 common emojis: 👍 ❤️ 😂 😮 😢 🙏
- Smooth animations with haptic feedback on supported devices
- After reacting, automatically enters selection mode with that message selected

### 2. Selection Mode
- **Visual indicators**: Selected messages show a checkmark icon on the left
- **Background highlight**: Selected messages have a subtle primary color background
- **Multi-select**: Tap any message in selection mode to toggle its selection
- **Selection toolbar**: Fixed top bar showing:
  - Selected count
  - Cancel button (X icon)
  - Action buttons: Reply, Star, Delete, Report

### 3. Action Buttons

#### Reply (single message only)
- Only visible when exactly 1 message is selected
- Sets the selected message as the reply target
- Exits selection mode and focuses the input

#### Star
- Marks messages as favorites (placeholder for future implementation)
- Works with multiple messages
- Shows toast notification

#### Delete
- Shows confirmation dialog before deletion
- Deletes messages from local SQLite database
- Messages are removed from UI immediately (optimistic update)
- **Note**: Messages are only deleted locally, not from server
- User won't see deleted messages again on this device

#### Report
- Reports inappropriate messages (placeholder for future implementation)
- Works with multiple messages
- Shows toast notification

### 4. Quick Reaction Bar
- Appears above/below message on long press
- 6 emoji buttons with hover effects
- Scale animation on hover
- Smooth fade in/out transitions
- Automatically closes after selection

## Components Created

### 1. `MessageSelectionToolbar.tsx`
Top bar component that appears in selection mode with action buttons.

**Props:**
- `selectedCount`: Number of selected messages
- `onReply`: Reply action handler
- `onStar`: Star action handler
- `onDelete`: Delete action handler
- `onReport`: Report action handler
- `onCancel`: Cancel selection handler

### 2. `QuickReactionBar.tsx`
Floating reaction picker that appears on long press.

**Props:**
- `isVisible`: Controls visibility
- `onReactionSelect`: Callback when emoji is selected
- `position`: 'top' or 'bottom' placement

## State Management

### New State (ChatStore)
```typescript
{
  selectionMode: boolean;              // Whether selection mode is active
  selectedMessageIds: Set<string>;     // Set of selected message IDs
}
```

### New Actions (ChatStore)
```typescript
{
  enterSelectionMode: () => void;                    // Enter selection mode
  exitSelectionMode: () => void;                     // Exit selection mode
  toggleMessageSelection: (messageId: string) => void; // Toggle message selection
  clearSelection: () => void;                        // Clear all selections
  selectAllMessages: () => void;                     // Select all messages
  deleteSelectedMessages: () => Promise<void>;       // Delete selected messages
  starSelectedMessages: () => Promise<void>;         // Star selected messages
  reportSelectedMessages: () => Promise<void>;       // Report selected messages
}
```

## Database Changes

### SQLite Service
Added `deleteMessages` method to batch delete messages:

```typescript
public async deleteMessages(messageIds: string[]): Promise<void>
```

This method:
- Takes an array of message IDs
- Deletes them from the local SQLite database
- Uses SQL IN clause for efficient batch deletion
- Ensures messages won't reappear on app restart

## UI/UX Details

### Selection Mode Behavior
1. **Enter**: Long press message → show reactions → select emoji → enters selection mode
2. **Select more**: Tap any message to toggle selection
3. **Exit**: Tap cancel button or complete an action

### Visual Feedback
- **Haptic feedback** on selection/deselection (mobile only)
- **Smooth animations** for all interactions
- **Color coding**: Primary color for selected state
- **Icons**: CheckCircle for selected, empty circle for unselected

### Accessibility
- All buttons have proper titles/labels
- Keyboard navigation supported
- Screen reader friendly
- Touch targets are appropriately sized (44x44px minimum)

## Future Enhancements

### Planned Features
1. **Server-side deletion**: Sync deletions to Supabase
2. **Starred messages view**: Dedicated screen for starred messages
3. **Report system**: Full reporting workflow with admin notifications
4. **Forward messages**: Forward selected messages to other groups
5. **Copy text**: Copy selected message content
6. **Message info**: View delivery/read status for selected message
7. **Select all**: Button to select all messages in chat

### Database Schema Changes Needed
```sql
-- For starring messages
CREATE TABLE starred_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  message_id UUID REFERENCES messages(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, message_id)
);

-- For reporting messages
CREATE TABLE message_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id),
  reported_by UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- For soft delete (server-side)
ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMP;
```

## Testing Checklist

- [ ] Long press shows quick reactions
- [ ] Quick reactions work and enter selection mode
- [ ] Can select/deselect multiple messages
- [ ] Selection toolbar appears with correct count
- [ ] Reply button only shows for single selection
- [ ] Delete confirmation dialog works
- [ ] Messages are deleted from SQLite
- [ ] Messages don't reappear after app restart
- [ ] Selection mode exits after actions
- [ ] Haptic feedback works on mobile
- [ ] Animations are smooth
- [ ] Works in both light and dark mode
- [ ] Keyboard navigation works
- [ ] Screen reader announces selections

## Known Limitations

1. **Local deletion only**: Messages are only deleted from the local device, not from the server or other users' devices
2. **No undo**: Once deleted, messages cannot be recovered (would need to implement a trash/recycle bin)
3. **Star/Report placeholders**: These features show toast notifications but don't persist data yet
4. **No bulk actions**: Can't select all messages at once (would need "Select All" button)
5. **Thread messages**: Selection mode doesn't work in thread view (by design)

## Files Modified

### New Files
- `src/components/chat/MessageSelectionToolbar.tsx`
- `src/components/chat/QuickReactionBar.tsx`
- `src/store/chatstore_refactored/messageSelectionActions.ts`

### Modified Files
- `src/components/chat/MessageBubble.tsx` - Added selection mode support
- `src/components/chat/MessageList.tsx` - Integrated toolbar and delete dialog
- `src/store/chatstore_refactored/types.ts` - Added selection state
- `src/store/chatstore_refactored/stateActions.ts` - Added selection actions
- `src/store/chatstore_refactored/index.ts` - Integrated selection actions
- `src/lib/sqliteServices_Refactored/messageOperations.ts` - Added deleteMessages method
- `src/lib/sqliteServices_Refactored/sqliteService.ts` - Exposed deleteMessages method

## Usage Example

```typescript
// In your component
const { 
  selectionMode, 
  selectedMessageIds, 
  enterSelectionMode,
  toggleMessageSelection,
  deleteSelectedMessages 
} = useChatStore();

// Enter selection mode
enterSelectionMode();

// Select a message
toggleMessageSelection('message-id-123');

// Delete selected messages
await deleteSelectedMessages();
```

## Performance Considerations

- **Set for selections**: Using `Set<string>` for O(1) lookup performance
- **Batch deletion**: Single SQL query for multiple messages
- **Optimistic updates**: UI updates immediately, database operations in background
- **Minimal re-renders**: Selection state changes don't trigger full message list re-render

## Accessibility Features

- Proper ARIA labels on all interactive elements
- Keyboard navigation support
- Screen reader announcements for selection changes
- High contrast mode support
- Touch target sizes meet WCAG guidelines (44x44px)
- Focus indicators visible and clear
