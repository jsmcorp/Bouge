import { supabase } from '@/lib/supabase';
import { messageCache } from '@/lib/messageCache';
import { Message, Poll, TypingUser } from './types';

export interface RealtimeActions {
  setupRealtimeSubscription: (groupId: string) => Promise<void>;
  cleanupRealtimeSubscription: () => void;
  sendTypingStatus: (isTyping: boolean, isGhost?: boolean) => void;
  handlePresenceSync: () => void;
}

export const createRealtimeActions = (set: any, get: any): RealtimeActions => ({
  setupRealtimeSubscription: async (groupId: string) => {
    console.log('🔄 Setting up realtime subscription for group:', groupId);

    try {
      // Ensure we have a user BEFORE setting connecting, otherwise banner can get stuck
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('⚠️ No authenticated user found; skipping realtime subscription');
        set({ connectionStatus: 'disconnected' });
        return;
      }

      // Cleanup existing subscription before creating a new one
      get().cleanupRealtimeSubscription();

      set({ connectionStatus: 'connecting' });

      // Create new channel for this group (unique name per group)
      const channel = supabase.channel(`group-${groupId}`, {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      // Helper to record activity
      const bumpActivity = () => set({ lastActivityAt: Date.now() });
      // Add an explicit ping/pong listener layer using presence heartbeat
      let lastPongAt = Date.now();
      const markPong = () => { lastPongAt = Date.now(); };

      // Subscribe to message inserts
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `group_id=eq.${groupId}`,
          },
          async (payload) => {
            bumpActivity();
            console.log('📨 New message received:', payload.new);

            // Fetch the complete message with author info
            const { data: messageData, error } = await supabase
              .from('messages')
              .select(`
                *,
                reactions(*),
                users!messages_user_id_fkey(display_name, avatar_url)
              `)
              .eq('id', payload.new.id)
              .single();

            if (error) {
              console.error('Error fetching new message:', error);
              return;
            }

            // If this is a poll message, fetch the poll data
            let pollData = null;
            if (messageData.message_type === 'poll') {
              const { data: poll } = await supabase
                .from('polls')
                .select('*')
                .eq('message_id', messageData.id)
                .single();

              if (poll) {
                // Fetch vote counts
                const { data: votes } = await supabase
                  .from('poll_votes')
                  .select('option_index')
                  .eq('poll_id', poll.id);

                const pollOptions = poll.options as string[];
                const voteCounts = new Array(pollOptions.length).fill(0);
                votes?.forEach(vote => {
                  if (vote.option_index < voteCounts.length) {
                    voteCounts[vote.option_index]++;
                  }
                });

                // Check user's vote
                const { data: userVote } = await supabase
                  .from('poll_votes')
                  .select('option_index')
                  .eq('poll_id', poll.id)
                  .eq('user_id', user.id)
                  .maybeSingle();

                pollData = {
                  ...poll,
                  options: pollOptions,
                  vote_counts: voteCounts,
                  total_votes: votes?.length || 0,
                  user_vote: userVote?.option_index ?? null,
                  is_closed: new Date(poll.closes_at) < new Date(),
                } as Poll;

                // Add poll to store
                get().addPoll(pollData);

                // Update user votes
                const currentVotes = get().userVotes;
                set({ userVotes: { ...currentVotes, [poll.id]: userVote?.option_index ?? null } });
              }
            }

            const formattedMessage = {
              ...messageData,
              author: messageData.is_ghost ? undefined : messageData.users,
              reply_count: 0,
              replies: [],
              delivery_status: 'delivered' as const,
              poll: pollData,
            };

            const state = get();

            // Check if this is a reply to an existing message
            if (messageData.parent_id) {
              // Check if reply already exists in parent's replies
              const parentMessage = state.messages.find((msg: Message) => msg.id === messageData.parent_id);
              const replyExists = parentMessage?.replies?.some((reply: any) => reply.id === messageData.id);

              if (!replyExists) {
                // Update parent message's reply count and inline replies
                const updatedMessages = state.messages.map((msg: Message) => {
                  if (msg.id === messageData.parent_id) {
                    return {
                      ...msg,
                      reply_count: (msg.reply_count || 0) + 1,
                      replies: [...(msg.replies || []), formattedMessage].slice(0, 3),
                    };
                  }
                  return msg;
                });
                set({ messages: updatedMessages });
              }

              // Update thread replies if this thread is currently open
              if (state.activeThread?.id === messageData.parent_id) {
                const threadReplyExists = state.threadReplies.some((reply: Message) => reply.id === messageData.id);
                if (!threadReplyExists) {
                  set({ threadReplies: [...state.threadReplies, formattedMessage] });
                }
              }
            } else {
              // Add as main message if it's not already in the list
              const messageExists = state.messages.some((msg: Message) => msg.id === messageData.id);
              if (!messageExists) {
                get().addMessage(formattedMessage);
              } else {
                // Update delivery status if message exists
                get().updateMessage(messageData.id, { delivery_status: 'delivered' });
              }

              // Update in-memory cache for this group's recent messages so openings stay instant
              try {
                const latestMessages = get().messages;
                // Pass a shallow copy to avoid any accidental mutations by downstream code
                messageCache.setCachedMessages(groupId, [...latestMessages]);
                console.log(`📦 MessageCache: Updated cache for group ${groupId} after realtime insert`);
              } catch (err) {
                console.error('❌ Failed updating message cache on realtime insert:', err);
              }
            }
          }
        )
        // Subscribe to poll inserts
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'polls',
          },
          async (payload) => {
            bumpActivity();
            console.log('📊 New poll received:', payload.new);

            // Fetch complete poll data with vote counts
            const poll = payload.new;

            // Check if this poll belongs to the current group
            const { data: message } = await supabase
              .from('messages')
              .select('group_id')
              .eq('id', poll.message_id)
              .single();

            if (!message || message.group_id !== groupId) return;

            const { data: votes } = await supabase
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id);

            const pollOptions = poll.options as string[];
            const voteCounts = new Array(pollOptions.length).fill(0);
            votes?.forEach(vote => {
              if (vote.option_index < voteCounts.length) {
                voteCounts[vote.option_index]++;
              }
            });

            const { data: userVote } = await supabase
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id)
              .eq('user_id', user.id)
              .maybeSingle();

            const pollData = {
              ...poll,
              options: pollOptions,
              vote_counts: voteCounts,
              total_votes: votes?.length || 0,
              user_vote: userVote?.option_index ?? null,
              is_closed: new Date(poll.closes_at) < new Date(),
            } as Poll;

            // Check if poll already exists
            const state = get();
            const pollExists = state.polls.some((p: Poll) => p.id === poll.id);

            if (!pollExists) {
              get().addPoll(pollData);
            }

            // Update user votes
            const currentVotes = get().userVotes;
            set({ userVotes: { ...currentVotes, [poll.id]: userVote?.option_index ?? null } });

            // Update the corresponding message with poll data
            const updatedMessages = state.messages.map((msg: Message) => {
              if (msg.id === poll.message_id) {
                return { ...msg, poll: pollData };
              }
              return msg;
            });
            set({ messages: updatedMessages });
          }
        )
        // Subscribe to poll vote inserts
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'poll_votes',
          },
          async (payload) => {
            bumpActivity();
            console.log('🗳️ New vote received:', payload.new);

            const vote = payload.new;
            const state = get();

            // Skip updating vote counts if this is the current user's vote
            // (already handled by optimistic update)
            if (vote.user_id === user.id) {
              console.log('🔄 Skipping vote count update for current user (optimistic update already applied)');
              return;
            }

            // Update poll vote counts in both polls array and messages
            const updatedPolls = state.polls.map((poll: Poll) => {
              if (poll.id === vote.poll_id) {
                const newVoteCounts = [...(poll.vote_counts || [])];
                if (vote.option_index < newVoteCounts.length) {
                  newVoteCounts[vote.option_index]++;
                }

                return {
                  ...poll,
                  vote_counts: newVoteCounts,
                  total_votes: (poll.total_votes || 0) + 1,
                };
              }
              return poll;
            });

            // Update messages with poll data
            const updatedMessages = state.messages.map((msg: Message) => {
              if (msg.poll?.id === vote.poll_id) {
                const newVoteCounts = [...(msg.poll?.vote_counts || [])];
                if (vote.option_index < newVoteCounts.length) {
                  newVoteCounts[vote.option_index]++;
                }

                return {
                  ...msg,
                  poll: {
                    ...msg.poll,
                    vote_counts: newVoteCounts,
                    total_votes: (msg.poll?.total_votes || 0) + 1,
                  }
                };
              }
              return msg;
            });

            set({ polls: updatedPolls, messages: updatedMessages as Message[] });
          }
        )
        .on('presence', { event: 'sync' }, () => {
          bumpActivity();
          markPong();
          get().handlePresenceSync();
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          bumpActivity();
          markPong();
          console.log('👋 User joined:', key, newPresences);
          get().handlePresenceSync();
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          bumpActivity();
          markPong();
          console.log('👋 User left:', key, leftPresences);
          get().handlePresenceSync();
        })
        .subscribe(async (status) => {
          console.log('📡 Subscription status:', status);
          bumpActivity();

          if (status === 'SUBSCRIBED') {
            set({
              connectionStatus: 'connected',
              realtimeChannel: channel
            });
            console.log('✅ Successfully subscribed to realtime updates');
            
            // To prevent duplicate banners, collapse any transient reconnecting state here
            // and perform a single light refresh
            try {
              // Kick a quick background refresh to ensure any messages sent while reconnecting update ticks
              const { fetchMessages } = get();
              if (typeof fetchMessages === 'function') {
                fetchMessages(groupId);
              }
            } catch (e) {
              console.error('❌ Background refresh after subscribe failed:', e);
            }

            // Reset reconnection tracking and backoff on ONLINE
            set({ reconnectAttempt: 0, isReconnecting: false, lastActivityAt: Date.now() });
            // Clear any reconnect watchdog
            const existingWatchdog = get().reconnectWatchdogTimer;
            if (existingWatchdog) {
              clearTimeout(existingWatchdog as any);
              set({ reconnectWatchdogTimer: null });
            }
            // Start heartbeat + watchdog
            const existingHeartbeat = get().heartbeatTimer;
            if (existingHeartbeat) clearInterval(existingHeartbeat as any);
            const hb = setInterval(() => {
              try {
                const { realtimeChannel, lastActivityAt, connectionStatus } = get();
                if (!realtimeChannel) return;
                // Heartbeat: use presence track as ping; server ignores if unchanged
                realtimeChannel.track({ heartbeat: Date.now() });
                // Expect a pong (presence event). If no pong for > 20s, force reconnect
                const sincePongMs = Date.now() - lastPongAt;
                if (sincePongMs > 20000) {
                  console.warn('🛎️ Pong timeout: forcing reconnect');
                  get().cleanupRealtimeSubscription();
                  const attempt = get().reconnectAttempt || 0;
                  const nextAttempt = Math.min(attempt + 1, 6);
                  set({ reconnectAttempt: nextAttempt, connectionStatus: 'reconnecting' });
                  get().setupRealtimeSubscription(groupId);
                  return;
                }
                // Watchdog: if no activity for > 30s while connected, trigger reconnect
                const idleMs = Date.now() - (lastActivityAt || 0);
                if (connectionStatus === 'connected' && idleMs > 30000) {
                  console.warn('🛟 Watchdog: idle too long, forcing reconnect');
                  get().cleanupRealtimeSubscription();
                  // Kick a guarded reconnect
                  const attempt = get().reconnectAttempt || 0;
                  const nextAttempt = Math.min(attempt + 1, 6);
                  set({ reconnectAttempt: nextAttempt, connectionStatus: 'reconnecting' });
                  get().setupRealtimeSubscription(groupId);
                }
              } catch (e) {
                console.error('❌ Heartbeat error, forcing immediate reconnect:', e);
                get().cleanupRealtimeSubscription();
                const attempt = get().reconnectAttempt || 0;
                const nextAttempt = Math.min(attempt + 1, 6);
                set({ reconnectAttempt: nextAttempt, connectionStatus: 'reconnecting' });
                get().setupRealtimeSubscription(groupId);
              }
            }, 10000); // heartbeat every 10s
            set({ heartbeatTimer: hb });
          } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            set({ connectionStatus: 'disconnected' });
            console.error('❌ Channel subscription error');

            // Attempt to reconnect with backoff
            const attempt = get().reconnectAttempt || 0;
            const nextAttempt = Math.min(attempt + 1, 6); // cap attempts growth
            const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000); // 1s,2s,4s,... cap 30s
            const jitter = Math.floor(Math.random() * 500); // 0-500ms jitter
            const delay = baseDelay + jitter;

            // Coalesce concurrent reconnects
            const existingTimer = get().reconnectTimer;
            if (existingTimer) {
              clearTimeout(existingTimer);
            }
            set({ isReconnecting: true, reconnectAttempt: nextAttempt });
            const timer = setTimeout(() => {
              console.log(`🔄 Reconnecting (attempt ${nextAttempt})...`);
              get().setupRealtimeSubscription(groupId);
            }, delay);
            set({ reconnectTimer: timer });

            // Reconnect watchdog: if still not connected after 45s, force full re-init
            const existingWatchdog = get().reconnectWatchdogTimer;
            if (existingWatchdog) clearTimeout(existingWatchdog as any);
            const watchdog = setTimeout(() => {
              const { connectionStatus } = get();
              if (connectionStatus !== 'connected') {
                console.warn('🛟 Reconnect watchdog fired: forcing full re-initialize');
                get().cleanupRealtimeSubscription();
                set({ reconnectAttempt: 0, connectionStatus: 'reconnecting' });
                get().setupRealtimeSubscription(groupId);
              }
            }, 45000);
            set({ reconnectWatchdogTimer: watchdog });
          } else if (status === 'TIMED_OUT') {
            // Show reconnecting banner and schedule a retry with backoff
            console.warn('⏰ Subscription timed out; scheduling reconnect with backoff');
            set({ connectionStatus: 'reconnecting' });

            const attempt = get().reconnectAttempt || 0;
            const nextAttempt = Math.min(attempt + 1, 6);
            const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
            const jitter = Math.floor(Math.random() * 500);
            const delay = baseDelay + jitter;

            const existingTimer = get().reconnectTimer;
            if (existingTimer) {
              clearTimeout(existingTimer);
            }
            set({ isReconnecting: true, reconnectAttempt: nextAttempt });
            const timer = setTimeout(() => {
              console.log(`🔄 Reconnecting after timeout (attempt ${nextAttempt})...`);
              get().setupRealtimeSubscription(groupId);
            }, delay);
            set({ reconnectTimer: timer });

            // Reconnect watchdog as above
            const existingWatchdog = get().reconnectWatchdogTimer;
            if (existingWatchdog) clearTimeout(existingWatchdog as any);
            const watchdog = setTimeout(() => {
              const { connectionStatus } = get();
              if (connectionStatus !== 'connected') {
                console.warn('🛟 Reconnect watchdog fired (timeout path): forcing re-init');
                get().cleanupRealtimeSubscription();
                set({ reconnectAttempt: 0, connectionStatus: 'reconnecting' });
                get().setupRealtimeSubscription(groupId);
              }
            }, 45000);
            set({ reconnectWatchdogTimer: watchdog });
          }
        });

    } catch (error) {
      console.error('💥 Error setting up realtime subscription:', error);
      set({ connectionStatus: 'disconnected' });
    }
  },

  cleanupRealtimeSubscription: () => {
    const { realtimeChannel, typingTimeout, reconnectTimer, heartbeatTimer, reconnectWatchdogTimer } = get();

    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    if (realtimeChannel) {
      console.log('🧹 Cleaning up realtime subscription');
      supabase.removeChannel(realtimeChannel);
      set({
        realtimeChannel: null,
        connectionStatus: 'disconnected',
        typingUsers: [],
        typingTimeout: null
      });
    }

    // Clear any pending reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      set({ reconnectTimer: null, isReconnecting: false });
    }
    // Clear heartbeat
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer as any);
      set({ heartbeatTimer: null });
    }
    // Clear reconnect watchdog
    if (reconnectWatchdogTimer) {
      clearTimeout(reconnectWatchdogTimer as any);
      set({ reconnectWatchdogTimer: null });
    }
  },

  sendTypingStatus: (isTyping: boolean, isGhost = false) => {
    const { realtimeChannel, activeGroup, typingTimeout } = get();

    if (!realtimeChannel || !activeGroup) return;

    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    if (isTyping) {
      // Send typing status
      realtimeChannel.track({
        is_typing: true,
        is_ghost: isGhost,
        timestamp: Date.now(),
      });

      // Auto-stop typing after 3 seconds of inactivity
      const timeout = setTimeout(() => {
        get().sendTypingStatus(false, isGhost);
      }, 3000);

      set({ typingTimeout: timeout });
    } else {
      // Send stop typing status
      realtimeChannel.track({
        is_typing: false,
        is_ghost: isGhost,
        timestamp: Date.now(),
      });

      set({ typingTimeout: null });
    }
  },

  handlePresenceSync: () => {
    const { realtimeChannel } = get();
    if (!realtimeChannel) return;

    const presenceState = realtimeChannel.presenceState();
    const typingUsers: TypingUser[] = [];

    Object.entries(presenceState).forEach(([userId, presences]) => {
      const presence = (presences as any[])[0] as any;
      if (presence?.is_typing) {
        // Get user info from our current user data or fetch it
        // For now, we'll use a simplified approach
        typingUsers.push({
          user_id: userId,
          display_name: presence.is_ghost ? 'Ghost' : 'User',
          avatar_url: null,
          is_ghost: presence.is_ghost || false,
        });
      }
    });

    set({ typingUsers });
  },
});