import { RealtimeChannel } from '@supabase/supabase-js';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  created_at: string;
  avatar_url?: string | null;
}

export interface GroupMember {
  id: string;
  user_id: string;
  group_id: string;
  role: 'admin' | 'participant';
  joined_at: string;
  user: {
    display_name: string;
    phone_number: string;
    avatar_url: string | null;
  };
}

export interface GroupMedia {
  id: string;
  group_id: string;
  user_id: string;
  type: 'photo' | 'document' | 'link';
  url: string;
  name: string;
  uploaded_at: string;
  user: {
    display_name: string;
    avatar_url: string | null;
  };
}

export interface Poll {
  id: string;
  message_id: string;
  question: string;
  options: string[];
  created_at: string;
  closes_at: string;
  vote_counts: number[];
  total_votes: number;
  user_vote?: number | null;
  is_closed: boolean;
}

export interface PollVote {
  poll_id: string;
  user_id: string;
  option_index: number;
  created_at: string;
}

export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: boolean;
  message_type: string;
  category: string | null;
  parent_id: string | null;
  image_url: string | null;
  created_at: string;
  author?: {
    display_name: string;
    avatar_url: string | null;
  };
  pseudonym?: string; // CRITICAL: Pseudonym for ghost messages (loaded from SQLite during lazy load to prevent RPC calls)
  reactions?: Reaction[];
  replies?: Message[];
  reply_count?: number;
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'failed';
  poll?: Poll;
  // Client idempotency key used for server upsert and ACK mapping
  dedupe_key?: string | null;
}

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at?: string;
}

export interface TypingUser {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_ghost: boolean;
}

export interface ChatState {
  groups: Group[];
  activeGroup: Group | null;
  messages: Message[];
  polls: Poll[];
  userVotes: Record<string, number | null>;
  isLoadingPolls: boolean;
  mainChatGhostMode: boolean;
  threadGhostMode: boolean;
  isLoading: boolean;
  // Lazy-load state
  isLoadingOlder: boolean;
  hasMoreOlder: boolean;
  replyingTo: Message | null;
  activeThread: Message | null;
  threadReplies: Message[];
  isThreadLoading: boolean;
  typingUsers: TypingUser[];
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  realtimeChannel: RealtimeChannel | null;
  typingTimeout: NodeJS.Timeout | null;
  showGroupDetailsPanel: boolean;
  groupMembers: GroupMember[];
  groupMedia: GroupMedia[];
  uploadingFile: boolean;
  isLoadingGroupDetails: boolean;
  messageReactions: Record<string, Reaction[]>;
  online: boolean;
  outboxProcessorInterval: NodeJS.Timeout | null;
  activeSwipeMessageId: string | null;
  // Reconnection control
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  isReconnecting: boolean;
  // Heartbeat/watchdog
  heartbeatTimer: NodeJS.Timeout | null;
  reconnectWatchdogTimer: NodeJS.Timeout | null;
  lastActivityAt: number;
  // Push/resync flags
  writesBlocked?: boolean;
  realtimeDegraded?: boolean;
  pollFallbackTimer?: NodeJS.Timeout | null;
  // Fetch coordination to prevent cross-group contamination
  fetchToken?: string | null;
  currentFetchGroupId?: string | null;
  // Unread message tracking
  firstUnreadMessageId?: string | null;
  unreadCount?: number;
  // Join requests
  pendingJoinRequests: any[]; // Will be typed as JoinRequest[] from joinRequestService
  pendingRequestCounts: Record<string, number>; // Map of groupId -> pending request count
  // Message selection
  selectionMode: boolean;
  selectedMessageIds: Set<string>;
}