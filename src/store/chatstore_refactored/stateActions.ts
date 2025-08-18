import { Group, Message, Poll, TypingUser, GroupMember, GroupMedia } from './types';

export interface StateActions {
  setGroups: (groups: Group[]) => void;
  setActiveGroup: (group: Group | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  setPolls: (polls: Poll[]) => void;
  addPoll: (poll: Poll) => void;
  updatePoll: (pollId: string, updates: Partial<Poll>) => void;
  setUserVotes: (votes: Record<string, number | null>) => void;
  setLoadingPolls: (loading: boolean) => void;
  toggleMainChatGhostMode: () => void;
  toggleThreadGhostMode: () => void;
  setLoading: (loading: boolean) => void;
  setReplyingTo: (message: Message | null) => void;
  setActiveThread: (message: Message | null) => void;
  setThreadReplies: (replies: Message[]) => void;
  setThreadLoading: (loading: boolean) => void;
  setTypingUsers: (users: TypingUser[]) => void;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting') => void;
  setShowGroupDetailsPanel: (show: boolean) => void;
  setActiveSwipeMessage: (messageId: string | null) => void;
  closeGroupDetailsPanel: () => void;
  setGroupMembers: (members: GroupMember[]) => void;
  setGroupMedia: (media: GroupMedia[]) => void;
  setLoadingGroupDetails: (loading: boolean) => void;
  setUploadingFile: (uploading: boolean) => void;
  setOnlineStatus: (status: boolean) => void;
  // Connection manager facade
  onAppResume: () => void;
  onNetworkOnline: () => void;
}

export const createStateActions = (set: any, get: any): StateActions => ({
  setGroups: (groups) => set({ groups }),
  
  setActiveGroup: (group) => {
    const currentGroup = get().activeGroup;

    // Cleanup previous subscription
    if (currentGroup && currentGroup.id !== group?.id) {
      get().cleanupRealtimeSubscription();
    }

    set({
      activeGroup: group,
      messages: [],
      polls: [],
      userVotes: {},
      typingUsers: [],
      showGroupDetailsPanel: false,
      groupMembers: [],
      groupMedia: []
    });

    // Setup new subscription and fetch polls
    if (group) {
      get().setupRealtimeSubscription(group.id);
      get().fetchPollsForGroup(group.id);
    }
  },

  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state: any) => ({
    messages: [...state.messages, message]
  })),
  
  updateMessage: (messageId, updates) => set((state: any) => ({
    messages: state.messages.map((msg: Message) =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    )
  })),
  
  setPolls: (polls) => set({ polls }),
  
  addPoll: (poll) => set((state: any) => ({
    polls: [...state.polls, poll]
  })),
  
  updatePoll: (pollId, updates) => set((state: any) => ({
    polls: state.polls.map((poll: Poll) =>
      poll.id === pollId ? { ...poll, ...updates } : poll
    ),
    // Also update the poll in messages
    messages: state.messages.map((msg: Message) =>
      msg.poll?.id === pollId ? { ...msg, poll: { ...msg.poll, ...updates } } : msg
    )
  })),
  
  setUserVotes: (votes) => set({ userVotes: votes }),
  setLoadingPolls: (loading) => set({ isLoadingPolls: loading }),
  toggleMainChatGhostMode: () => set((state: any) => ({ mainChatGhostMode: !state.mainChatGhostMode })),
  toggleThreadGhostMode: () => set((state: any) => ({ threadGhostMode: !state.threadGhostMode })),
  setLoading: (loading) => set({ isLoading: loading }),
  setReplyingTo: (message) => set({ replyingTo: message }),
  setActiveThread: (message) => set({ activeThread: message }),
  setThreadReplies: (replies) => set({ threadReplies: replies }),
  setThreadLoading: (loading) => set({ isThreadLoading: loading }),
  setTypingUsers: (users) => set({ typingUsers: users }),
  
  setConnectionStatus: (status) => set({
    connectionStatus: status,
    isConnected: status === 'connected'
  }),
  
  setShowGroupDetailsPanel: (show) => {
    set({ showGroupDetailsPanel: show });
    // Close thread panel when opening group details
    if (show) {
      set({ activeThread: null, threadReplies: [], replyingTo: null });
    }
  },
  
  setActiveSwipeMessage: (messageId) => set({ activeSwipeMessageId: messageId }),
  setGroupMembers: (members) => set({ groupMembers: members }),
  setGroupMedia: (media) => set({ groupMedia: media }),
  setLoadingGroupDetails: (loading) => set({ isLoadingGroupDetails: loading }),
  setUploadingFile: (uploading) => set({ uploadingFile: uploading }),
  setOnlineStatus: (status) => set({ online: status }),
  
  // Centralized entry points to coalesce reconnect logic
  onAppResume: () => {
    const { activeGroup, setupRealtimeSubscription, cleanupRealtimeSubscription, reconnectTimer, ensureAuthBeforeSubscribe } = get() as any;
    if (activeGroup?.id) {
      console.log('[realtime] resume: invoking onAppResume');
      // Cancel any pending reconnect timer and force a clean state first
      if (reconnectTimer) {
        clearTimeout(reconnectTimer as any);
        set({ reconnectTimer: null });
      }
      // Always clean up timers/channels/state before resume subscribe
      cleanupRealtimeSubscription();
      set({ isReconnecting: false });

      // Ensure auth is valid before subscribing on resume
      (async () => {
        console.log('[realtime] auth_check: started (resume)');
        const auth = await ensureAuthBeforeSubscribe({ timeoutMs: 3000 });
        if (!auth.ok) {
          console.warn(`[realtime] auth_check: failed reason=${auth.reason}`);
          set({ connectionStatus: 'disconnected' });
          return;
        }
        console.log('[realtime] auth_check: success (resume)');
        // Record subscribe attempt timestamp and start short watchdog
        const now = Date.now();
        set({ lastSubscribeAttemptAt: now } as any);
        setupRealtimeSubscription(activeGroup.id);
        const t = setTimeout(() => {
          const subsAt = (get() as any).subscribedAt as number | null;
          if (!subsAt || (Date.now() - subsAt) > 10000) {
            console.warn('[realtime] subscribe_watchdog fired');
            console.log('[connection] forceReconnect invoked reason=subscribe_watchdog');
            cleanupRealtimeSubscription();
            set({ connectionStatus: 'reconnecting' });
            setTimeout(() => setupRealtimeSubscription(activeGroup.id), 300);
          }
        }, 10000);
        set({ subscribeTimeoutId: t } as any);
      })();
    }
  },
  onNetworkOnline: () => {
    const { activeGroup, setupRealtimeSubscription, cleanupRealtimeSubscription, processOutbox, reconnectTimer } = get();
    // Cancel pending timers, clean, and reconnect once
    if (reconnectTimer) {
      clearTimeout(reconnectTimer as any);
      set({ reconnectTimer: null });
    }
    if (activeGroup?.id) {
      // Reset backoff immediately on online
      set({ connectionStatus: 'reconnecting', reconnectAttempt: 0 });
      cleanupRealtimeSubscription();
      setupRealtimeSubscription(activeGroup.id);
    } else {
      set({ connectionStatus: 'reconnecting', reconnectAttempt: 0 });
    }
    // Kick the outbox regardless of active group
    if (typeof processOutbox === 'function') {
      processOutbox().catch((e: any) => console.error('Outbox process error:', e));
    }
  },
  
  closeGroupDetailsPanel: () => {
    set({ showGroupDetailsPanel: false });
  },
});