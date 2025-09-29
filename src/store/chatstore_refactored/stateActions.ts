import { Group, Message, Poll, TypingUser, GroupMember, GroupMedia } from './types';
import { FEATURES } from '@/lib/supabase';

// Resume/unlock flow is owned exclusively by supabasePipeline.onAppResume()

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
  onAppResumeSimplified: () => void;
  onAppPause: () => void;
  onAppBackground: () => void;
  onNetworkOnline: () => void;
  onNetworkOnlineSimplified: () => void;
  onWake: (reason?: string, groupId?: string) => Promise<void>;
  startPollFallback: () => void;
  stopPollFallback: () => void;
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
      groupMedia: [],
      connectionStatus: 'disconnected',
      isReconnecting: false,
      reconnectAttempt: 0,
      // Invalidate any in-flight fetches for previous group
      fetchToken: null,
      currentFetchGroupId: null,
      isLoading: false
    });

    // Setup new subscription and fetch polls
    if (group) {
      // Small delay to ensure state is clean
      setTimeout(() => {
        get().setupRealtimeSubscription(group.id);
        get().fetchPollsForGroup(group.id);
      }, 100);
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
  
  // Poll fallback when realtime is degraded
  // Call this when we mark realtime as degraded to keep UI updated
  startPollFallback: () => {
    const state = get();
    if (state.pollFallbackTimer) return;
    const timer = setInterval(() => {
      const { activeGroup } = get();
      if (activeGroup?.id) {
        (get() as any).deltaSyncSince(activeGroup.id, new Date(Date.now() - 10000).toISOString());
      }
    }, 10000);
    set({ pollFallbackTimer: timer as any });
  },
  stopPollFallback: () => {
    const { pollFallbackTimer } = get();
    if (pollFallbackTimer) {
      clearInterval(pollFallbackTimer as any);
      set({ pollFallbackTimer: null });
    }
  },
  
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
  
  // Simplified app resume handler
  onAppResume: () => {
    if (FEATURES.SIMPLIFIED_REALTIME) {
      return get().onAppResumeSimplified();
    }
    
    // Legacy implementation would be here
    console.log('[realtime] Using legacy resume flow');
  },

  onAppResumeSimplified: () => {
    const { activeGroup } = get() as any;
    if (!activeGroup?.id) {
      console.log('[realtime-v2] No active group, skipping resume');
      return;
    }

    console.log('[realtime-v2] App resumed - delegating to reconnection manager');

    // Route through health-first reconnection manager; it will fast-path when healthy
    import('@/lib/reconnectionManager')
      .then(({ reconnectionManager }) => reconnectionManager.reconnect('app-resume'))
      .catch((error) => console.error('[realtime-v2] Reconnect on resume failed:', error));

    // Process any pending outbox messages (no reset)
    try {
      const { triggerOutboxProcessing } = get() as any;
      if (typeof triggerOutboxProcessing === 'function') {
        triggerOutboxProcessing('app-resume', 'high');
      }
    } catch (error) {
      console.error('[realtime-v2] Failed to trigger outbox processing on resume:', error);
    }
  },

  // Simplified wake handler - just ensure connection and process outbox
  onWake: async (reason?: string, groupIdOverride?: string) => {
    try {
      console.log(`[realtime-v2] Wake event: ${reason || 'unknown'}`);

      // If a specific group is mentioned, switch to it
      if (groupIdOverride) {
        const groups = (get() as any).groups || [];
        const targetGroup = groups.find((g: any) => g.id === groupIdOverride);
        if (targetGroup) {
          console.log(`[realtime-v2] Switching to group from wake: ${targetGroup.name}`);
          (get() as any).setActiveGroup?.(targetGroup);
        }
      }

      // Resume connection
      get().onAppResumeSimplified();
    } catch (e) {
      console.warn('[realtime-v2] onWake error:', e);
    }
  },

  // App pause handler - reset outbox flags to prevent stuck state after resume
  // To wire up: In your main app component or lifecycle handler, call this when the app pauses
  // Example: App.addListener('appStateChange', (state) => { if (state.isActive === false) chatStore.onAppPause(); });
  onAppPause: () => {
    console.log('[lifecycle] App paused - resetting outbox processing state');
    try {
      import('./offlineActions').then(({ resetOutboxProcessingState }) => {
        resetOutboxProcessingState();
      });
    } catch (e) {
      console.warn('Failed to reset outbox state on app pause:', e);
    }
  },

  // App background handler - similar to pause but may have different lifecycle timing
  // To wire up: Call this when app moves to background (Android onPause, iOS applicationDidEnterBackground)
  // Example: Capacitor.addListener('appStateChange', (state) => { if (!state.isActive) chatStore.onAppBackground(); });
  onAppBackground: () => {
    console.log('[lifecycle] App moved to background - resetting outbox processing state');
    try {
      import('./offlineActions').then(({ resetOutboxProcessingState }) => {
        resetOutboxProcessingState();
      });
    } catch (e) {
      console.warn('Failed to reset outbox state on app background:', e);
    }
  },

  onNetworkOnline: () => {
    if (FEATURES.SIMPLIFIED_REALTIME) {
      return get().onNetworkOnlineSimplified();
    }
    
    // Legacy implementation would be here
    console.log('[realtime] Using legacy network online handler');
  },

  onNetworkOnlineSimplified: () => {
    console.log('[realtime-v2] Network came online');
    const { triggerOutboxProcessing } = get();

    // Notify pipeline about network reconnection
    import('@/lib/supabasePipeline').then(({ supabasePipeline }) => {
      supabasePipeline.onNetworkReconnect();
    }).catch(error => {
      console.warn('[realtime-v2] Failed to notify pipeline of network reconnect:', error);
    });

    // Only trigger outbox processing, don't reset state as that causes redundant triggers
    console.log('[realtime-v2] Network online - triggering outbox processing only');
    if (typeof triggerOutboxProcessing === 'function') {
      triggerOutboxProcessing('network-online', 'high');
    }

    // Route reconnect through the single-flight reconnection manager (health-first)
    setTimeout(() => {
      import('@/lib/reconnectionManager')
        .then(({ reconnectionManager }) => reconnectionManager.reconnect('network-online'))
        .catch((error) => console.warn('[realtime-v2] Network reconnect failed:', error));
    }, 500);
  },
  
  closeGroupDetailsPanel: () => {
    set({ showGroupDetailsPanel: false });
  },
});