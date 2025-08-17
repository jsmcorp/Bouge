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
    online: true,
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