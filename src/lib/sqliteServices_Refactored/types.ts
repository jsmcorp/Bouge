export interface LocalMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: number; // SQLite uses INTEGER for boolean
  message_type: string;
  category: string | null;
  parent_id: string | null;
  image_url: string | null;
  created_at: number; // Unix timestamp
  updated_at?: number;
  deleted_at?: number;
  local_id?: number; // Auto-increment unique ID
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