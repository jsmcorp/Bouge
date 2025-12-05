import { Group, Message, Poll, TypingUser, GroupMember, GroupMedia } from './types';
import { FEATURES } from '@/lib/supabase';

// Resume/unlock flow is owned exclusively by supabasePipeline.onAppResume()

export interface StateActions {
  setGroups: (groups: Group[]) => void;
  setActiveGroup: (group: Group | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  appendMessageWithDedupe: (message: Message) => void;
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
  // Message selection
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleMessageSelection: (messageId: string) => void;
  clearSelection: () => void;
  selectAllMessages: () => void;
  // Unread tracking
  clearUnreadSeparator: () => void;
  // Topic management
  setActiveTopicId: (topicId: string | null) => void;
}

export const createStateActions = (set: any, get: any): StateActions => ({
  setGroups: (groups) => set({ groups }),
  
  setActiveGroup: (group) => {
    // CRITICAL FIX: DON'T cleanup subscription when switching groups
    // Multi-group subscription stays alive for all groups
    // Only cleanup when user logs out or app closes
    // if (currentGroup && currentGroup.id !== group?.id) {
    //   get().cleanupRealtimeSubscription();
    // }

    const currentGroup = get().activeGroup;
    const isSwitchingToNewGroup = currentGroup && group && currentGroup.id !== group.id;

    // CRITICAL: Notify native service of active group change for notification suppression
    import('@/lib/push').then(({ setActiveGroupId }) => {
      setActiveGroupId(group?.id || null).catch((err) => {
        console.error('[chat] Failed to set active group ID for push:', err);
      });
    }).catch(() => {
      // Ignore import errors (e.g., on web)
    });

    // CRITICAL FIX: Only clear groupMembers/groupMedia when switching to a DIFFERENT group
    // Don't clear when setting the same group (prevents race condition with fetchGroupMembers)
    const stateUpdate: any = {
      activeGroup: group,
      messages: [],
      polls: [],
      userVotes: {},
      typingUsers: [],
      showGroupDetailsPanel: false,
      // CRITICAL FIX: Keep connection status - don't reset to 'disconnected'
      // connectionStatus: 'disconnected',
      isReconnecting: false,
      reconnectAttempt: 0,
      // Invalidate any in-flight fetches for previous group
      fetchToken: null,
      currentFetchGroupId: null,
      isLoading: false
    };

    // Only clear groupMembers and groupMedia when switching to a different group
    if (isSwitchingToNewGroup || !currentGroup) {
      stateUpdate.groupMembers = [];
      stateUpdate.groupMedia = [];
    }

    set(stateUpdate);

    // Setup subscription if not already connected, and fetch polls
    if (group) {
      // Small delay to ensure state is clean
      setTimeout(() => {
        // Only setup subscription if not already connected
        const { connectionStatus } = get();
        if (connectionStatus !== 'connected') {
          get().setupRealtimeSubscription(group.id);
        }
        get().fetchPollsForGroup(group.id);
      }, 100);
    }
  },

  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state: any) => ({
    messages: [...state.messages, message]
  })),

  appendMessageWithDedupe: (message) => set((state: any) => {
    const exists = state.messages.some((m: Message) => m.id === message.id);
    const next = exists
      ? state.messages.map((m: Message) => (m.id === message.id ? { ...m, ...message } : m))
      : [...state.messages, message];
    const sorted = [...next].sort((a: Message, b: Message) => {
      const ta = Number(a.created_at);
      const tb = Number(b.created_at);
      if (ta === tb) return 0;
      return ta < tb ? -1 : 1;
    });
    const capped = sorted.slice(Math.max(0, sorted.length - 50));
    return { messages: capped };
  }),
  
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

