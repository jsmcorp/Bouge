import { Group, Message, Poll, TypingUser, GroupMember, GroupMedia } from './types';
import { supabase, FEATURES } from '@/lib/supabase';
import { FEATURES_PUSH } from '@/lib/featureFlags';
import { Network } from '@capacitor/network';
import { markDeviceUnlock } from './messageActions';

// Global session refresh debounce state
let isSessionRefreshing = false;
let sessionRefreshPromise: Promise<any> | null = null;

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

    // Mark device unlock to skip health checks
    markDeviceUnlock();
    console.log('[realtime-v2] App resumed after device unlock - forcing complete Supabase client rebuild');
    
    // CRITICAL: Force complete Supabase client rebuild with debounced session refresh
    const performClientRebuild = async () => {
      // Step 1: Debounced session refresh with duration logging
      if (isSessionRefreshing && sessionRefreshPromise) {
        console.log('[realtime-v2] Session refresh already in progress, waiting for completion...');
        try {
          await sessionRefreshPromise;
        } catch (e) {
          console.warn('[realtime-v2] Existing session refresh failed:', e);
        }
      } else {
        const refreshStartTime = Date.now();
        console.log('[realtime-v2] Starting 8-second timeout race for session refresh');
        
        isSessionRefreshing = true;
        sessionRefreshPromise = Promise.race([
          supabase.auth.refreshSession().then(result => {
            const duration = Date.now() - refreshStartTime;
            console.log(`[realtime-v2] Session refresh completed in ${duration}ms`);
            return result;
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => {
              const duration = Date.now() - refreshStartTime;
              console.log(`[realtime-v2] Session refresh timeout reached after ${duration}ms`);
              reject(new Error('Session refresh timeout after 8 seconds'));
            }, 8000)
          )
        ]);
        
        try {
          const refreshResult = await sessionRefreshPromise;
          const newToken = refreshResult?.data?.session?.access_token;
          console.log('[realtime-v2] Session refresh successful:', !!newToken);
          
          // Step 2: Complete client rebuild - apply fresh token to ALL client parts
          try { 
            (supabase as any).realtime?.setAuth?.(newToken || undefined); 
            console.log('[realtime-v2] Applied fresh token to realtime client');
          } catch {}
          
          // Step 3: Force recreate realtime connection
          const { forceReconnect } = get();
          if (typeof forceReconnect === 'function') {
            forceReconnect(activeGroup.id);
          } else {
            get().cleanupRealtimeSubscription();
            setTimeout(() => get().setupRealtimeSubscription(activeGroup.id), 100);
          }
          
          console.log('[realtime-v2] Complete client rebuild finished - ready for messaging');
        } catch (error) {
          console.warn('[realtime-v2] Session refresh failed/timed out:', error);
          
          // Retry logic with longer timeout
          console.log('[realtime-v2] Attempting retry with 10-second timeout...');
          const retryStartTime = Date.now();
          
          try {
            const retryResult = await Promise.race([
              supabase.auth.refreshSession().then(result => {
                const duration = Date.now() - retryStartTime;
                console.log(`[realtime-v2] Retry session refresh completed in ${duration}ms`);
                return result;
              }),
              new Promise<never>((_, reject) => 
                setTimeout(() => {
                  const duration = Date.now() - retryStartTime;
                  console.log(`[realtime-v2] Retry session refresh timeout reached after ${duration}ms`);
                  reject(new Error('Retry session refresh timeout after 10 seconds'));
                }, 10000)
              )
            ]);
            
            const newToken = retryResult?.data?.session?.access_token;
            console.log('[realtime-v2] Retry session refresh successful:', !!newToken);
            
            try { (supabase as any).realtime?.setAuth?.(newToken || undefined); } catch {}
          } catch (retryError) {
            console.warn('[realtime-v2] Retry session refresh also failed:', retryError);
          }
          
          // Always try to reconnect even if refresh fails
          const { forceReconnect } = get();
          if (typeof forceReconnect === 'function') {
            forceReconnect(activeGroup.id);
          }
        } finally {
          isSessionRefreshing = false;
          sessionRefreshPromise = null;
        }
      }
    };
    
    performClientRebuild().catch(e => {
      console.error('[realtime-v2] Client rebuild failed:', e);
      isSessionRefreshing = false;
      sessionRefreshPromise = null;
    });
  },

  // Central onWake(reason, groupId?) orchestrates: ensureAuthForWrites (writes only) → realtime rebuild → syncMissed → outbox
  onWake: async (reason?: string, groupIdOverride?: string) => {
    try {
      if (!FEATURES_PUSH.enabled || FEATURES_PUSH.killSwitch) {
        return get().onAppResumeSimplified();
      }

      // Mark device unlock to skip health checks
      markDeviceUnlock();
      
      const state = get();
      const activeGroupId = groupIdOverride || state.activeGroup?.id;
      console.log(`[push] wake reason=${reason || 'unknown'}`);

      // 0) Force complete Supabase client rebuild with debounced session refresh
      console.log('[push] wake - forcing complete client rebuild to fix stale client');
      let clientRebuildSuccess = false;
      
      // Debounced session refresh with duration logging
      if (isSessionRefreshing && sessionRefreshPromise) {
        console.log('[push] wake - session refresh already in progress, waiting for completion...');
        try {
          await sessionRefreshPromise;
          // Check if the existing refresh was successful
          const currentSession = await supabase.auth.getSession();
          clientRebuildSuccess = !!currentSession?.data?.session?.access_token;
        } catch (e) {
          console.warn('[push] wake - existing session refresh failed:', e);
        }
      } else {
        const refreshStartTime = Date.now();
        console.log('[push] wake - starting 8-second timeout race for session refresh');
        
        isSessionRefreshing = true;
        sessionRefreshPromise = Promise.race([
          supabase.auth.refreshSession().then(result => {
            const duration = Date.now() - refreshStartTime;
            console.log(`[push] wake - session refresh completed in ${duration}ms`);
            return result;
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => {
              const duration = Date.now() - refreshStartTime;
              console.log(`[push] wake - session refresh timeout reached after ${duration}ms`);
              reject(new Error('Session refresh timeout after 8 seconds'));
            }, 8000)
          )
        ]);
        
        try {
          const refreshResult = await sessionRefreshPromise;
          const hasNewToken = !!refreshResult?.data?.session?.access_token;
          console.log('[push] wake - session refresh completed:', hasNewToken);
          clientRebuildSuccess = hasNewToken;
          
          // Apply fresh token to complete client rebuild
          if (hasNewToken) {
            try { 
              (supabase as any).realtime?.setAuth?.(refreshResult.data.session.access_token); 
              console.log('[push] wake - applied fresh token to realtime client');
            } catch {}
          }
        } catch (e) {
          console.warn('[push] wake - session refresh failed/timed out:', e);
          
          // Retry logic with longer timeout
          console.log('[push] wake - attempting retry with 10-second timeout...');
          const retryStartTime = Date.now();
          
          try {
            const retryResult = await Promise.race([
              supabase.auth.refreshSession().then(result => {
                const duration = Date.now() - retryStartTime;
                console.log(`[push] wake - retry session refresh completed in ${duration}ms`);
                return result;
              }),
              new Promise<never>((_, reject) => 
                setTimeout(() => {
                  const duration = Date.now() - retryStartTime;
                  console.log(`[push] wake - retry session refresh timeout reached after ${duration}ms`);
                  reject(new Error('Retry session refresh timeout after 10 seconds'));
                }, 10000)
              )
            ]);
            
            const hasNewToken = !!retryResult?.data?.session?.access_token;
            console.log('[push] wake - retry session refresh completed:', hasNewToken);
            clientRebuildSuccess = hasNewToken;
            
            if (hasNewToken && retryResult.data?.session) {
              try { (supabase as any).realtime?.setAuth?.(retryResult.data.session.access_token); } catch {}
            }
          } catch (retryError) {
            console.warn('[push] wake - retry session refresh also failed:', retryError);
          }
        } finally {
          isSessionRefreshing = false;
          sessionRefreshPromise = null;
        }
      }
      
      set({ writesBlocked: !clientRebuildSuccess });
      console.log('[push] wake - client rebuild result:', clientRebuildSuccess ? 'SUCCESS' : 'FAILED');

      // 1) Reset outbox processing state only after confirmed client rebuild success
      if (clientRebuildSuccess) {
        try {
          const { resetOutboxProcessingState } = await import('./offlineActions');
          resetOutboxProcessingState();
          console.log('[push] wake - outbox state reset after successful client rebuild');
        } catch (e) {
          console.warn('Failed to reset outbox state on wake:', e);
        }
      } else {
        console.log('[push] wake - skipping outbox reset due to client rebuild failure');
      }

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

      // 4) Outbox drain with refreshed session
      const net = await Network.getStatus();
      if (net.connected && !get().writesBlocked) {
        console.log('[push] wake - triggering outbox processing with fresh session');
        const { triggerOutboxProcessing } = get();
        if (typeof triggerOutboxProcessing === 'function') {
          triggerOutboxProcessing('wake-session-refreshed', 'high');
        }
      } else {
        console.log('[push] wake - skipping outbox processing:', { online: net.connected, writesBlocked: get().writesBlocked });
      }
    } catch (e) {
      console.warn('onWake error:', e);
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
    const { triggerOutboxProcessing, activeGroup, connectionStatus } = get();
    
    // Only trigger outbox processing, don't reset state as that causes redundant triggers
    console.log('[realtime-v2] Network online - triggering outbox processing only');
    if (typeof triggerOutboxProcessing === 'function') {
      triggerOutboxProcessing('network-online', 'high');
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