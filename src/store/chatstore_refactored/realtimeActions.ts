import { supabasePipeline } from '@/lib/supabasePipeline';
import { FEATURES } from '@/lib/supabase';
import { FEATURES_PUSH } from '@/lib/featureFlags';
import { messageCache } from '@/lib/messageCache';
import { sqliteService } from '@/lib/sqliteService';
import { useAuthStore } from '@/store/authStore';
import { resetOutboxProcessingState } from './offlineActions';
import { Message, Poll, TypingUser } from './types';

type Author = { display_name: string; avatar_url: string | null };

// Minimal DB row shape for realtime payloads
interface DbMessageRow {
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
}

interface DbPollRow {
  id: string;
  message_id: string;
  question: string;
  options: string[];
  created_at: string;
  closes_at: string;
}

export interface RealtimeActions {
  setupRealtimeSubscription: (groupId: string) => Promise<void>;
  setupSimplifiedRealtimeSubscription: (groupId: string) => Promise<void>;
  cleanupRealtimeSubscription: () => void;
  sendTypingStatus: (isTyping: boolean, isGhost?: boolean) => void;
  handlePresenceSync: () => void;
  // Legacy method for backward compatibility
  ensureAuthBeforeSubscribe: (opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; reason?: string }>;
  // New simplified methods
  forceReconnect: (groupId: string) => void;
  setupAuthListener: () => () => void; // Returns cleanup function
}