    // CRITICAL: Refresh messages to recalculate unread separator
    // This ensures the separator shows correctly after app resume/unlock
    console.log('[unread] 🔄 App resumed - refreshing messages to recalculate unread separator');
    const state = get() as any;
    if (typeof state.fetchMessages === 'function') {
      // Use setTimeout to avoid blocking the resume flow
      setTimeout(() => {
        state.fetchMessages(activeGroup.id);
      }, 100);
    }
  },

  // WHATSAPP-STYLE: Wake handler with instant message display
  // Called when FCM notification arrives or app resumes from background
  onWake: async (reason?: string, groupIdOverride?: string) => {
    try {
      console.log(`[realtime-v2] Wake event: ${reason || 'unknown'}`);

      const state = get();
      const connectionStatus = state.connectionStatus;

      // WHATSAPP-STYLE: If groupId provided and it's the active group, refresh UI from SQLite immediately
      if (groupIdOverride && state.activeGroup?.id === groupIdOverride) {
        console.log(`[realtime-v2] 📬 New message in active group ${groupIdOverride} - refreshing UI from SQLite`);
        if (typeof state.refreshUIFromSQLite === 'function') {
          const start = performance.now();
          await state.refreshUIFromSQLite(groupIdOverride);
          const dur = Math.round(performance.now() - start);
          console.log(`[ui] refresh group=${groupIdOverride} dur=${dur}ms mode=fast-path`);
        }
      } else if (groupIdOverride) {
        console.log(`[realtime-v2] 📨 New message in background group ${groupIdOverride} - staying on current screen`);
        // Increment unread count for background group
        try {
          if (typeof (window as any).__incrementUnreadCount === 'function') {
            (window as any).__incrementUnreadCount(groupIdOverride);
          }
        } catch (err) {
          console.error('[realtime-v2] Failed to increment unread count:', err);
        }
      }

      // Resume connection
      get().onAppResumeSimplified();

      // Trigger outbox processing immediately (send pending messages)
      try {
        const { triggerOutboxProcessing } = await import('./offlineActions');
        triggerOutboxProcessing('onWake', 'immediate');
      } catch (error) {
        console.error('[realtime-v2] Failed to trigger outbox processing:', error);
      }

      // PUSH-FIRST FAST PATH: Always fetch missed messages, dedupe handled by SQLite existence check
      // This ensures background push notifications always trigger immediate refresh
      // The messageExists check in backgroundMessageSync prevents duplicate fetches
      try {
        const { backgroundMessageSync } = await import('@/lib/backgroundMessageSync');
        console.log('[realtime-v2] Fetching missed messages for all groups...');
        const results = await backgroundMessageSync.fetchMissedMessagesForAllGroups();
        const totalMissed = Object.values(results).reduce((sum, count) => sum + count, 0);
        console.log(`[realtime-v2] ✅ Fetched ${totalMissed} missed messages across ${Object.keys(results).length} groups`);

        // Update unread counts for all groups that received messages
        if (totalMissed > 0) {
          try {
            if (typeof (window as any).__incrementUnreadCount === 'function') {
              for (const [gId, count] of Object.entries(results)) {
                if (count > 0) {
                  // Increment for each missed message
                  for (let i = 0; i < count; i++) {
                    (window as any).__incrementUnreadCount(gId);
                  }
                  console.log(`[realtime-v2] 📊 Incremented unread count for group ${gId} by ${count}`);
                }
              }
            }
          } catch (error) {
            console.warn('[realtime-v2] Failed to increment unread counts:', error);
          }
        }
      } catch (error) {
        console.error('[realtime-v2] Error fetching missed messages:', error);
      }

      // Ensure realtime is reconnected (if it was dead)
      if (connectionStatus !== 'connected' && state.activeGroup?.id) {
        console.log(`[realtime-v2] 🔄 Realtime not connected (${connectionStatus}), forcing reconnection`);
        if (typeof state.setupSimplifiedRealtimeSubscription === 'function') {
          await state.setupSimplifiedRealtimeSubscription(state.activeGroup.id);
        }
      }

      console.log(`[realtime-v2] ✅ Wake handling complete`);
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

    // CRITICAL: Schedule heartbeat stop after 10s of device lock
    // This saves battery and reduces concurrent connections
    setTimeout(() => {
      console.log('[lifecycle] 10s since pause - stopping heartbeat to save resources');
      try {
        const state = get() as any;
        if (typeof state.stopHeartbeatForLock === 'function') {
          state.stopHeartbeatForLock();
        }
      } catch (e) {
        console.warn('Failed to stop heartbeat on lock:', e);
      }
    }, 10000); // 10 seconds
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

    // CRITICAL: Schedule realtime cleanup after 30s in background
    // This saves concurrent connections and resources
    setTimeout(() => {
      console.log('[lifecycle] 30s in background - stopping heartbeat and cleaning up realtime');
      try {
        const state = get() as any;
        // Stop heartbeat first
        if (typeof state.stopHeartbeatForBackground === 'function') {
          state.stopHeartbeatForBackground();
        }
        // Then cleanup realtime connection
        if (typeof state.cleanupRealtimeForBackground === 'function') {
          state.cleanupRealtimeForBackground();
        }
      } catch (e) {
        console.warn('Failed to cleanup realtime on background:', e);
      }
    }, 30000); // 30 seconds
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

  // Message selection actions
  enterSelectionMode: () => {
    set({ selectionMode: true, selectedMessageIds: new Set() });
  },

  exitSelectionMode: () => {
    set({ selectionMode: false, selectedMessageIds: new Set() });
  },

  toggleMessageSelection: (messageId: string) => {
    set((state: any) => {
      const newSelection = new Set(state.selectedMessageIds);
      if (newSelection.has(messageId)) {
        newSelection.delete(messageId);
      } else {
        newSelection.add(messageId);
      }
      return { selectedMessageIds: newSelection };
    });
  },

  clearSelection: () => {
    set({ selectedMessageIds: new Set() });
  },

  selectAllMessages: () => {
    set((state: any) => {
      const allMessageIds = new Set(state.messages.map((m: Message) => m.id));
      return { selectedMessageIds: allMessageIds };
    });
  },

  // WhatsApp-style: Clear unread separator instantly when opening chat
  clearUnreadSeparator: () => {
    console.log('[unread] 🧹 Clearing unread separator instantly (WhatsApp style)');
    set({ 
      firstUnreadMessageId: null,
      unreadCount: 0 
    });
  },

  // Set active topic ID for topic chat
  setActiveTopicId: (topicId) => {
    console.log('[topics] Setting active topic ID:', topicId);
    set({ activeTopicId: topicId });
  },
});
