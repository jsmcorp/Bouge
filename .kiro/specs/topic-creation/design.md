# Design Document

## Overview

This design implements a topic creation modal that allows users to create new topics within a group. The modal follows iOS design patterns with a bottom sheet style, matching the app's existing UI components and color scheme.

## Architecture

The feature consists of:
1. **CreateTopicModal** - A reusable modal component
2. **Topic creation logic** - Supabase insert operations
3. **Integration** - Hook into GroupTopicsPage's + button

## Components and Interfaces

### CreateTopicModal Component

```typescript
interface CreateTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  onTopicCreated: () => void; // Callback to refresh topics list
}

interface TopicFormData {
  type: 'discussion' | 'news' | 'poll';
  title: string;
  content: string;
  isAnonymous: boolean;
}
```

### UI Layout

```
┌─────────────────────────────────────┐
│  ✕  Create Topic            [Post] │  <- Header with close & submit
├─────────────────────────────────────┤
│                                     │
│  ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │Discussion│ │  News   │ │ Poll  │ │  <- Type selector pills
│  └─────────┘ └─────────┘ └───────┘ │
│                                     │
│  Title (optional)                   │
│  ┌─────────────────────────────────┐│
│  │                                 ││  <- Title input
│  └─────────────────────────────────┘│
│                                     │
│  What's on your mind?               │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │                                 ││  <- Content textarea
│  │                                 ││
│  └─────────────────────────────────┘│
│                              0/1000 │  <- Character count
│                                     │
│  ┌─────────────────────────────────┐│
│  │ 👻 Post Anonymously      [  ○] ││  <- Anonymous toggle
│  └─────────────────────────────────┘│
│                                     │
└─────────────────────────────────────┘
```

### Color Scheme

- Background: `bg-white` (modal) / `bg-black/50` (overlay)
- Type pills: `bg-slate-100` (unselected) / `bg-sky-500 text-white` (selected)
- Post button: `bg-sky-500` (enabled) / `bg-slate-300` (disabled)
- Anonymous toggle: `bg-purple-500` when enabled

## Data Models

### Topic Insert Payload

```typescript
interface TopicInsert {
  id: string;           // Generated UUID
  group_id: string;     // From props
  type: string;         // 'discussion' | 'news' | 'poll'
  title: string | null; // Optional title
  is_anonymous: boolean;
  created_at: string;   // ISO timestamp
  // views_count, likes_count, replies_count default to 0
}
```

### Message Insert Payload

```typescript
interface MessageInsert {
  id: string;           // Generated UUID
  group_id: string;     // Same as topic
  user_id: string;      // Current user
  content: string;      // Topic content
  is_ghost: boolean;    // Same as is_anonymous
  message_type: 'text';
  topic_id: string;     // Reference to created topic
  created_at: string;   // ISO timestamp
}
```

## Database Operations

### Create Topic Flow

1. Generate UUIDs for topic and message
2. Insert into `topics` table
3. Insert into `messages` table with `topic_id` reference
4. Both operations in sequence (topic first, then message)

```typescript
// Pseudocode
const topicId = crypto.randomUUID();
const messageId = crypto.randomUUID();

// Step 1: Insert topic
await supabase.from('topics').insert({
  id: topicId,
  group_id: groupId,
  type: formData.type,
  title: formData.title || null,
  is_anonymous: formData.isAnonymous,
});

// Step 2: Insert message linked to topic
await supabase.from('messages').insert({
  id: messageId,
  group_id: groupId,
  user_id: userId,
  content: formData.content,
  is_ghost: formData.isAnonymous,
  message_type: 'text',
  topic_id: topicId,
});
```

## Error Handling

| Error Case | User Feedback |
|------------|---------------|
| Network failure | Toast: "Failed to create topic. Please try again." |
| Empty content | Post button disabled |
| Server error | Toast: "Something went wrong. Please try again." |

## Testing Strategy

No automated tests required per user request. Manual testing:
1. Create topic with all fields
2. Create topic with only content
3. Create anonymous topic
4. Verify topic appears in feed after creation