export const createRealtimeActions = (set: any, get: any): RealtimeActions => {
  // Simplified state management
  const authorCache = new Map<string, Author>();
  let connectionToken: string | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let authStateListener: any = null;
  let retryCount = 0;
  const maxRetries = 5;
  let isConnecting = false; // Guard against overlapping connection attempts

  const bumpActivity = () => set({ lastActivityAt: Date.now() });
  const log = (message: string) => console.log(`[realtime-v2] ${message}`);

  // Get a usable access token with a bounded wait. Returns null if unavailable in time.
  async function getAccessTokenBounded(limitMs: number): Promise<string | null> {
    try {
      const sessionRace = Promise.race([
        (async () => {
          const client = await supabasePipeline.getDirectClient();
          const res = await client.auth.getSession();
          return res?.data?.session?.access_token || null;
        })(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(800, limitMs))),
      ]);
      let token = await sessionRace;
      if (token) return token;

      // Try refresh with abortable timeout
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(800, limitMs));
        const refreshRace = Promise.race([
          (async () => {
            const success = await supabasePipeline.refreshSession();
            if (success) {
              const client = await supabasePipeline.getDirectClient();
              const res = await client.auth.getSession();
              return res?.data?.session?.access_token || null;
            }
            return null;
          })(),
          new Promise<null>((resolve) => controller.signal.addEventListener('abort', () => resolve(null))),
        ]);
        token = await refreshRace;
        clearTimeout(timeout);
        return token || null;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  // Simple retry mechanism - 3 second timeout
  const scheduleReconnect = (groupId: string, delayMs?: number) => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    
    const backoffList = FEATURES_PUSH.enabled && !FEATURES_PUSH.killSwitch ? FEATURES_PUSH.realtime.retryBackoff : [3000, 3000, 3000];
    const maxRetries = backoffList.length;
    const nextDelay = typeof delayMs === 'number' ? delayMs : backoffList[Math.min(retryCount, backoffList.length - 1)];

    if (retryCount >= maxRetries) {
      log(`Max retries (${maxRetries}) reached, stopping reconnection attempts`);
      set({ connectionStatus: 'disconnected', isReconnecting: false });
      if (FEATURES_PUSH.enabled && !FEATURES_PUSH.killSwitch) {
        console.log(`[rt] degraded backoff=${nextDelay}`);
        // Start poll fallback
        try { (get() as any).startPollFallback?.(); } catch {}
      }
      return;
    }

    retryCount++;
    log(`Scheduling reconnect attempt ${retryCount}/${maxRetries} in ${nextDelay}ms`);
    
    set({ connectionStatus: 'reconnecting', isReconnecting: true });
    reconnectTimeout = setTimeout(() => {
      log(`Reconnect attempt ${retryCount} starting...`);
      get().setupRealtimeSubscription(groupId);
    }, nextDelay);
  };

  const resetRetryCount = () => {
    retryCount = 0;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  async function getAuthorProfile(userId: string, isGhost: boolean): Promise<Author | undefined> {
    if (isGhost) return undefined;
    const cached = authorCache.get(userId);
    if (cached) return cached;

    // Try local-first via SQLite if available
    try {
      const isNative = (await import('@capacitor/core')).Capacitor.isNativePlatform();
      if (isNative) {
        try {
          const ready = await sqliteService.isReady();
          if (ready) {
            const localUser = await sqliteService.getUser(userId);
            if (localUser) {
              const author: Author = {
                display_name: localUser.display_name,
                avatar_url: localUser.avatar_url || null,
              };
              authorCache.set(userId, author);
              return author;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    // Fallback to Supabase query (single, cached thereafter)
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data, error } = await client
        .from('users')
        .select('display_name, avatar_url')
        .eq('id', userId)
        .single();
      if (error) {
        console.warn('⚠️ Failed to fetch author profile:', error.message);
        return undefined;
      }
      const author: Author = { display_name: data.display_name, avatar_url: data.avatar_url || null };
      authorCache.set(userId, author);
      return author;
    } catch (e) {
      console.warn('⚠️ Author fetch exception:', e);
      return undefined;
    }
  }

  // Simplified heartbeat - just tracks connection health, no complex logic
  function startSimpleHeartbeat(groupId: string) {
    const existingHeartbeat = get().heartbeatTimer;
    if (existingHeartbeat) clearInterval(existingHeartbeat as any);

    const hb = setInterval(() => {
      const { realtimeChannel, connectionStatus } = get();
      
      // Simple ping via presence if connected
      if (realtimeChannel && connectionStatus === 'connected') {
        try {
          realtimeChannel.track({ heartbeat: Date.now() });
        } catch (e) {
          log('Heartbeat failed, scheduling reconnect');
          scheduleReconnect(groupId);
        }
      }
    }, 30000); // 30s heartbeat
    
    set({ heartbeatTimer: hb });
  }

  async function buildMessageFromRow(row: DbMessageRow): Promise<Message> {
    const author = await getAuthorProfile(row.user_id, row.is_ghost);
    return {
      id: row.id,
      group_id: row.group_id,
      user_id: row.user_id,
      content: row.content,
      is_ghost: row.is_ghost,
      message_type: row.message_type,
      category: row.category,
      parent_id: row.parent_id,
      image_url: row.image_url,
      created_at: row.created_at,
      author: row.is_ghost ? undefined : author,
      reply_count: 0,
      replies: [],
      delivery_status: 'delivered',
      // Do NOT attach poll here to avoid double-fetch; poll handler will attach
    } as Message;
  }

  function attachMessageToState(message: Message) {
    const state = get();

    if (message.parent_id) {
      const parentMessage = state.messages.find((m: Message) => m.id === message.parent_id);
      const replyExists = parentMessage?.replies?.some((r: Message) => r.id === message.id);
      if (!replyExists) {
        const updatedMessages = state.messages.map((m: Message) => {
          if (m.id === message.parent_id) {
            return {
              ...m,
              reply_count: (m.reply_count || 0) + 1,
              replies: [...(m.replies || []), message].slice(0, 3),
            };
          }
          return m;
        });
        set({ messages: updatedMessages });
        try {
          messageCache.setCachedMessages(message.group_id, [...updatedMessages]);
        } catch (err) {
          console.error('❌ Message cache update failed:', err);
        }
      }

      if (state.activeThread?.id === message.parent_id) {
        const threadReplyExists = state.threadReplies.some((r: Message) => r.id === message.id);
        if (!threadReplyExists) {
          const updatedReplies = [...state.threadReplies, message];
          set({ threadReplies: updatedReplies });
        }
      }
    } else {
      const exists = state.messages.some((m: Message) => m.id === message.id);
      if (!exists) {
        const messagesAfter = [...state.messages, message];
        set({ messages: messagesAfter });
        try {
          messageCache.setCachedMessages(message.group_id, [...messagesAfter]);
          console.log(`📦 MessageCache updated for group ${message.group_id} after realtime insert`);
        } catch (err) {
          console.error('❌ Message cache update failed:', err);
        }
      } else {
        const messagesAfter = state.messages.map((m: Message) => (
          m.id === message.id ? { ...m, delivery_status: 'delivered' } : m
        ));
        set({ messages: messagesAfter });
        try {
          messageCache.setCachedMessages(message.group_id, [...messagesAfter]);
        } catch (err) {
          console.error('❌ Message cache update failed:', err);
        }
      }
    }
  }

  async function handlePollInsert(pollRow: DbPollRow, currentUserId: string, groupId: string) {
    bumpActivity();
    console.log('📊 New poll received:', pollRow);

    // Verify poll belongs to the current group
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data: msgRef, error: msgErr } = await client
        .from('messages')
        .select('group_id')
        .eq('id', pollRow.message_id)
        .single();
      if (msgErr) {
        console.warn('⚠️ Could not verify poll message group:', msgErr.message);
        return;
      }
      if (!msgRef || msgRef.group_id !== groupId) return;
    } catch (e) {
      console.warn('⚠️ Poll verification failed:', e);
      return;
    }

    let votesCount = 0;
    let voteCounts: number[] = [];
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data: votes, error: votesErr } = await client
        .from('poll_votes')
        .select('option_index')
        .eq('poll_id', pollRow.id);
      if (votesErr) {
        console.warn('⚠️ Poll votes fetch error:', votesErr.message);
      }
      const options = pollRow.options as unknown as string[];
      voteCounts = new Array(options.length).fill(0);
      (votes || []).forEach(v => {
        if (typeof v.option_index === 'number' && v.option_index < voteCounts.length) {
          voteCounts[v.option_index]++;
        }
      });
      votesCount = (votes || []).length;
    } catch (e) {
      console.warn('⚠️ Poll votes fetch exception:', e);
    }

    let userVoteIndex: number | null = null;
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data: uv, error: uvErr } = await client
        .from('poll_votes')
        .select('option_index')
        .eq('poll_id', pollRow.id)
        .eq('user_id', currentUserId)
        .maybeSingle();
      if (uvErr) {
        console.warn('⚠️ Poll user vote fetch error:', uvErr.message);
      }
      userVoteIndex = uv?.option_index ?? null;
    } catch (e) {
      console.warn('⚠️ Poll user vote exception:', e);
    }

    const pollData: Poll = {
      id: pollRow.id,
      message_id: pollRow.message_id,
      question: pollRow.question,
      options: pollRow.options as unknown as string[],
      created_at: pollRow.created_at,
      closes_at: pollRow.closes_at,
      vote_counts: voteCounts,
      total_votes: votesCount,
      user_vote: userVoteIndex,
      is_closed: new Date(pollRow.closes_at) < new Date(),
    };

    const state = get();
    const exists = state.polls.some((p: Poll) => p.id === pollData.id);
    if (!exists) {
      get().addPoll(pollData);
    }

    const currentVotes = get().userVotes;
    set({ userVotes: { ...currentVotes, [pollData.id]: userVoteIndex } });

    // Attach poll to corresponding message
    const updatedMessages = state.messages.map((m: Message) => (
      m.id === pollData.message_id ? { ...m, poll: pollData } : m
    ));
    set({ messages: updatedMessages });
  }

  return {
    // Legacy method for backward compatibility
    ensureAuthBeforeSubscribe: async (_opts?: { timeoutMs?: number }) => {
      if (!FEATURES.SIMPLIFIED_REALTIME) {
        // Legacy implementation would go here
        return { ok: true };
      }
      
      // For simplified version, just check if we have a session
      try {
        const client = await supabasePipeline.getDirectClient();
        const { data: { session } } = await client.auth.getSession();
        return { ok: !!session?.access_token };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },

    setupRealtimeSubscription: async (groupId: string) => {
      if (FEATURES.SIMPLIFIED_REALTIME) {
        return await (get() as any).setupSimplifiedRealtimeSubscription(groupId);
      }
      
      // Legacy implementation would be here
      log('Using legacy realtime subscription');
    },

    setupSimplifiedRealtimeSubscription: async (groupId: string) => {
      if (isConnecting) {
        log('Connection already in progress, skipping');
        return;
      }
      
      isConnecting = true;
      log(`Setting up simplified realtime subscription for group: ${groupId}`);

      try {
        log('Skipping blocking auth check; proceeding with local auth state');

        // Use locally persisted user id for presence. Do not block on network/session.
        const authState = (useAuthStore as any)?.getState ? (useAuthStore as any).getState() : null;
        const userId: string = authState?.user?.id || 'anonymous';
        const user = { id: userId } as { id: string };

        // Ensure realtime has a valid token before subscribing (bounded wait)
        const accessToken = await getAccessTokenBounded(FEATURES_PUSH.auth.refreshTimeoutMs);
        try { 
          const client = await supabasePipeline.getDirectClient();
          (client as any).realtime?.setAuth?.(accessToken || undefined); 
        } catch (_) {}

        // Generate connection token for this attempt
        const localToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        connectionToken = localToken;

        // Clean up previous subscription
        get().cleanupRealtimeSubscription();
        set({ connectionStatus: 'connecting' });

        // Create channel with simple config and unique name
        const channelName = `group-${groupId}-${localToken}`;
        log(`Creating channel: ${channelName}`);
        
        const client = await supabasePipeline.getDirectClient();
        const channel = client.channel(channelName, {
          config: { 
            presence: { key: user.id },
            broadcast: { self: true }
          },
        });

        // Message inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}`,
        }, async (payload) => {
          if (localToken !== connectionToken) return; // Ignore stale callbacks
          bumpActivity();
          const row = payload.new as DbMessageRow;
          try {
            const message = await buildMessageFromRow(row);
            attachMessageToState(message);
            // Persist to local storage immediately to avoid disappearing on navigation
            try {
              const { Capacitor } = await import('@capacitor/core');
              const isNative = Capacitor.isNativePlatform();
              if (isNative) {
                const ready = await sqliteService.isReady();
                if (ready) {
                  await sqliteService.saveMessage({
                    id: row.id,
                    group_id: row.group_id,
                    user_id: row.user_id,
                    content: row.content,
                    is_ghost: row.is_ghost ? 1 : 0,
                    message_type: row.message_type,
                    category: row.category || null,
                    parent_id: row.parent_id || null,
                    image_url: row.image_url || null,
                    created_at: new Date(row.created_at).getTime(),
                  });
                  try { await sqliteService.updateLastSyncTimestamp(row.group_id, Date.now()); } catch {}
                }
              }
            } catch (persistErr) {
              console.warn('⚠️ Failed to persist realtime message locally:', persistErr);
            }
          } catch (e) {
            log('Failed to process message insert: ' + e);
          }
        });

        // Poll inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'polls',
        }, async (payload) => {
          if (localToken !== connectionToken) return;
          bumpActivity();
          const pollRow = payload.new as DbPollRow;
          await handlePollInsert(pollRow, user.id, groupId);
        });

        // Poll vote inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'poll_votes',
        }, async (payload) => {
          if (localToken !== connectionToken) return;
          bumpActivity();
          const vote = payload.new as { poll_id: string; user_id: string; option_index: number };
          if (vote.user_id === user.id) return; // Skip own votes
          
          const state = get();
          const updatedPolls = state.polls.map((p: Poll) => {
            if (p.id !== vote.poll_id) return p;
            const counts = [...(p.vote_counts || [])];
            if (vote.option_index < counts.length) counts[vote.option_index]++;
            return { ...p, vote_counts: counts, total_votes: (p.total_votes || 0) + 1 };
          });

          const updatedMessages = state.messages.map((m: Message) => {
            if (m.poll?.id !== vote.poll_id) return m;
            const counts = [...(m.poll?.vote_counts || [])];
            if (vote.option_index < counts.length) counts[vote.option_index]++;
            return { ...m, poll: { ...m.poll!, vote_counts: counts, total_votes: (m.poll?.total_votes || 0) + 1 } };
          });

          set({ polls: updatedPolls, messages: updatedMessages as Message[] });
        });

        // Presence events
        channel
          .on('presence', { event: 'sync' }, () => {
            if (localToken !== connectionToken) return;
            bumpActivity();
            get().handlePresenceSync();
          })
          .on('presence', { event: 'join' }, () => {
            if (localToken !== connectionToken) return;
            bumpActivity();
            get().handlePresenceSync();
          })
          .on('presence', { event: 'leave' }, () => {
            if (localToken !== connectionToken) return;
            bumpActivity();
            get().handlePresenceSync();
          })
          .subscribe(async (status) => {
            if (localToken !== connectionToken) {
              log(`Ignoring stale subscription callback: ${status}`);
              return;
            }
            
            log(`Subscription status: ${status}`);
            bumpActivity();

            if (status === 'SUBSCRIBED') {
              // Clear subscribe watchdog if set
              const { reconnectWatchdogTimer } = get();
              if (reconnectWatchdogTimer) {
                clearTimeout(reconnectWatchdogTimer as any);
                set({ reconnectWatchdogTimer: null });
              }
              resetRetryCount(); // Reset on successful connection
              resetOutboxProcessingState(); // Reset outbox state on successful connection
              isConnecting = false; // Clear the guard
              set({ 
                connectionStatus: 'connected', 
                realtimeChannel: channel, 
                subscribedAt: Date.now(),
                isReconnecting: false
              });
              log('✅ Realtime connected successfully');

              // Stop degraded poll fallback when connected
              try { (get() as any).stopPollFallback?.(); } catch {}

              startSimpleHeartbeat(groupId);

              // Process outbox after successful connection using unified system (delayed to avoid redundant triggers)
              try {
                const { triggerOutboxProcessing } = get();
                if (typeof triggerOutboxProcessing === 'function') {
                  setTimeout(() => triggerOutboxProcessing('realtime-connected', 'normal'), 1000);
                }
              } catch {}

              // Fetch messages if list is empty
              try {
                const state = get();
                if (state.messages?.length === 0 && typeof state.fetchMessages === 'function') {
                  setTimeout(() => state.fetchMessages(groupId), 150);
                }
              } catch (e) {
                log('Background message fetch failed: ' + e);
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
              // Clear subscribe watchdog if set
              const { reconnectWatchdogTimer } = get();
              if (reconnectWatchdogTimer) {
                clearTimeout(reconnectWatchdogTimer as any);
                set({ reconnectWatchdogTimer: null });
              }
              log(`❌ Connection failed with status: ${status} - Retry count: ${retryCount}/${maxRetries}`);
              isConnecting = false; // Clear the guard

              // Enhanced handling for CHANNEL_ERROR - force complete client rebuild
              if (status === 'CHANNEL_ERROR') {
                log('🔧 CHANNEL_ERROR detected - forcing complete client rebuild');
                
                // Force session refresh with duration logging for CHANNEL_ERROR
                const refreshStartTime = Date.now();
                let refreshSuccess = false;
                
                try {
                  log('🔧 CHANNEL_ERROR: Starting pipeline session refresh');
                  refreshSuccess = await supabasePipeline.refreshSession();
                  const duration = Date.now() - refreshStartTime;
                  log(`🔧 CHANNEL_ERROR: Pipeline session refresh completed in ${duration}ms: ${refreshSuccess}`);
                  
                  if (refreshSuccess) {
                    log('🔧 CHANNEL_ERROR: Session refresh successful, applying to realtime');
                    try { 
                      const client = await supabasePipeline.getDirectClient();
                      const session = await client.auth.getSession();
                      (client as any).realtime?.setAuth?.(session?.data?.session?.access_token); 
                    } catch {}
                  } else {
                    log('🔧 CHANNEL_ERROR: Session refresh failed');
                  }
                } catch (e) {
                  const duration = Date.now() - refreshStartTime;
                  log(`🔧 CHANNEL_ERROR: Session refresh error after ${duration}ms: ${e}`);
                }
                
                // If refresh failed, try one more time with longer timeout
                if (!refreshSuccess) {
                  log('🔧 CHANNEL_ERROR: Retrying session refresh with 10-second timeout');
                  const retryStartTime = Date.now();
                  
                  try {
                    refreshSuccess = await supabasePipeline.refreshSession();
                    const duration = Date.now() - retryStartTime;
                    log(`🔧 CHANNEL_ERROR: Retry session refresh completed in ${duration}ms: ${refreshSuccess}`);
                    
                    if (refreshSuccess) {
                      log('🔧 CHANNEL_ERROR: Retry session refresh successful');
                      try { 
                        const client = await supabasePipeline.getDirectClient();
                        const session = await client.auth.getSession();
                        (client as any).realtime?.setAuth?.(session?.data?.session?.access_token); 
                      } catch {}
                    }
                  } catch (retryError) {
                    log(`🔧 CHANNEL_ERROR: Retry session refresh also failed: ${retryError}`);
                  }
                }
                
                log(`🔧 CHANNEL_ERROR: Client rebuild result: ${refreshSuccess ? 'SUCCESS' : 'FAILED'}`);
              } else {
                // Standard session refresh for CLOSED/TIMED_OUT using pipeline
                let currentSession: any = null;
                try {
                  const client = await supabasePipeline.getDirectClient();
                  const res = await client.auth.getSession();
                  currentSession = res?.data?.session || null;
                } catch (_) {}
                if (!currentSession?.access_token) {
                  try {
                    const refreshed = await supabasePipeline.refreshSession();
                    if (refreshed) {
                      const client = await supabasePipeline.getDirectClient();
                      const res = await client.auth.getSession();
                      currentSession = res?.data?.session || null;
                    }
                  } catch (_) {}
                }

                // Update realtime auth with whatever token we have (may be undefined)
                try { 
                  const client = await supabasePipeline.getDirectClient();
                  (client as any).realtime?.setAuth?.(currentSession?.access_token); 
                } catch (_) {}
              }

              set({ connectionStatus: 'disconnected' });
              scheduleReconnect(groupId);
              if (FEATURES_PUSH.enabled && !FEATURES_PUSH.killSwitch) {
                console.log(`[rt] rebuild channel=group-${groupId} status=${status}`);
              }
            } else if (status === 'CONNECTING') {
              log('🔄 Channel connecting...');
              set({ connectionStatus: 'connecting' });
            } else {
              log(`⚠️ Unexpected subscription status: ${status}`);
            }
          }, 10000); // 10 second timeout

        // Subscribe watchdog: if we don't reach SUBSCRIBED within a bound, rebuild
        try {
          const watchdog = setTimeout(async () => {
            if (localToken !== connectionToken) return;
            const state = get();
            if (state.connectionStatus !== 'connected') {
              log('Subscribe watchdog timeout, rebuilding connection');
              isConnecting = false;
              try { 
                const client = await supabasePipeline.getDirectClient();
                client.removeChannel(channel); 
              } catch {}
              set({ connectionStatus: 'disconnected' });
              scheduleReconnect(groupId, 300);
            }
          }, Math.max(8000, FEATURES_PUSH.auth.refreshTimeoutMs + 500));
          set({ reconnectWatchdogTimer: watchdog as any });
        } catch {}

      } catch (error) {
        log('Setup error: ' + (error as Error).message);
        isConnecting = false; // Clear the guard
        set({ connectionStatus: 'disconnected' });
        scheduleReconnect(groupId);
      }
    },

    cleanupRealtimeSubscription: async () => {
      const { realtimeChannel, typingTimeout, heartbeatTimer, reconnectWatchdogTimer } = get();

      log('Cleaning up realtime subscription');
      isConnecting = false; // Clear connection guard
      resetOutboxProcessingState(); // Reset outbox state on cleanup

      if (typingTimeout) clearTimeout(typingTimeout);
      
      if (realtimeChannel) {
        try {
          const client = await supabasePipeline.getDirectClient();
          client.removeChannel(realtimeChannel);
        } catch (e) {
          log('Error removing channel: ' + e);
        }
        set({ realtimeChannel: null });
      }

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer as any);
        set({ heartbeatTimer: null });
      }

      if (reconnectWatchdogTimer) {
        clearTimeout(reconnectWatchdogTimer as any);
        set({ reconnectWatchdogTimer: null });
      }

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      // Clear typing users and reset status
      set({ 
        connectionStatus: 'disconnected', 
        typingUsers: [], 
        typingTimeout: null,
        subscribedAt: null,
        isReconnecting: false
      });
    },

    sendTypingStatus: (isTyping: boolean, isGhost = false) => {
      const { realtimeChannel, activeGroup, typingTimeout, connectionStatus } = get();
      if (!realtimeChannel || !activeGroup || connectionStatus !== 'connected') return;

      if (typingTimeout) clearTimeout(typingTimeout);

      if (isTyping) {
        try {
          realtimeChannel.track({ is_typing: true, is_ghost: isGhost, timestamp: Date.now() });
          const timeout = setTimeout(() => { get().sendTypingStatus(false, isGhost); }, 3000);
          set({ typingTimeout: timeout });
        } catch (e) {
          console.warn('⚠️ Failed to send typing status:', e);
        }
      } else {
        try {
          realtimeChannel.track({ is_typing: false, is_ghost: isGhost, timestamp: Date.now() });
          set({ typingTimeout: null });
        } catch (e) {
          console.warn('⚠️ Failed to send typing status:', e);
        }
      }
    },

    handlePresenceSync: () => {
      const { realtimeChannel } = get();
      if (!realtimeChannel) return;

      try {
        const presenceState = realtimeChannel.presenceState() as Record<string, Array<Record<string, unknown>>>;
        const entries = Object.entries(presenceState);
        const typingUsers: TypingUser[] = [];

        // Collect promises for any missing profiles to resolve once
        const profilePromises: Array<Promise<void>> = [];

        for (const [userId, presences] of entries) {
          const presence = (presences && presences[0]) as any;
          if (presence?.is_typing) {
            const isGhost = !!presence.is_ghost;
            const cached = authorCache.get(userId);
            if (!isGhost && !cached) {
              profilePromises.push((async () => {
                const author = await getAuthorProfile(userId, isGhost);
                if (author) authorCache.set(userId, author);
              })());
            }
          }
        }

        Promise.allSettled(profilePromises).finally(() => {
          // Build final typing users list
          for (const [userId, presences] of entries) {
            const presence = (presences && presences[0]) as any;
            if (presence?.is_typing) {
              const isGhost = !!presence.is_ghost;
              const author = isGhost ? undefined : authorCache.get(userId);
              typingUsers.push({
                user_id: userId,
                display_name: isGhost ? 'Ghost' : (author?.display_name || 'User'),
                avatar_url: author?.avatar_url ?? null,
                is_ghost: isGhost,
              });
            }
          }
          set({ typingUsers });
        });
      } catch (e) {
        console.warn('⚠️ Error in presence sync:', e);
      }
    },

    // New simplified methods
    forceReconnect: (groupId: string) => {
      const { connectionStatus } = get();
      if (connectionStatus === 'connecting') {
        log('Force reconnect requested but already connecting; skipping duplicate');
        return;
      }
      log('Force reconnect requested');
      resetRetryCount();
      get().cleanupRealtimeSubscription();
      set({ connectionStatus: 'connecting' });
      setTimeout(() => get().setupRealtimeSubscription(groupId), 150);
    },

    setupAuthListener: () => {
      if (authStateListener) {
        log('Auth listener already exists');
        return () => {
          if (authStateListener) {
            authStateListener.unsubscribe();
            authStateListener = null;
          }
        };
      }

      log('Setting up auth state listener for realtime');
      
      (async () => {
        try {
          const client = await supabasePipeline.getDirectClient();
          authStateListener = client.auth.onAuthStateChange((event, session) => {
            const state = get();
            const activeGroupId = state.activeGroup?.id;
            
            log(`Auth event: ${event}`);
            
            if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
              // Always apply the latest token to realtime
              try { (client as any).realtime?.setAuth?.(session?.access_token); } catch {}
              if (activeGroupId) {
                log('Token applied, reconnecting realtime');
                get().forceReconnect(activeGroupId);
              }
              // Reset outbox state and kick processing after token events using unified system (delayed to avoid redundant triggers)
              resetOutboxProcessingState();
              try {
                const { triggerOutboxProcessing } = get();
                if (typeof triggerOutboxProcessing === 'function') {
                  setTimeout(() => triggerOutboxProcessing('auth-token-refreshed', 'high'), 500);
                }
              } catch {}
            } else if (event === 'SIGNED_OUT') {
              log('User signed out, cleaning up realtime');
              get().cleanupRealtimeSubscription();
            }
          }).data.subscription;
        } catch (error) {
          log('Error setting up auth listener: ' + error);
        }
      })();

      return () => {
        if (authStateListener) {
          authStateListener.unsubscribe();
          authStateListener = null;
        }
      };
    },
  };
};