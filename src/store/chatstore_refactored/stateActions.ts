import { Group, Message, Poll, TypingUser, GroupMember, GroupMedia } from './types';
import { supabase, FEATURES } from '@/lib/supabase';
import { FEATURES_PUSH } from '@/lib/featureFlags';
import { ensureAuthForWrites } from './utils';
import { Network } from '@capacitor/network';

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
      reconnectAttempt: 0
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

    console.log('[realtime-v2] App resumed, forcing fresh connection');
    
    // Non-blocking: refresh token in background to improve likelihood of successful reconnect
    try {
      supabase.auth.getSession().then(async (res) => {
        const session = res.data.session;
        if (!session?.access_token) {
          try { await supabase.auth.refreshSession(); } catch (_) {}
        }
      }).catch(() => {});
    } catch (_) {}

    // Force a fresh connection on app resume (requirement #2)
    const { forceReconnect } = get();
    if (typeof forceReconnect === 'function') {
      forceReconnect(activeGroup.id);
    } else {
      // Fallback if forceReconnect not available yet
      get().cleanupRealtimeSubscription();
      setTimeout(() => get().setupRealtimeSubscription(activeGroup.id), 100);
    }
  },

  // Central onWake(reason, groupId?) orchestrates: ensureAuthForWrites (writes only) → realtime rebuild → syncMissed → outbox
  onWake: async (reason?: string, groupIdOverride?: string) => {
    try {
      if (!FEATURES_PUSH.enabled || FEATURES_PUSH.killSwitch) {
        return get().onAppResumeSimplified();
      }

      const state = get();
      const activeGroupId = groupIdOverride || state.activeGroup?.id;
      console.log(`[push] wake reason=${reason || 'unknown'}`);

      // 1) Ensure auth for writes (non-blocking for realtime)
      const authRes = await ensureAuthForWrites();
      set({ writesBlocked: !authRes.canWrite });

      // 2) Realtime reset (non-blocking)
      if (activeGroupId) {
        console.log(`[rt] rebuild channel=group-${activeGroupId} status=REQUESTED`);
        const { forceReconnect } = get();
        if (typeof forceReconnect === 'function') {
          forceReconnect(activeGroupId);
        } else {
          get().cleanupRealtimeSubscription();
          setTimeout(() => get().setupRealtimeSubscription(activeGroupId), 50);
        }
      }

      // 3) Missed messages resync (bounded)
      if (activeGroupId && typeof (get() as any).syncMissed === 'function') {
        await (get() as any).syncMissed(activeGroupId);
      }

      // 4) Outbox drain gating on writes and network
      const net = await Network.getStatus();
      if (net.connected) {
        if (!get().writesBlocked && typeof (get() as any).processOutbox === 'function') {
          await (get() as any).processOutbox();
        } else if (get().writesBlocked) {
          console.log('[outbox] deferred reason=auth_refresh');
          setTimeout(async () => {
            const retry = await ensureAuthForWrites();
            set({ writesBlocked: !retry.canWrite });
            if (retry.canWrite && typeof (get() as any).processOutbox === 'function') {
              await (get() as any).processOutbox();
            }
          }, FEATURES_PUSH.outbox.retryShortDelayMs);
        }
      }
    } catch (e) {
      console.warn('onWake error:', e);
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
    const { processOutbox, activeGroup, connectionStatus } = get();
    
    // Process any pending messages first
    if (typeof processOutbox === 'function') {
      processOutbox().catch((e: any) => console.error('Outbox process error:', e));
    }
    
    // If we have an active group and aren't connected, reconnect
    if (activeGroup?.id && connectionStatus !== 'connected') {
      console.log('[realtime-v2] Network online - reconnecting');
      
      // Small delay to let network stabilize
      setTimeout(() => {
        get().onAppResumeSimplified();
      }, 500); // Faster than legacy 1000ms
    }
  },
  
  closeGroupDetailsPanel: () => {
    set({ showGroupDetailsPanel: false });
  },
});