export interface LocalMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: number; // SQLite uses INTEGER for boolean
  message_type: string;
  category: string | null;
  parent_id: string | null;
  topic_id: string | null; // Reference to topic if this message is part of a topic chat
  image_url: string | null;
  created_at: number; // Unix timestamp
  updated_at?: number;
  deleted_at?: number;
  local_id?: number; // Auto-increment unique ID
  is_viewed?: number; // SQLite uses INTEGER for boolean - tracks if user has viewed this message
}

export interface LocalPoll {
  id: string;
  message_id: string;
  question: string;
  options: string; // JSON string
  created_at: number;
  closes_at: number;
}

export interface LocalPollVote {
  poll_id: string;
  user_id: string;
  option_index: number;
  created_at: number;
}

export interface LocalGroup {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  created_at: number;
  last_sync_timestamp: number;
  avatar_url: string | null;
  is_archived: number; // SQLite uses INTEGER for boolean
}

export interface LocalUser {
  id: string;
  display_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  is_onboarded: number; // SQLite uses INTEGER for boolean
  created_at: number;
}

export interface OutboxMessage {
  id?: number;
  group_id: string;
  user_id: string;
  content: string;
  retry_count: number;
  next_retry_at: number;
  message_type?: string;
  category?: string | null;
  parent_id?: string | null;
  image_url?: string | null;
  is_ghost?: number;
}

/**
 * TopicOutboxOperation - Represents a queued topic operation for offline sync
 * Supports: topic creation, likes, views, read status updates
 */
export interface TopicOutboxOperation {
  id?: number; // Auto-increment primary key
  operation_type: 'create_topic' | 'toggle_like' | 'increment_view' | 'update_read_status';
  topic_id: string;
  user_id: string;
  group_id: string;
  payload: string; // JSON string containing operation-specific data
  retry_count: number;
  next_retry_at: number;
  created_at: number;
}

export interface SyncState {
  key: string;
  value: string;
}

export interface LocalReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: number;
}

export interface LocalGroupMember {
  group_id: string;
  user_id: string;
  role: 'admin' | 'participant';
  joined_at: number;
  last_read_at?: number;
  last_read_message_id?: string | null;
}

export interface LocalUserPseudonym {
  group_id: string;
  user_id: string;
  pseudonym: string;
  created_at: number;
}

export interface LocalConfession {
  id: string;
  message_id: string;
  confession_type: string;
  is_anonymous: number;
}

export interface StorageStats {
  messageCount: number;
  groupCount: number;
  userCount: number;
  outboxCount: number;
  pollCount: number;
  reactionCount: number;
  groupMemberCount: number;
  confessionCount: number;
}

// ============================================
// CONTACTS FEATURE TYPES
// ============================================

/**
 * LocalContact - Represents a device contact synced to SQLite
 * Stores minimal contact information (name + phone) for privacy
 */
export interface LocalContact {
  id: number; // Auto-increment primary key
  phone_number: string; // E.164 format (e.g., +917744939966)
  display_name: string; // Contact's display name
  email: string | null; // Optional email (for future use)
  photo_uri: string | null; // Optional base64 photo string
  synced_at: number; // Unix timestamp of last sync
}

/**
 * ContactUserMapping - Maps device contacts to registered Confessr users
 * Used for user discovery (which contacts are on Confessr)
 */
export interface ContactUserMapping {
  contact_phone: string; // Phone number from device contacts
  user_id: string; // Confessr user ID (from Supabase users table)
  user_display_name: string; // User's display name on Confessr
  user_avatar_url: string | null; // User's avatar URL
  mapped_at: number; // Unix timestamp when mapping was created
}

/**
 * RegisteredContact - Combined view of contact + user data
 * Used in UI to show which contacts are registered users
 */
export interface RegisteredContact {
  contact_id: number;
  contact_phone: string;
  contact_display_name: string;
  contact_photo_uri: string | null;
  user_id: string;
  user_display_name: string;
  user_avatar_url: string | null;
  is_registered: true; // Always true for this type
}

// ============================================
// TOPICS FEATURE TYPES
// ============================================

/**
 * LocalTopic - Represents a topic cached in SQLite
 * Topics are special messages that have their own feed and chat rooms
 */
export interface LocalTopic {
  id: string; // Topic ID (same as message ID)
  group_id: string;
  message_id: string;
  type: 'text' | 'poll' | 'confession' | 'news' | 'image';
  title: string | null;
  content: string;
  author_id: string | null; // Null if anonymous
  author_name: string | null;
  author_avatar: string | null;
  pseudonym: string | null; // For anonymous topics
  expires_at: number | null; // Unix timestamp, null = never expires
  views_count: number;
  likes_count: number;
  replies_count: number;
  is_anonymous: number; // SQLite uses INTEGER for boolean
  created_at: number;
  synced_at: number | null;
}

/**
 * LocalTopicLike - Represents a user's like on a topic
 */
export interface LocalTopicLike {
  topic_id: string;
  user_id: string;
  created_at: number;
  synced: number; // SQLite uses INTEGER for boolean
}

/**
 * LocalTopicReadStatus - Local-first read tracking for topics
 */
export interface LocalTopicReadStatus {
  topic_id: string;
  group_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: number;
  synced: number; // SQLite uses INTEGER for boolean
}

/**
 * LocalTopicViewQueue - Queues view increments for sync
 */
export interface LocalTopicViewQueue {
  id?: number; // Auto-increment primary key
  topic_id: string;
  user_id: string;
  viewed_at: number;
  synced: number; // SQLite uses INTEGER for boolean
}