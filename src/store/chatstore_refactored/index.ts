import { create } from 'zustand';
import { ChatState } from './types';
import { createStateActions } from './stateActions';
import { createFileActions } from './fileActions';
import { createReactionActions } from './reactionActions';
import { createThreadActions } from './threadActions';
import { createGroupActions } from './groupActions';
import { createPollActions } from './pollActions';
import { createFetchActions } from './fetchActions';
import { createRealtimeActions } from './realtimeActions';
import { createMessageActions } from './messageActions';
import { createOfflineActions } from './offlineActions';
import { FEATURES } from '@/lib/supabase';
 

// Export all types for external use
export * from './types';

// Define the complete interface that combines all action interfaces
interface ChatActions extends 
  ReturnType<typeof createStateActions>,
  ReturnType<typeof createFileActions>,
  ReturnType<typeof createReactionActions>,
  ReturnType<typeof createThreadActions>,
  ReturnType<typeof createGroupActions>,
  ReturnType<typeof createPollActions>,
  ReturnType<typeof createFetchActions>,
  ReturnType<typeof createRealtimeActions>,
  ReturnType<typeof createMessageActions>,
  ReturnType<typeof createOfflineActions> {}

type ChatStore = ChatState & ChatActions;

export const useChatStore = create<ChatStore>((set, get) => {
  // Create all action groups
  const stateActions = createStateActions(set, get);
  const fileActions = createFileActions(set, get);
  const reactionActions = createReactionActions(set, get);
  const threadActions = createThreadActions(set, get);
  const groupActions = createGroupActions(set, get);
  const pollActions = createPollActions(set, get);
  const fetchActions = createFetchActions(set, get);
  const realtimeActions = createRealtimeActions(set, get);
  const messageActions = createMessageActions(set, get);
  const offlineActions = createOfflineActions(set, get);

  // Initialize auth listener if simplified realtime is enabled
  if (FEATURES.SIMPLIFIED_REALTIME && typeof realtimeActions.setupAuthListener === 'function') {
    console.log('[realtime-v2] Initializing auth state listener for chat store');
    const cleanup = realtimeActions.setupAuthListener();
    
    // Store cleanup function for later use
    // Note: In a real app, you'd want to call this on unmount or store destruction
    (window as any).__chatStoreAuthCleanup = cleanup;
  }

  return {
    // Initial state
    groups: [],
    activeGroup: null,
    messages: [],
    polls: [],
    userVotes: {},
    isLoadingPolls: false,
    mainChatGhostMode: true,
    threadGhostMode: true,
    isLoading: false,
    // Lazy-load
    isLoadingOlder: false,
    hasMoreOlder: true,
    replyingTo: null,
    activeThread: null,
    threadReplies: [],
    isThreadLoading: false,
    typingUsers: [],
    isConnected: false,
    connectionStatus: 'disconnected',
    realtimeChannel: null,
    typingTimeout: null,
    showGroupDetailsPanel: false,
    groupMembers: [],
    online: false, // Start offline until network status is properly checked
    outboxProcessorInterval: null,
    activeSwipeMessageId: null,
    groupMedia: [],
    isLoadingGroupDetails: false,
    uploadingFile: false,
    messageReactions: {},
    reconnectAttempt: 0,
    reconnectTimer: null,
    isReconnecting: false,
    heartbeatTimer: null,
    reconnectWatchdogTimer: null,
    lastActivityAt: Date.now(),
    writesBlocked: false,
    realtimeDegraded: false,
    pollFallbackTimer: null,

    // Combine all actions
    ...stateActions,
    ...fileActions,
    ...reactionActions,
    ...threadActions,
    ...groupActions,
    ...pollActions,
    ...fetchActions,
    ...realtimeActions,
    ...messageActions,
    ...offlineActions,
  };
});