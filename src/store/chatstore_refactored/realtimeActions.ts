import { supabase } from '@/lib/supabase';
import { messageCache } from '@/lib/messageCache';
import { sqliteService } from '@/lib/sqliteService';
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
  cleanupRealtimeSubscription: () => void;
  sendTypingStatus: (isTyping: boolean, isGhost?: boolean) => void;
  handlePresenceSync: () => void;
  ensureAuthBeforeSubscribe: (opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; reason?: string }>;
}

export const createRealtimeActions = (set: any, get: any): RealtimeActions => {
  // Caches and guards in the action factory closure
  const authorCache = new Map<string, Author>();
  let latestSetupToken: string | null = null;
  let lastPongAt: number = Date.now();
  let lastReconnectAttemptAt: number = 0;
  let refreshAfterSubscribeLastRunAt: number = 0;
  const RESUB_COOLDOWN_MS = 3000;
  let lastResubscribeAt: number = 0;

  const bumpActivity = () => set({ lastActivityAt: Date.now() });
  const markPong = () => { lastPongAt = Date.now(); };

  const nowMs = () => Date.now();

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
      const { data, error } = await supabase
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

  function canResubscribe(): boolean {
    const now = nowMs();
    if (now - lastResubscribeAt < RESUB_COOLDOWN_MS) {
      return false;
    }
    lastResubscribeAt = now;
    return true;
  }

  function coalesceReconnect(groupId: string) {
    if (!canResubscribe()) {
      console.warn('⛔ Resubscribe throttled: skipping attempt (cooldown 3s)');
      return;
    }
    const attempt = get().reconnectAttempt || 0;
    const nextAttempt = Math.min(attempt + 1, 6);
    const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;

    const existingTimer = get().reconnectTimer;
    if (existingTimer) clearTimeout(existingTimer);

    set({ isReconnecting: true, reconnectAttempt: nextAttempt });
    lastReconnectAttemptAt = nowMs();
    const timer = setTimeout(() => {
      console.log(`🔄 Reconnecting (attempt ${nextAttempt})...`);
      get().setupRealtimeSubscription(groupId);
    }, delay);
    set({ reconnectTimer: timer });
  }

  function startHeartbeat(groupId: string) {
    const existingHeartbeat = get().heartbeatTimer;
    if (existingHeartbeat) clearInterval(existingHeartbeat as any);

    const hb = setInterval(() => {
      try {
        const { realtimeChannel, lastActivityAt, connectionStatus } = get();
        // Ping via presence track (server will coalesce)
        if (realtimeChannel) {
          realtimeChannel.track({ heartbeat: Date.now() });
        }

        const sincePongMs = nowMs() - lastPongAt;
        const idleMs = nowMs() - (lastActivityAt || 0);

        // If connected and either pong timed out or idle too long -> reconnect once
        if (connectionStatus === 'connected' && (sincePongMs > 20000 || idleMs > 30000)) {
          console.warn('🛟 Heartbeat/watchdog: forcing reconnect', { sincePongMs, idleMs });
          get().cleanupRealtimeSubscription();
          set({ connectionStatus: 'reconnecting' });
          coalesceReconnect(groupId);
          return;
        }

        // If not connected and our last reconnect attempt is stale (>45s), try again
        if (connectionStatus !== 'connected' && (nowMs() - lastReconnectAttemptAt) > 45000) {
          console.warn('🛟 Reconnect stale: retrying');
          coalesceReconnect(groupId);
        }
      } catch (e) {
        console.error('❌ Heartbeat error:', e);
        get().cleanupRealtimeSubscription();
        set({ connectionStatus: 'reconnecting' });
        coalesceReconnect(groupId);
      }
    }, 10000); // 10s
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
      }

      if (state.activeThread?.id === message.parent_id) {
        const threadReplyExists = state.threadReplies.some((r: Message) => r.id === message.id);
        if (!threadReplyExists) {
          set({ threadReplies: [...state.threadReplies, message] });
        }
      }
    } else {
      const exists = state.messages.some((m: Message) => m.id === message.id);
      if (!exists) {
        get().addMessage(message);
      } else {
        get().updateMessage(message.id, { delivery_status: 'delivered' });
      }

      try {
        const latestMessages = get().messages;
        messageCache.setCachedMessages(message.group_id, [...latestMessages]);
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
      const { data: msgRef, error: msgErr } = await supabase
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
      const { data: votes, error: votesErr } = await supabase
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
      const { data: uv, error: uvErr } = await supabase
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
    ensureAuthBeforeSubscribe: async (opts?: { timeoutMs?: number }) => {
      const timeoutMs = opts?.timeoutMs ?? 10000;
      // Fast-path: existing session loaded
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          try { (supabase as any).realtime?.setAuth?.(session.access_token); } catch (_) {}
          return { ok: true };
        }
      } catch (_) {}

      // Slow-path: poll getSession and trigger a refresh once
      try {
        await supabase.auth.refreshSession().catch(() => {});
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            try { (supabase as any).realtime?.setAuth?.(session.access_token); } catch (_) {}
            return { ok: true };
          }
          await new Promise(res => setTimeout(res, 300));
        }
        return { ok: false, reason: 'timeout' };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },

    setupRealtimeSubscription: async (groupId: string) => {
      console.log('🔄 Setting up realtime subscription for group:', groupId);

      try {
        // Ensure we have a fresh/valid session before subscribing
        const authCheck = await (get() as any).ensureAuthBeforeSubscribe({ timeoutMs: 5000 });
        if (!authCheck.ok) {
          console.warn(`⚠️ Auth not ready for subscribe (reason=${authCheck.reason}); will retry`);
          set({ connectionStatus: 'reconnecting' });
          coalesceReconnect(groupId);
          return;
        }

        // Use session to avoid racing against getUser and token propagation
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
          console.warn('⚠️ No authenticated user found; skipping realtime subscription');
          set({ connectionStatus: 'disconnected' });
          return;
        }

        // Setup token to ignore late callbacks from older channels BEFORE cleanup
        const localToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        latestSetupToken = localToken;

        // Guard: Clean previous subscription and timers after updating token
        get().cleanupRealtimeSubscription();
        set({ connectionStatus: 'connecting' });

        const channel = supabase.channel(`group-${groupId}`, {
          config: { presence: { key: user.id } },
        });

        // Message inserts (no redundant fetch): build from payload + cached author
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}`,
        }, async (payload) => {
          if (localToken !== latestSetupToken) return; // stale
          bumpActivity();
          const row = payload.new as DbMessageRow;
          try {
            const message = await buildMessageFromRow(row);
            // For poll messages, do not fetch poll here; poll insert handler will attach
            attachMessageToState(message);
          } catch (e) {
            console.error('❌ Failed to process message insert:', e);
          }
        });

        // Poll inserts (single source of truth for poll hydration)
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'polls',
        }, async (payload) => {
          if (localToken !== latestSetupToken) return;
          const pollRow = payload.new as DbPollRow;
          await handlePollInsert(pollRow, user.id, groupId);
        });

        // Poll vote inserts
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'poll_votes',
        }, async (payload) => {
          if (localToken !== latestSetupToken) return;
          bumpActivity();
          const vote = payload.new as { poll_id: string; user_id: string; option_index: number };
          if (vote.user_id === user.id) return; // optimistic update already applied client-side

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
            if (localToken !== latestSetupToken) return;
            bumpActivity();
            markPong();
            get().handlePresenceSync();
          })
          .on('presence', { event: 'join' }, () => {
            if (localToken !== latestSetupToken) return;
            bumpActivity();
            markPong();
            get().handlePresenceSync();
          })
          .on('presence', { event: 'leave' }, () => {
            if (localToken !== latestSetupToken) return;
            bumpActivity();
            markPong();
            get().handlePresenceSync();
          })
          .subscribe(async (status) => {
            if (localToken !== latestSetupToken) return;
            console.log('📡 Subscription status:', status);
            bumpActivity();

            if (status === 'SUBSCRIBED') {
              // Clear any pending subscribe watchdog timer
              const subTid = (get() as any).subscribeTimeoutId as any;
              if (subTid) {
                clearTimeout(subTid);
                set({ subscribeTimeoutId: null } as any);
              }
              set({ connectionStatus: 'connected', realtimeChannel: channel, subscribedAt: Date.now() });
              console.log('✅ Realtime subscribed');

              // Reset reconnection/backoff, kick unified heartbeat
              set({ reconnectAttempt: 0, isReconnecting: false, lastActivityAt: Date.now() });
              startHeartbeat(groupId);

              // Debounced refresh: only if empty list to prevent flicker/double load
              try {
                const stateNow = get();
                const hasMessages = (stateNow.messages?.length || 0) > 0;
                const sinceLast = nowMs() - refreshAfterSubscribeLastRunAt;
                if (!hasMessages && sinceLast > 5000) {
                  const { fetchMessages } = stateNow;
                  if (typeof fetchMessages === 'function') {
                    refreshAfterSubscribeLastRunAt = nowMs();
                    fetchMessages(groupId);
                  }
                }
              } catch (e) {
                console.error('❌ Background refresh after subscribe failed:', e);
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
              set({ connectionStatus: 'disconnected' });
              console.error('❌ Channel error/closed');
              coalesceReconnect(groupId);
            } else if (status === 'TIMED_OUT') {
              console.warn('⏰ Subscription timed out');
              set({ connectionStatus: 'reconnecting' });
              coalesceReconnect(groupId);
            }
          });
      } catch (error) {
        console.error('💥 Error setting up realtime subscription:', error);
        set({ connectionStatus: 'disconnected' });
      }
    },

    cleanupRealtimeSubscription: () => {
      const { realtimeChannel, typingTimeout, reconnectTimer, heartbeatTimer, reconnectWatchdogTimer, subscribeTimeoutId, activeGroup } = get();

      if (typingTimeout) clearTimeout(typingTimeout);
      if (realtimeChannel) {
        console.log('🧹 Cleaning up realtime subscription');
        supabase.removeChannel(realtimeChannel);
        set({ realtimeChannel: null });
      }

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        set({ reconnectTimer: null, isReconnecting: false });
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer as any);
        set({ heartbeatTimer: null });
      }
      if (reconnectWatchdogTimer) {
        // No longer used, but clear if present from older state
        clearTimeout(reconnectWatchdogTimer as any);
        set({ reconnectWatchdogTimer: null });
      }
      const subT = subscribeTimeoutId as any;
      if (subT) {
        clearTimeout(subT);
        set({ subscribeTimeoutId: null } as any);
      }

      // Proactively remove any orphan group channels created prior to SUBSCRIBED
      try {
        const channels = (supabase as any).getChannels?.() || [];
        const groupTopicFragment = activeGroup?.id ? `group-${activeGroup.id}` : 'group-';
        channels.forEach((ch: any) => {
          const topic: string = ch?.topic || '';
          if (topic.includes(groupTopicFragment) || topic.includes('group-')) {
            (supabase as any).removeChannel?.(ch);
          }
        });
      } catch (_) {}

      // Clear typing users and reset status to avoid lingering UI state
      set({ connectionStatus: 'disconnected', typingUsers: [], typingTimeout: null });
    },

    sendTypingStatus: (isTyping: boolean, isGhost = false) => {
      const { realtimeChannel, activeGroup, typingTimeout } = get();
      if (!realtimeChannel || !activeGroup) return;

      if (typingTimeout) clearTimeout(typingTimeout);

      if (isTyping) {
        realtimeChannel.track({ is_typing: true, is_ghost: isGhost, timestamp: Date.now() });
        const timeout = setTimeout(() => { get().sendTypingStatus(false, isGhost); }, 3000);
        set({ typingTimeout: timeout });
      } else {
        realtimeChannel.track({ is_typing: false, is_ghost: isGhost, timestamp: Date.now() });
        set({ typingTimeout: null });
      }
    },

    handlePresenceSync: () => {
      const { realtimeChannel } = get();
      if (!realtimeChannel) return;

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
    },
  };
};