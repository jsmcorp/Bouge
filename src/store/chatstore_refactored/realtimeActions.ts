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

  const bumpActivity = () => set({ lastActivityAt: Date.now() });
  const log = (message: string) => console.log(`[realtime-v2] ${message}`);

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

  // Simplified reconnection - let Supabase handle the timing
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

    // Check if we should attempt reconnection
    const { online } = get();
    if (!online) {
      log('Device offline, will reconnect when network returns');
      set({ connectionStatus: 'disconnected' });
      return;
    }

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

      if (existsById) {
        messagesAfter = state.messages.map((m: Message) => (
          m.id === message.id ? { ...m, delivery_status: 'delivered' } : m
        ));
      } else {
        const idxByDedupe = message.dedupe_key
          ? state.messages.findIndex((m: Message) => m.dedupe_key && m.dedupe_key === message.dedupe_key)
          : -1;
        if (idxByDedupe !== -1) {
          messagesAfter = state.messages.map((m: Message, idx: number) => (
            idx === idxByDedupe ? { ...message } : m
          ));
        } else {
          messagesAfter = [...state.messages, message];
        }
      }

      set({ messages: messagesAfter });
      try {
        messageCache.setCachedMessages(message.group_id, [...messagesAfter]);
        console.log(`📦 MessageCache updated for group ${message.group_id} after realtime insert`);
      } catch (err) {
        console.error('❌ Message cache update failed:', err);
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

      // Check if we already have a healthy connection for this group
      const { connectionStatus, realtimeChannel } = get();
      if (connectionStatus === 'connected' && realtimeChannel) {
        log('Already connected to realtime, skipping setup');
        return;
      }

      isConnecting = true;
      log(`Setting up simplified realtime subscription for group: ${groupId}`);
      mobileLogger.startTiming('realtime-setup', 'connection', { groupId });

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
        }, async (payload: any) => {
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
        }, async (payload: any) => {
          if (localToken !== connectionToken) return;
          bumpActivity();
          const pollRow = payload.new as DbPollRow;
          await handlePollInsert(pollRow, user.id, groupId);
        });

        // Poll vote inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'poll_votes',
        }, async (payload: any) => {
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
          .subscribe(async (status: any) => {
            if (localToken !== connectionToken) {
              log(`Ignoring stale subscription callback: ${status}`);
              return;
            }

            log(`Subscription status: ${status}`);
            bumpActivity();

            if (status === 'SUBSCRIBED') {
              // Connection established successfully
              resetOutboxProcessingState(); // Reset outbox state on successful connection
              isConnecting = false; // Clear the guard
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

              // No custom heartbeat needed - Supabase Web Worker handles this

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
      const { realtimeChannel, typingTimeout } = get();

      log('Cleaning up realtime subscription (navigation) - keeping root socket alive');
      isConnecting = false; // Clear connection guard
      // Do NOT reset outbox state on routine navigation

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

      // No reconnect timeout to clear with simplified logic

      // Clear typing users and keep connection status based on actual socket/token health
      const hasToken = !!(supabasePipeline as any).getCachedAccessToken?.() || !!(await supabasePipeline.getWorkingSession())?.access_token;
      set({
        connectionStatus: hasToken ? 'connected' : 'disconnected',
        typingUsers: [],
        typingTimeout: null,
        subscribedAt: null,
        isReconnecting: false
      });

      // Update WhatsApp-style connection status
      try {
        const { whatsappConnection } = await import('@/lib/whatsappStyleConnection');
        if (hasToken) {
          whatsappConnection.setConnectionState('connected', 'Connected');
        } else {
          whatsappConnection.setConnectionState('disconnected', 'Disconnected');
        }
      } catch {}
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