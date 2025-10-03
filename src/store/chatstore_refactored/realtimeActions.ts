import { supabasePipeline } from '@/lib/supabasePipeline';
import { FEATURES } from '@/lib/supabase';
import { FEATURES_PUSH } from '@/lib/featureFlags';
import { messageCache } from '@/lib/messageCache';
import { sqliteService } from '@/lib/sqliteService';
import { useAuthStore } from '@/store/authStore';
import { resetOutboxProcessingState } from './offlineActions';
import { Message, Poll, TypingUser } from './types';
import { webViewLifecycle } from '@/lib/webViewLifecycle';
import { mobileLogger } from '@/lib/mobileLogger';
import { unreadTracker } from '@/lib/unreadTracker';

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
  dedupe_key?: string | null;
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
  ensureSubscribedFastPath: (groupId: string) => Promise<void>;
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
  let authStateListener: any = null;
  let isConnecting = false; // Guard against overlapping connection attempts
  let lastForceReconnectAt = 0; // Debounce force reconnects
  let cleanupTimer: NodeJS.Timeout | null = null; // Fix #5: 5s delay before cleanup

  // CRITICAL FIX: Exponential backoff and circuit breaker for realtime reconnection
  let retryCount = 0;
  const maxRetries = 5;
  let circuitBreakerOpen = false;
  let circuitBreakerTimer: NodeJS.Timeout | null = null;

  // CRITICAL FIX (LOG46 Phase 3): Heartbeat mechanism to detect realtime death
  let lastRealtimeEventAt = Date.now();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatCheckTimer: NodeJS.Timeout | null = null;
  const HEARTBEAT_INTERVAL_MS = 30000; // Send heartbeat every 30 seconds
  const HEARTBEAT_TIMEOUT_MS = 60000; // Consider dead if no events for 60 seconds

  // CRITICAL FIX (LOG47): Track realtime death time to fetch missed messages
  let realtimeDeathAt: number | null = null;

  const bumpActivity = () => set({ lastActivityAt: Date.now() });
  const log = (message: string) => console.log(`[realtime-v2] ${message}`);

  // CRITICAL FIX (LOG46 Phase 3): Heartbeat functions to detect and recover from realtime death
  const updateLastEventTime = () => {
    lastRealtimeEventAt = Date.now();
  };

  const startHeartbeat = (channel: any, groupId: string) => {
    log('💓 Starting heartbeat mechanism');

    // Clear any existing timers
    stopHeartbeat();

    // Send heartbeat every 30 seconds
    heartbeatTimer = setInterval(() => {
      const { connectionStatus } = get();
      if (connectionStatus === 'connected' && channel) {
        try {
          channel.send({
            type: 'broadcast',
            event: 'heartbeat',
            payload: { timestamp: Date.now() }
          });
          log('💓 Heartbeat sent');
        } catch (error) {
          log(`💓 Heartbeat send failed: ${error}`);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Check for realtime death every 10 seconds
    heartbeatCheckTimer = setInterval(() => {
      const { connectionStatus } = get();
      const timeSinceLastEvent = Date.now() - lastRealtimeEventAt;

      if (connectionStatus === 'connected' && timeSinceLastEvent > HEARTBEAT_TIMEOUT_MS) {
        log(`⚠️ Realtime appears DEAD (no events for ${Math.round(timeSinceLastEvent / 1000)}s)`);
        log('🔄 Forcing reconnection due to realtime death');

        // Stop heartbeat before reconnecting
        stopHeartbeat();

        // Force reconnection
        forceRealtimeRecovery(groupId);
      }
    }, 10000); // Check every 10 seconds
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      log('💓 Heartbeat stopped');
    }
    if (heartbeatCheckTimer) {
      clearInterval(heartbeatCheckTimer);
      heartbeatCheckTimer = null;
      log('💓 Heartbeat check stopped');
    }
  };

  const forceRealtimeRecovery = async (groupId: string) => {
    log('🔧 CRITICAL: Forcing realtime recovery');

    // CRITICAL FIX (LOG47): Track when realtime died to fetch missed messages later
    realtimeDeathAt = Date.now();
    log(`🔧 Realtime died at: ${new Date(realtimeDeathAt).toISOString()}`);

    // Step 1: Cleanup current subscription
    const { realtimeChannel } = get();
    if (realtimeChannel) {
      try {
        const client = await supabasePipeline.getDirectClient();
        await client.removeChannel(realtimeChannel);
        log('🔧 Removed dead channel');
      } catch (error) {
        log(`🔧 Error removing dead channel: ${error}`);
      }
      set({ realtimeChannel: null });
    }

    // Step 2: Force session refresh
    log('🔧 Forcing session refresh');
    try {
      await supabasePipeline.refreshSessionDirect();
      log('🔧 Session refreshed successfully');
    } catch (error) {
      log(`🔧 Session refresh failed: ${error}`);
    }

    // Step 3: Recreate subscription with exponential backoff
    log('🔧 Recreating subscription');
    set({ connectionStatus: 'reconnecting' });

    // Use handleChannelError for exponential backoff logic
    handleChannelError(groupId);
  };

  // CRITICAL FIX (LOG47): Fetch missed messages after realtime reconnection
  const fetchMissedMessagesSinceRealtimeDeath = async (groupIds: string[], deathTimestamp: number) => {
    const deathTime = new Date(deathTimestamp).toISOString();
    log(`🔄 Fetching missed messages since realtime death: ${deathTime}`);

    try {
      const client = await supabasePipeline.getDirectClient();

      // Fetch all messages sent after realtime died
      const { data: missedMessages, error } = await client
        .from('messages')
        .select(`
          *,
          reactions(*),
          author:users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .in('group_id', groupIds)
        .gte('created_at', deathTime)
        .order('created_at', { ascending: true });

      if (error) {
        log(`❌ Error fetching missed messages: ${error.message}`);
        return;
      }

      if (!missedMessages || missedMessages.length === 0) {
        log('✅ No missed messages found');
        return;
      }

      log(`📥 Found ${missedMessages.length} missed messages, saving to SQLite...`);

      // Save each message to SQLite
      for (const msg of missedMessages) {
        try {
          const { Capacitor } = await import('@capacitor/core');
          const isNative = Capacitor.isNativePlatform();
          if (isNative) {
            const ready = await sqliteService.isReady();
            if (ready) {
              await sqliteService.saveMessage({
                id: msg.id,
                group_id: msg.group_id,
                user_id: msg.user_id,
                content: msg.content,
                is_ghost: msg.is_ghost ? 1 : 0,
                message_type: msg.message_type,
                category: msg.category || null,
                parent_id: msg.parent_id || null,
                image_url: msg.image_url || null,
                created_at: new Date(msg.created_at).getTime(),
              });
              log(`✅ Saved missed message to SQLite: ${msg.id}`);
            }
          }
        } catch (error) {
          log(`❌ Error saving missed message ${msg.id}: ${error}`);
        }
      }

      // If any messages are for the active group, refresh the message list
      const { activeGroup } = get();
      const hasActiveGroupMessages = missedMessages.some((m: { group_id: string }) => m.group_id === activeGroup?.id);

      if (hasActiveGroupMessages && typeof get().fetchMessages === 'function') {
        const activeGroupMsgCount = missedMessages.filter((m: { group_id: string }) => m.group_id === activeGroup?.id).length;
        log(`🔄 Refreshing message list for active group (found ${activeGroupMsgCount} missed messages)`);
        setTimeout(() => get().fetchMessages(activeGroup.id), 500);
      }

      log('✅ Missed message fetch complete');

    } catch (error) {
      log(`❌ Exception in fetchMissedMessagesSinceRealtimeDeath: ${error}`);
    }
  };

  // Simplified connection monitoring - rely on Supabase's built-in reconnection with Web Worker heartbeats

  // Get a usable access token with a bounded wait. Returns null if unavailable in time.
  async function getAccessTokenBounded(limitMs: number): Promise<string | null> {
    try {
      const sessionRace = Promise.race([
        (async () => {
          const session = await supabasePipeline.getWorkingSession();
          return session?.access_token || null;
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
            const success = await supabasePipeline.recoverSession();
            if (success) {
              const session = await supabasePipeline.getWorkingSession();
              return session?.access_token || null;
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

  // CRITICAL FIX: Simplified reconnection with exponential backoff and circuit breaker
  const handleChannelError = (groupId: string) => {
    log('Channel error detected, cleaning up and attempting reconnection');

    // Clean up current channel
    const { realtimeChannel } = get();
    if (realtimeChannel) {
      try {
        supabasePipeline.getDirectClient().then(client => {
          client.removeChannel(realtimeChannel);
        });
      } catch (e) {
        log('Error removing failed channel: ' + e);
      }
      set({ realtimeChannel: null });
    }

    // Check if circuit breaker is open
    if (circuitBreakerOpen) {
      log('⚠️ Circuit breaker is open, skipping reconnection attempt');
      set({ connectionStatus: 'disconnected' });
      return;
    }

    // Check if we should attempt reconnection
    const { online } = get();
    if (!online) {
      log('Device offline, will reconnect when network returns');
      set({ connectionStatus: 'disconnected' });
      return;
    }

    // Increment retry count
    retryCount++;
    log(`Reconnection attempt ${retryCount}/${maxRetries}`);

    // Check if we've exceeded max retries
    if (retryCount >= maxRetries) {
      log(`❌ Max retries (${maxRetries}) exceeded, opening circuit breaker for 5 minutes`);
      circuitBreakerOpen = true;
      set({ connectionStatus: 'disconnected' });

      // Close circuit breaker after 5 minutes
      circuitBreakerTimer = setTimeout(() => {
        log('✅ Circuit breaker closed, allowing reconnection attempts');
        circuitBreakerOpen = false;
        retryCount = 0;
        circuitBreakerTimer = null;

        // Attempt reconnection after circuit breaker closes
        const { activeGroup } = get();
        if (activeGroup?.id) {
          log('🔄 Circuit breaker closed, attempting reconnection');
          handleChannelError(activeGroup.id);
        }
      }, 5 * 60 * 1000); // 5 minutes

      return;
    }

    // Calculate exponential backoff delay
    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000); // Max 30 seconds
    log(`⏳ Retrying reconnection in ${delay}ms (exponential backoff)`);

    // Schedule reconnection with exponential backoff
    setTimeout(() => {
      log(`🔄 Executing scheduled reconnection (attempt ${retryCount}/${maxRetries})`);
      const { activeGroup } = get();
      if (activeGroup?.id === groupId) {
        (get() as any).setupSimplifiedRealtimeSubscription(groupId);
      } else {
        log('⚠️ Active group changed, skipping reconnection');
      }
    }, delay);

    // Simple reconnection attempt after a brief delay
    set({ connectionStatus: 'reconnecting' });
    setTimeout(() => {
      log('Attempting to reestablish connection');
      get().setupRealtimeSubscription(groupId);
    }, 2000);
  };

  // Simplified connection management - no complex retry counting needed

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

  // No custom heartbeat needed - Supabase Web Worker handles this automatically

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
      dedupe_key: row.dedupe_key ?? null,
      // Do NOT attach poll here to avoid double-fetch; poll handler will attach
    } as Message;
  }

  function attachMessageToState(message: Message) {
    const state = get();

    if (message.parent_id) {
      const parentMessage = state.messages.find((m: Message) => m.id === message.parent_id);

      // If parent present, attempt dedupe/replace by dedupe_key first
      if (parentMessage) {
        const replies = parentMessage.replies || [];
        const idxByDedupe = message.dedupe_key
          ? replies.findIndex((r: Message) => r.dedupe_key && r.dedupe_key === message.dedupe_key)
          : -1;
        const existsById = replies.some((r: Message) => r.id === message.id);

        let updatedMessages: Message[] = state.messages;

        if (idxByDedupe !== -1) {
          // Replace optimistic reply with server reply; do NOT increment reply_count
          updatedMessages = state.messages.map((m: Message) => {
            if (m.id !== message.parent_id) return m;
            const newReplies = [...(m.replies || [])];
            newReplies[idxByDedupe] = message;
            return { ...m, replies: newReplies } as Message;
          });
        } else if (!existsById) {
          // Append new reply and increment reply_count; keep only first 3 in preview
          updatedMessages = state.messages.map((m: Message) => {
            if (m.id !== message.parent_id) return m;
            const newReplies = [...(m.replies || []), message];
            return {
              ...m,
              reply_count: (m.reply_count || 0) + 1,
              replies: newReplies.slice(0, 3),
            } as Message;
          });
        } else {
          // Already present by id – ensure status is delivered
          updatedMessages = state.messages.map((m: Message) => {
            if (m.id !== message.parent_id) return m;
            const newReplies = (m.replies || []).map((r: Message) => (
              r.id === message.id ? { ...r, delivery_status: 'delivered' as const } : r
            ));
            return { ...m, replies: newReplies } as Message;
          });
        }

        set({ messages: updatedMessages });
        try {
          messageCache.setCachedMessages(message.group_id, [...updatedMessages]);
        } catch (err) {
          console.error('❌ Message cache update failed:', err);
        }

        // Update active thread replies if open
        if (state.activeThread?.id === message.parent_id) {
          const idxThreadByDedupe = message.dedupe_key
            ? state.threadReplies.findIndex((r: Message) => r.dedupe_key && r.dedupe_key === message.dedupe_key)
            : -1;
          const existsThreadById = state.threadReplies.some((r: Message) => r.id === message.id);
          if (idxThreadByDedupe !== -1) {
            const updatedReplies = [...state.threadReplies];
            updatedReplies[idxThreadByDedupe] = message;
            set({ threadReplies: updatedReplies });
          } else if (!existsThreadById) {
            set({ threadReplies: [...state.threadReplies, message] });
          } else {
            const updatedReplies = state.threadReplies.map((r: Message) => (
              r.id === message.id ? { ...r, delivery_status: 'delivered' as const } : r
            ));
            set({ threadReplies: updatedReplies });
          }
        }
      }
    } else {
      // Root message: dedupe by id first, then by dedupe_key
      const existsById = state.messages.some((m: Message) => m.id === message.id);
      let messagesAfter: Message[] = state.messages;
      let action = '';
      let oldMessageId: string | null = null;

      if (existsById) {
        action = 'updated-existing';
        messagesAfter = state.messages.map((m: Message) => (
          m.id === message.id ? { ...m, delivery_status: 'delivered' } : m
        ));
      } else {
        const idxByDedupe = message.dedupe_key
          ? state.messages.findIndex((m: Message) => m.dedupe_key && m.dedupe_key === message.dedupe_key)
          : -1;
        if (idxByDedupe !== -1) {
          action = 'replaced-by-dedupe';
          // Capture the old message ID before replacing
          oldMessageId = state.messages[idxByDedupe].id;
          messagesAfter = state.messages.map((m: Message, idx: number) => (
            idx === idxByDedupe ? { ...message } : m
          ));
        } else {
          action = 'added-new';
          messagesAfter = [...state.messages, message];
        }
      }

      console.log(`📨 attachMessageToState: action=${action}, id=${message.id}, oldId=${oldMessageId}, before=${state.messages.length}, after=${messagesAfter.length}`);

      set({ messages: messagesAfter });
      try {
        messageCache.setCachedMessages(message.group_id, [...messagesAfter]);
        console.log(`📦 MessageCache updated for group ${message.group_id} after realtime insert (${messagesAfter.length} messages)`);
      } catch (err) {
        console.error('❌ Message cache update failed:', err);
      }

      // If we replaced a message by dedupe, delete the old optimistic message from SQLite
      if (oldMessageId && action === 'replaced-by-dedupe') {
        (async () => {
          try {
            const { Capacitor } = await import('@capacitor/core');
            const isNative = Capacitor.isNativePlatform();
            if (isNative) {
              const { sqliteService } = await import('@/lib/sqliteService');
              const ready = await sqliteService.isReady();
              if (ready) {
                await sqliteService.deleteMessage(oldMessageId);
                console.log(`🗑️ Deleted old optimistic message from SQLite: ${oldMessageId} (replaced by server message: ${message.id})`);
              }
            }
          } catch (err) {
            console.warn(`⚠️ Failed to delete old optimistic message ${oldMessageId} from SQLite:`, err);
          }
        })();
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
      (votes || []).forEach((v: { option_index: number }) => {
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
      // Fix #5: Cancel any pending cleanup timer when setting up new subscription
      if (cleanupTimer) {
        log('Canceling pending cleanup timer (reusing connection)');
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }

      if (isConnecting) {
        log('Connection already in progress, skipping');
        return;
      }

      // Check WebView readiness first
      mobileLogger.log('info', 'webview', 'Checking WebView readiness for realtime setup');
      const webViewReady = await webViewLifecycle.waitForReady(5000);
      if (!webViewReady) {
        log('WebView not ready, skipping realtime setup');
        mobileLogger.log('warn', 'webview', 'WebView not ready for realtime setup');
        set({ connectionStatus: 'disconnected' });
        return;
      }

      // Check network connectivity using cached status from store
      const { online } = get();
      if (!online) {
        log('Device is offline (cached status), skipping realtime setup');
        set({ connectionStatus: 'disconnected' });
        return;
      }

      // CRITICAL FIX: Check if we already have a healthy connection for ALL groups
      // Don't recreate subscription if we're already connected
      const { connectionStatus, realtimeChannel } = get();
      if (connectionStatus === 'connected' && realtimeChannel) {
        log('Already connected to realtime (multi-group subscription), skipping setup');
        return;
      }

      isConnecting = true;

      // CRITICAL FIX: Get ALL user's groups for multi-group subscription
      const { groups } = get();
      const allGroupIds = groups.map((g: any) => g.id);

      if (allGroupIds.length === 0) {
        log('No groups found, skipping realtime setup');
        isConnecting = false;
        set({ connectionStatus: 'disconnected' });
        return;
      }

      log(`Setting up multi-group realtime subscription for ${allGroupIds.length} groups (active: ${groupId})`);
      mobileLogger.startTiming('realtime-setup', 'connection', { groupId, totalGroups: allGroupIds.length });

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

        // Only clean up if we're not already connecting to avoid excessive teardown
        if (connectionStatus !== 'connecting') {
          get().cleanupRealtimeSubscription();
        }
        set({ connectionStatus: 'connecting' });

        // Update WhatsApp-style connection status
        try {
          const { whatsappConnection } = await import('@/lib/whatsappStyleConnection');
          whatsappConnection.setConnectionState('connecting', 'Connecting...');
        } catch {}

        // CRITICAL FIX: Create multi-group channel with ALL user's groups
        const channelName = `multi-group-${user.id}-${localToken}`;
        log(`Creating multi-group channel: ${channelName} (${allGroupIds.length} groups)`);

        const client = await supabasePipeline.getDirectClient();
        const channel = client.channel(channelName, {
          config: {
            presence: { key: user.id },
            broadcast: { self: true }
          },
        });

        // CRITICAL FIX: Subscribe to messages for ALL user's groups
        // This ensures messages are received even when user is in a different group
        const groupFilter = allGroupIds.length === 1
          ? `group_id=eq.${allGroupIds[0]}`
          : `group_id=in.(${allGroupIds.join(',')})`;

        log(`📡 Subscribing to messages with filter: ${groupFilter}`);

        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages', filter: groupFilter,
        }, async (payload: any) => {
          // CRITICAL FIX: Removed token mismatch check to prevent message loss
          // The check was too aggressive and caused legitimate messages to be discarded
          // Duplicate detection is handled by:
          // 1. dedupe_key in message data
          // 2. attachMessageToState() logic (lines 354-363)
          // 3. SQLite INSERT OR REPLACE

          bumpActivity();
          updateLastEventTime(); // CRITICAL FIX (LOG46 Phase 3): Update heartbeat timestamp
          const row = payload.new as DbMessageRow;

          log(`📨 Realtime INSERT received: id=${row.id}, group=${row.group_id}, content="${row.content?.substring(0, 20)}...", user=${row.user_id}, dedupe=${row.dedupe_key || 'none'}`);

          try {
            const message = await buildMessageFromRow(row);
            log(`📨 Built message from row: id=${message.id}, group=${message.group_id}, delivery_status=${message.delivery_status}`);

            // CRITICAL FIX: Only attach message to state if it's for the active group
            // Messages for other groups are still saved to SQLite but not added to React state
            const currentState = get();
            const isForActiveGroup = currentState.activeGroup?.id === row.group_id;

            if (isForActiveGroup) {
              attachMessageToState(message);
              log(`📨 Message attached to state: id=${message.id} (active group)`);
            } else {
              log(`📨 Message NOT attached to state: id=${message.id} (different group: ${row.group_id})`);
            }

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
                  log(`📨 Message persisted to SQLite: id=${row.id}`);
                  try { await sqliteService.updateLastSyncTimestamp(row.group_id, Date.now()); } catch {}
                }
              }
            } catch (persistErr) {
              console.warn('⚠️ Failed to persist realtime message locally:', persistErr);
            }

            // ✅ Update unread count if message is from another user and user is not in this group's chat
            try {
              const currentState = get();
              const isInActiveChat = currentState.activeGroup?.id === row.group_id;
              const isOwnMessage = row.user_id === user.id;

              if (!isOwnMessage && !isInActiveChat) {
                // User is not viewing this group, so increment unread count
                const newCount = await unreadTracker.getUnreadCount(row.group_id);
                log(`📊 Unread count updated for group ${row.group_id}: ${newCount}`);
              }
            } catch (unreadErr) {
              console.warn('⚠️ Failed to update unread count:', unreadErr);
            }
          } catch (e) {
            log('❌ Failed to process message insert: ' + e);
          }
        });

        // Poll inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'polls',
        }, async (payload: any) => {
          if (localToken !== connectionToken) return;
          bumpActivity();
          updateLastEventTime(); // CRITICAL FIX (LOG46 Phase 3): Update heartbeat timestamp
          const pollRow = payload.new as DbPollRow;
          await handlePollInsert(pollRow, user.id, groupId);
        });

        // Poll vote inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'poll_votes',
        }, async (payload: any) => {
          if (localToken !== connectionToken) return;
          bumpActivity();
          updateLastEventTime(); // CRITICAL FIX (LOG46 Phase 3): Update heartbeat timestamp
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
            updateLastEventTime(); // CRITICAL FIX (LOG46 Phase 3): Update heartbeat timestamp
            get().handlePresenceSync();
          })
          .on('presence', { event: 'join' }, () => {
            if (localToken !== connectionToken) return;
            bumpActivity();
            updateLastEventTime(); // CRITICAL FIX (LOG46 Phase 3): Update heartbeat timestamp
            get().handlePresenceSync();
          })
          .on('presence', { event: 'leave' }, () => {
            if (localToken !== connectionToken) return;
            bumpActivity();
            updateLastEventTime(); // CRITICAL FIX (LOG46 Phase 3): Update heartbeat timestamp
            get().handlePresenceSync();
          })
          .subscribe(async (status: any) => {
            if (localToken !== connectionToken) {
              log(`Ignoring stale subscription callback: ${status}`);
              return;
            }

            log(`Subscription status: ${status}`);
            bumpActivity();

            if (status === 'SUBSCRIBED') {
              // Connection established successfully
              // Removed: resetting outbox state here could interrupt an in-flight drain and cause concurrency
              // resetOutboxProcessingState();
              isConnecting = false; // Clear the guard

              // CRITICAL FIX: Reset retry count and circuit breaker on successful connection
              retryCount = 0;
              if (circuitBreakerTimer) {
                clearTimeout(circuitBreakerTimer);
                circuitBreakerTimer = null;
              }
              circuitBreakerOpen = false;

              set({
                connectionStatus: 'connected',
                realtimeChannel: channel,
                subscribedAt: Date.now(),
                isReconnecting: false
              });
              log('✅ Realtime connected successfully');

              // Update WhatsApp-style connection status
              try {
                const { whatsappConnection } = await import('@/lib/whatsappStyleConnection');
                whatsappConnection.setConnectionState('connected', 'Connected');
              } catch {}

              // Stop degraded poll fallback when connected
              try { (get() as any).stopPollFallback?.(); } catch {}

              // CRITICAL FIX (LOG46 Phase 3): Start heartbeat mechanism to detect realtime death
              startHeartbeat(channel, groupId);
              updateLastEventTime(); // Initialize timestamp

              // CRITICAL FIX (LOG47): Fetch missed messages after realtime reconnection
              if (realtimeDeathAt) {
                log('🔄 Realtime reconnected after death, fetching missed messages...');
                const { groups } = get();
                const allGroupIds = groups.map((g: any) => g.id);
                const deathTime = realtimeDeathAt; // Capture the timestamp

                // CRITICAL: Clear immediately to prevent duplicate fetches during flapping
                realtimeDeathAt = null;
                log('🔧 Cleared realtimeDeathAt to prevent duplicate fetches');

                // Fetch missed messages in background (don't block reconnection)
                setTimeout(() => {
                  fetchMissedMessagesSinceRealtimeDeath(allGroupIds, deathTime);
                }, 1000);
              }

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
              // Connection failed - let Supabase handle reconnection
              log(`❌ Connection failed with status: ${status}`);
              isConnecting = false; // Clear the guard

              // CRITICAL FIX (LOG46 Phase 3): Stop heartbeat when connection fails
              stopHeartbeat();

              // Enhanced handling for CHANNEL_ERROR - try session refresh first, avoid excessive rebuilds
              if (status === 'CHANNEL_ERROR') {
                log('🔧 CHANNEL_ERROR detected - attempting session refresh');

                // Only try session refresh, avoid full client rebuild unless absolutely necessary
                try {
                  const session = await supabasePipeline.getWorkingSession();
                  if (session?.access_token) {
                    log('🔧 CHANNEL_ERROR: Applying working session to realtime');
                    try {
                      const client = await supabasePipeline.getDirectClient();
                      (client as any).realtime?.setAuth?.(session.access_token);
                    } catch {}
                  } else {
                    log('🔧 CHANNEL_ERROR: No working session available');
                  }
                } catch (e) {
                  log(`🔧 CHANNEL_ERROR: Session refresh error: ${e}`);
                }
              } else {
                // Standard session refresh for CLOSED/TIMED_OUT using pipeline
                let currentSession: any = null;
                try {
                  currentSession = await supabasePipeline.getWorkingSession();
                } catch (_) {}
                if (!currentSession?.access_token) {
                  try {
                    const refreshed = await supabasePipeline.recoverSession();
                    if (refreshed) {
                      currentSession = await supabasePipeline.getWorkingSession();
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
              handleChannelError(groupId);
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

        // No watchdog timeout needed - rely on Supabase's built-in connection handling

      } catch (error) {
        log('Setup error: ' + (error as Error).message);
        isConnecting = false; // Clear the guard
        set({ connectionStatus: 'disconnected' });

        // Update WhatsApp-style connection status
        try {
          const { whatsappConnection } = await import('@/lib/whatsappStyleConnection');
          whatsappConnection.setConnectionState('disconnected', 'Connection failed');
        } catch {}

        handleChannelError(groupId);
      }
    },

    // Idempotent fast path: resubscribe existing channel without teardown when possible
    ensureSubscribedFastPath: async (groupId: string) => {
      const { realtimeChannel, connectionStatus } = get();
      if (!groupId) { log('Fast path: missing group id; skipping'); return; }
      if (!realtimeChannel) {
        log('Fast path: no existing channel; creating new');
        return await (get() as any).setupSimplifiedRealtimeSubscription(groupId);
      }
      if (connectionStatus === 'connected') { log('Channel already subscribed (fast path)'); return; }

      log('Fast path: re-subscribing existing channel');
      set({ connectionStatus: 'connecting' });
      try {
        await new Promise<void>((resolve) => {
          (realtimeChannel as any).subscribe((status: any) => {
            log(`Subscription status (fast): ${status}`);
            if (status === 'SUBSCRIBED') {
              set({ connectionStatus: 'connected', subscribedAt: Date.now(), isReconnecting: false, realtimeChannel });
              try {
                const { triggerOutboxProcessing } = get();
                if (typeof triggerOutboxProcessing === 'function') {
                  setTimeout(() => triggerOutboxProcessing('realtime-connected', 'normal'), 1000);
                }
              } catch {}
              resolve();
            } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
              set({ connectionStatus: 'disconnected' });
              (async () => {
                try {
                  const { reconnectionManager } = await import('@/lib/reconnectionManager');
                  await reconnectionManager.reconnect(`fast-status-${String(status).toLowerCase()}`);
                } catch {}
              })();
              resolve();
            } else if (status === 'CONNECTING') {
              set({ connectionStatus: 'connecting' });
            }
          });
        });
      } catch (e) {
        set({ connectionStatus: 'disconnected' });
        log('Fast path subscribe error: ' + (e as Error).message);
      }
    },


    cleanupRealtimeSubscription: async () => {
      // Fix #5: Add 5s delay before cleanup to handle quick navigation
      // If user opens another group within 5s, we can reuse the connection

      log('Scheduling cleanup in 5s (allows quick navigation reuse)');

      // Clear any existing cleanup timer
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }

      // Schedule cleanup after 5 seconds
      cleanupTimer = setTimeout(async () => {
        const { realtimeChannel, typingTimeout } = get();

        // CRITICAL FIX: Don't cleanup if channel is still subscribed/joined
        // Check the actual channel state, not just the connectionStatus variable
        // because connectionStatus might be 'disconnected' when on dashboard
        // but the channel is still healthy and subscribed
        if (realtimeChannel) {
          const channelState = (realtimeChannel as any).state;
          if (channelState === 'joined' || channelState === 'joining') {
            log(`⏭️ Skipping cleanup - channel still active (state: ${channelState})`);
            cleanupTimer = null;
            return;
          }
          log(`Executing delayed cleanup (5s passed) - channel state: ${channelState}`);
        } else {
          log('Executing delayed cleanup (5s passed) - no channel');
        }
        isConnecting = false; // Clear connection guard
        // Do NOT reset outbox state on routine navigation

        if (typingTimeout) clearTimeout(typingTimeout);

        // CRITICAL FIX (LOG46 Phase 3): Stop heartbeat before cleanup
        stopHeartbeat();

        if (realtimeChannel) {
          try {
            const client = await supabasePipeline.getDirectClient();
            client.removeChannel(realtimeChannel);
          } catch (e) {
            log('Error removing channel: ' + e);
          }
          set({ realtimeChannel: null });
        }

        // No reconnect timeout to clear with simplified logic

        // Clear typing users and keep connection status based on actual socket/token health
        const hasToken = !!(supabasePipeline as any).getCachedAccessToken?.() || !!(await supabasePipeline.getWorkingSession())?.access_token;
        set({
          connectionStatus: 'disconnected',
          typingUsers: [],
          typingTimeout: null,
          subscribedAt: null,
          isReconnecting: false
        });

        // Update WhatsApp-style connection status
        try {
          const { whatsappConnection } = await import('@/lib/whatsappStyleConnection');
          whatsappConnection.setConnectionState('disconnected', hasToken ? 'Disconnected (auth ok)' : 'Disconnected');
        } catch {}

        cleanupTimer = null;
      }, 5000); // 5 second delay
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
    forceReconnect: async (groupId: string) => {
      const { connectionStatus } = get();
      if (connectionStatus === 'connecting') {
        log('Force reconnect requested but already connecting; skipping duplicate');
        return;
      }

      // Debounce force reconnects to prevent excessive calls
      const now = Date.now();
      if (now - lastForceReconnectAt < 1500) {
        log('Force reconnect debounced (too soon after last attempt)');
        return;
      }
      lastForceReconnectAt = now;

      log('Force reconnect requested - delegating to reconnection manager');

      // Validate network connectivity using cached status
      const { online } = get();
      if (!online) {
        log('Force reconnect: Device is offline, setting disconnected status');
        set({ connectionStatus: 'disconnected' });
        return;
      }

      // Use the reconnection manager to prevent race conditions
      try {
        const { reconnectionManager } = await import('@/lib/reconnectionManager');
        await reconnectionManager.reconnect('force-reconnect');
      } catch (error) {
        log(`Force reconnect failed: ${error}`);
        handleChannelError(groupId);
      }
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
          const res = await supabasePipeline.onAuthStateChange((event, session) => {
            const state = get();
            const activeGroupId = state.activeGroup?.id;

            log(`Auth event: ${event}`);

            if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
              // Apply the latest token to realtime directly; avoid recursive flows
              try { (supabasePipeline as any).getDirectClient?.().then((c: any) => c?.realtime?.setAuth?.(session?.access_token)).catch(() => {}); } catch {}

              // If not healthy, request a single-flight reconnect via reconnectionManager
              try {
                const { connectionStatus, realtimeChannel } = get();
                const healthy = connectionStatus === 'connected' && !!realtimeChannel;
                if (activeGroupId && !healthy) {
                  log('Token applied; channel not healthy, requesting reconnection');
                  (async () => {
                    try { const { reconnectionManager } = await import('@/lib/reconnectionManager'); await reconnectionManager.reconnect('auth-token-applied'); } catch {}
                  })();
                } else {
                  log('Token applied; channel healthy, no reconnect');
                }
              } catch {}

              // Do not reset outbox on every auth event if channel healthy
              try {
                const { connectionStatus, realtimeChannel, triggerOutboxProcessing } = get();
                const healthy = connectionStatus === 'connected' && !!realtimeChannel;
                if (!healthy) {
                  resetOutboxProcessingState();
                  if (typeof triggerOutboxProcessing === 'function') {
                    setTimeout(() => triggerOutboxProcessing('auth-token-refreshed', 'high'), 500);
                  }
                } else {
                  log('Auth token event: channel healthy; skipping outbox reset');
                }
              } catch {}
            } else if (event === 'SIGNED_OUT') {
              log('User signed out, cleaning up realtime');
              get().cleanupRealtimeSubscription();
            }
          });
          authStateListener = res.data.subscription;
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