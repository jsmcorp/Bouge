import { supabasePipeline, SupabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { messageCache } from '@/lib/messageCache';
import { unreadTracker } from '@/lib/unreadTracker';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { Group, Message } from './types';
import { structureMessagesWithReplies } from './utils';


// Throttle duplicate fetches for the same group within a short window
const FETCH_THROTTLE_WINDOW_MS = 800;
const lastFetchStartAt: Record<string, number> = {};

export interface FetchActions {
  fetchGroups: () => Promise<void>;
  fetchMessages: (groupId: string) => Promise<void>;
  // New: lazy-load older messages when scrolling up
  loadOlderMessages: (groupId: string, pageSize?: number) => Promise<number>;
  fetchMessageById: (messageId: string) => Promise<Message | null>;
  fetchReplies: (messageId: string) => Promise<Message[]>;
  // Delta sync: fetch only new messages since cursor
  deltaSyncSince: (groupId: string, sinceIso: string) => Promise<void>;
  // Missed sync wrapper
  syncMissed: (groupId: string) => Promise<void>;
}

export const createFetchActions = (set: any, get: any): FetchActions => ({
  fetchGroups: async () => {
    try {
      set({ isLoading: true });

      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // ALWAYS load from local storage first if SQLite is available
      let localDataLoaded = false;
      if (isSqliteReady) {
        console.log('📱 Loading groups from local storage first (local-first approach)');
        try {
          const localGroups = await sqliteService.getGroups();
          console.log(`📱 Found ${localGroups?.length || 0} groups in local storage`);
          if (localGroups && localGroups.length > 0) {
            // Convert LocalGroup to Group with proper data mapping
            const groups: Group[] = localGroups.map(lg => ({
              id: lg.id,
              name: lg.name,
              description: lg.description,
              invite_code: lg.invite_code,
              created_by: lg.created_by,
              created_at: typeof lg.created_at === 'number' ? new Date(lg.created_at).toISOString() : lg.created_at,
              avatar_url: lg.avatar_url
            }));

            // Update UI with local data immediately
            set({ groups, isLoading: false });
            console.log(`✅ Loaded ${groups.length} groups from local storage`);
            localDataLoaded = true;

            // After displaying local data, check if we should sync in background
            const networkStatus = await Network.getStatus();
            const isOnline = networkStatus.connected;

            if (!isOnline) {
              // If offline, we're done - but we already loaded local data
              console.log('📵 Offline mode: Using local group data only');
              return;
            }

            // Continue with background sync if online
            console.log('� B ackground syncing groups with Supabase...');
          } else {
            // No local groups found, check cached network status
            const { online } = get();
            if (!online) {
              set({ groups: [], isLoading: false });
              console.log('📵 No local groups found and offline');
              return;
            }
          }
        } catch (error) {
          console.error('❌ Error loading groups from local storage:', error);
          // If there's an error loading from local storage and we're offline, show empty state
          const { online } = get();
          if (!online) {
            set({ groups: [], isLoading: false });
            return;
          }
        }
      }

      // If we've already loaded data from local storage, don't show loading indicator for remote fetch
      if (!localDataLoaded) {
        set({ isLoading: true });
      }

      // Check cached network status
      const { online } = get();

      // If offline and we couldn't load from local storage, show empty state
      if (!online) {
        console.log('📵 Offline and no local group data available');
        if (!localDataLoaded) {
          set({ groups: [], isLoading: false });
        }
        return;
      }

      // If we're online, fetch from Supabase
      console.log('🌐 Fetching groups from Supabase...');

      // Use Supabase Auth for all users (including Truecaller)
      console.log('🔑 Fetching groups with Supabase Auth');
      const { data: { user } } = await supabasePipeline.getUser();
      if (!user) throw new Error('Not authenticated');
      const userId = user.id;

      const client = await supabasePipeline.getDirectClient();
      const { data: memberGroups, error: memberError } = await client
        .from('group_members')
        .select('group_id')
        .eq('user_id', userId);

      if (memberError) throw memberError;

      if (!memberGroups || memberGroups.length === 0) {
        if (!localDataLoaded) {
          set({ groups: [], isLoading: false });
        }
        return;
      }

      const groupIds = memberGroups.map((mg: { group_id: string }) => mg.group_id);

      const { data: groupsData, error: groupsError } = await client
        .from('groups')
        .select('*')
        .in('id', groupIds);

      if (groupsError) throw groupsError;
      const groups = groupsData;

      // If SQLite is available, sync groups to local storage first
      if (isSqliteReady) {
        try {
          for (const group of groups || []) {
            await sqliteService.saveGroup({
              id: group.id,
              name: group.name,
              description: group.description || null,
              invite_code: group.invite_code || 'offline',
              created_by: group.created_by || '',
              created_at: new Date(group.created_at).getTime(),
              last_sync_timestamp: Date.now(),
              avatar_url: group.avatar_url || null,
              is_archived: 0
            });
          }
          console.log(`🔄 Synced ${groups?.length || 0} groups to local storage`);

          // Always refresh the UI with the updated data from local storage
          const updatedLocalGroups = await sqliteService.getGroups();
          const updatedGroups: Group[] = updatedLocalGroups.map(lg => ({
            id: lg.id,
            name: lg.name,
            description: lg.description,
            invite_code: lg.invite_code,
            created_by: lg.created_by,
            created_at: typeof lg.created_at === 'number' ? new Date(lg.created_at).toISOString() : lg.created_at,
            avatar_url: lg.avatar_url
          }));
          set({ groups: updatedGroups, isLoading: false });
          console.log(`✅ UI updated with ${updatedGroups.length} synced groups`);
        } catch (error) {
          console.error('❌ Error syncing groups to local storage:', error);
          // Fallback to remote data if local sync fails
          set({ groups: groups || [], isLoading: false });
        }
      } else {
        // No SQLite, just use remote data
        set({ groups: groups || [], isLoading: false });
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      set({ groups: [], isLoading: false });
    }
  },


  fetchMessages: async (groupId: string) => {
    try {
      const startTime = Date.now();
      console.log(`🔄 Fetching messages for group: ${groupId} (started at ${new Date().toISOString().split('T')[1]})`);

      // Throttle duplicate fetches for the same group
      const now = Date.now();
      const lastStart = lastFetchStartAt[groupId] || 0;
      if (now - lastStart < FETCH_THROTTLE_WINDOW_MS) {
        console.log('⏭️ Skipping duplicate fetchMessages for group', groupId);
        return;
      }
      lastFetchStartAt[groupId] = now;

      // Create a fetch token to ignore stale async updates if user switches groups mid-flight
      const localToken = `${groupId}:${now}:${Math.random().toString(36).slice(2)}`;
      set({ fetchToken: localToken, currentFetchGroupId: groupId });

      const stillCurrent = () => {
        const st = get();
        return st.activeGroup?.id === groupId && st.fetchToken === localToken;
      };
      const setSafely = (partial: any) => {
        if (stillCurrent()) {
          set(partial);
        } else {
          console.log(`⏭️ Skipping stale set for group ${groupId}`);
        }
      };

      // CRITICAL FIX: Check SQLite readiness IMMEDIATELY without any async waits
      // This ensures we load local messages first before any auth/network operations
      const isNative = Capacitor.isNativePlatform();
      let isSqliteReady = false;
      if (isNative) {
        // Check if SQLite is already ready (synchronous check if possible)
        try {
          isSqliteReady = await Promise.race([
            sqliteService.isReady(),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)) // 100ms timeout
          ]);
          console.log(`📱 SQLite ready check: ${isSqliteReady} (${Date.now() - startTime}ms)`);
        } catch (e) {
          console.warn('⚠️ SQLite ready check failed:', e);
          isSqliteReady = false;
        }
      }

      // Helper: merge fetched messages with existing messages to preserve realtime updates
      const mergeWithPending = (incoming: Message[]): Message[] => {
        try {
          const existing = (get().messages || []) as Message[];

          // Create a map of incoming messages by ID for quick lookup
          const incomingMap = new Map(incoming.map(m => [m.id, m]));

          // Find messages in existing state that are NOT in incoming
          // These could be:
          // 1. Optimistic messages still sending (delivery_status !== 'delivered')
          // 2. Realtime messages that arrived after the fetch started
          const existingNotInIncoming = existing.filter(m => !incomingMap.has(m.id));

          // Separate into two categories
          const optimisticMessages = existingNotInIncoming.filter(m => m.delivery_status !== 'delivered');
          const realtimeMessages = existingNotInIncoming.filter(m => m.delivery_status === 'delivered');

          // For realtime messages, only keep those that are newer than the fetch
          // We can determine this by checking if their created_at is more recent than any incoming message
          const newestIncomingTime = incoming.length > 0
            ? Math.max(...incoming.map(m => new Date(m.created_at).getTime()))
            : 0;

          const recentRealtimeMessages = realtimeMessages.filter(m => {
            const msgTime = new Date(m.created_at).getTime();
            return msgTime > newestIncomingTime;
          });

          // Merge: incoming + optimistic + recent realtime
          const merged = [...incoming, ...optimisticMessages, ...recentRealtimeMessages];

          // Deduplicate by ID (shouldn't be necessary but just in case)
          const uniqueMap = new Map(merged.map(m => [m.id, m]));
          const uniqueMessages = Array.from(uniqueMap.values());

          // Ensure chronological order by created_at
          uniqueMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

          console.log(`🔄 mergeWithPending: incoming=${incoming.length}, existing=${existing.length}, optimistic=${optimisticMessages.length}, realtime=${recentRealtimeMessages.length}, final=${uniqueMessages.length}`);

          return uniqueMessages;
        } catch (err) {
          console.error('❌ Error in mergeWithPending:', err);
          return incoming;
        }
      };

      // Preserve optimistic replies that are still sending
      const mergePendingReplies = (incoming: Message[]): Message[] => {
        try {
          const existing = (get().messages || []) as Message[];
          const pendingByParent = new Map<string, Message[]>();
          for (const msg of existing) {
            const pendingReplies = (msg.replies || []).filter(r => r.delivery_status !== 'delivered');
            if (pendingReplies.length > 0) pendingByParent.set(msg.id, pendingReplies);
          }
          if (pendingByParent.size === 0) return incoming;
          return incoming.map(m => {
            const pending = pendingByParent.get(m.id);
            if (!pending || pending.length === 0) return m;
            const existingIds = new Set((m.replies || []).map(r => r.id));
            const mergedReplies = [...(m.replies || [])];
            for (const pr of pending) {
              if (!existingIds.has(pr.id)) mergedReplies.push(pr);
            }
            return {
              ...m,
              replies: mergedReplies,
              reply_count: (m.reply_count || 0) + pending.filter(pr => !existingIds.has(pr.id)).length,
            } as Message;
          });
        } catch {
          return incoming;
        }
      };

      // FIRST: Try to load from in-memory cache for instant display
      // BUT: Skip cache if there was a recent push notification (last 10s) to ensure we show the new message
      const cacheCheckTime = Date.now();
      let shouldUseCache = true;
      
      try {
        const { hasRecentPush, clearRecentPush } = await import('@/lib/push');
        if (hasRecentPush(groupId)) {
          console.log('⚡ Recent push detected, skipping cache to force SQLite refresh');
          shouldUseCache = false;
          clearRecentPush(groupId); // Clear so subsequent opens can use cache
        }
      } catch (e) {
        // push module not available (web), continue with cache
      }
      
      const cachedMessages = shouldUseCache ? messageCache.getCachedMessages(groupId) : null;
      console.log(`📦 Cache check completed in ${Date.now() - cacheCheckTime}ms, found ${cachedMessages?.length || 0} messages`);

      if (cachedMessages && cachedMessages.length > 0) {
        console.log('⚡ INSTANT: Loading messages from in-memory cache');

        // Structure messages with nested replies
        const structuredMessages = structureMessagesWithReplies(cachedMessages);

        // Extract polls and user votes
        const polls = cachedMessages
          .filter(msg => msg.poll)
          .map(msg => msg.poll!)
          .filter(poll => poll);

        const userVotesMap: Record<string, number | null> = {};
        polls.forEach(poll => {
          if (poll.user_vote !== null && poll.user_vote !== undefined) {
            userVotesMap[poll.id] = poll.user_vote;
          }
        });

        // Update UI instantly with cached data, preserving any pending optimistic messages
        setSafely({
          messages: mergeWithPending(mergePendingReplies(structuredMessages)),
          polls: polls,
          userVotes: userVotesMap
        });

        console.log(`⚡ INSTANT: Displayed ${structuredMessages.length} cached messages instantly`);

        // Continue with background refresh to ensure data is up to date
        setTimeout(() => {
          console.log('🔄 Background: Refreshing messages from SQLite to ensure cache is current');
          // Continue with SQLite fetch in background
        }, 50);
      }

      // SECOND: Load from SQLite (either as primary source or background refresh)
      // CRITICAL: This should happen IMMEDIATELY, before any other operations
      let localDataLoaded = false;
      if (isSqliteReady) {
        const sqliteStartTime = Date.now();
        const loadingMessage = cachedMessages ? 'Background refresh from SQLite' : 'Loading from SQLite';
        console.log(`📱 ${loadingMessage} (started at ${sqliteStartTime - startTime}ms from group open)`);

        try {
          // Load 50 recent messages for instant UI (increased for better history)
          const localMessages = await sqliteService.getRecentMessages(groupId, 50);
          console.log(`📱 SQLite query completed in ${Date.now() - sqliteStartTime}ms, got ${localMessages?.length || 0} messages`);

          if (localMessages && localMessages.length > 0) {
            // Get all unique user IDs first to batch load users
            const userIds = [...new Set(localMessages.filter(msg => !msg.is_ghost).map(msg => msg.user_id))];
            const userCache = new Map();

            // Batch load all users
            for (const userId of userIds) {
              try {
                const user = await sqliteService.getUser(userId);
                if (user) {
                  userCache.set(userId, {
                    display_name: user.display_name,
                    avatar_url: user.avatar_url || null
                  });
                }
              } catch (error) {
                console.error(`Error loading user ${userId}:`, error);
              }
            }

            // Get poll messages to fetch poll data
            const pollMessages = localMessages.filter(msg => msg.message_type === 'poll');
            const pollMessageIds = pollMessages.map(msg => msg.id);

            // CRITICAL FIX: Don't get user during SQLite loading - this triggers token recovery
            // which can timeout for 10s and block message display!
            // We'll get user votes in background after messages are displayed
            // Typing as nullable with id to allow optional chaining (user?.id)
            let user: { id?: string } | null = null;

            // Fetch reactions for all messages
            const messageIds = localMessages.map(msg => msg.id);
            let reactionsData: any[] = [];
            if (messageIds.length > 0) {
              try {
                reactionsData = await sqliteService.getReactions(messageIds);
                console.log(`📱 Loaded ${reactionsData.length} reactions from SQLite`);
              } catch (error) {
                console.error('Error loading reactions from local storage:', error);
              }
            }

            // Create reactions map for quick lookup
            const reactionsMap = new Map<string, any[]>();
            reactionsData.forEach(reaction => {
              if (!reactionsMap.has(reaction.message_id)) {
                reactionsMap.set(reaction.message_id, []);
              }
              reactionsMap.get(reaction.message_id)!.push({
                id: reaction.id,
                message_id: reaction.message_id,
                user_id: reaction.user_id,
                emoji: reaction.emoji,
                created_at: new Date(reaction.created_at).toISOString()
              });
            });

            // Fetch poll data for poll messages
            let pollsData: any[] = [];
            let pollVotesData: any[] = [];
            if (pollMessageIds.length > 0) {
              try {
                pollsData = await sqliteService.getPolls(pollMessageIds);
                const pollIds = pollsData.map(poll => poll.id);
                if (pollIds.length > 0) {
                  pollVotesData = await sqliteService.getPollVotes(pollIds);
                }
              } catch (error) {
                console.error('Error loading poll data from local storage:', error);
              }
            }

            // Create poll data map for quick lookup
            const pollDataMap = new Map();
            pollsData.forEach(poll => {
              const pollVotes = pollVotesData.filter(vote => vote.poll_id === poll.id);
              const pollOptions = JSON.parse(poll.options);
              const voteCounts = new Array(pollOptions.length).fill(0);

              pollVotes.forEach(vote => {
                if (vote.option_index < voteCounts.length) {
                  voteCounts[vote.option_index]++;
                }
              });

              // Check current user's vote
              const currentUserId: any = (user as any)?.id;
              const userVote = pollVotes.find(vote => vote.user_id === currentUserId);

              pollDataMap.set(poll.message_id, {
                ...poll,
                options: pollOptions,
                vote_counts: voteCounts,
                total_votes: pollVotes.length,
                user_vote: userVote?.option_index ?? null,
                is_closed: new Date(poll.closes_at) < new Date(),
              });
            });

            // CRITICAL: Filter out tombstoned messages before converting
            const deletedIds = await sqliteService.getAllDeletedMessageIds();
            const filteredLocalMessages = localMessages.filter(msg => !deletedIds.has(msg.id));
            
            if (deletedIds.size > 0) {
              console.log(`🪦 Filtered ${localMessages.length - filteredLocalMessages.length} tombstoned messages from local load`);
            }

            // Convert local messages to the format expected by the UI
            const messages: Message[] = filteredLocalMessages.map((msg) => {
              // Get user info from cache
              let author = undefined;
              if (!msg.is_ghost) {
                author = userCache.get(msg.user_id) || {
                  display_name: 'Unknown User',
                  avatar_url: null
                };
              }

              // Get poll data if this is a poll message
              const pollData = msg.message_type === 'poll' ? pollDataMap.get(msg.id) : undefined;

              // Get reactions for this message
              const messageReactions = reactionsMap.get(msg.id) || [];

              // Build basic message object
              return {
                id: msg.id,
                group_id: msg.group_id,
                user_id: msg.user_id,
                content: msg.content,
                is_ghost: msg.is_ghost === 1,
                message_type: msg.message_type,
                category: msg.category,
                parent_id: msg.parent_id,
                image_url: msg.image_url,
                created_at: new Date(msg.created_at).toISOString(),
                author: author,
                reply_count: 0,
                replies: [],
                delivery_status: 'delivered' as const,
                reactions: messageReactions,
                poll: pollData
              };
            });

            // Structure messages with nested replies
            const structuredMessages = structureMessagesWithReplies(messages);

            // Extract polls from messages and add to store
            const polls = messages
              .filter(msg => msg.poll)
              .map(msg => msg.poll!)
              .filter(poll => poll); // Remove any null/undefined polls

            // Update user votes from polls
            const userVotesMap: Record<string, number | null> = {};
            polls.forEach(poll => {
              if (poll.user_vote !== null && poll.user_vote !== undefined) {
                userVotesMap[poll.id] = poll.user_vote;
              }
            });

            // Build messageReactions map
            const messageReactionsMap: Record<string, any[]> = {};
            reactionsData.forEach(reaction => {
              if (!messageReactionsMap[reaction.message_id]) {
                messageReactionsMap[reaction.message_id] = [];
              }
              messageReactionsMap[reaction.message_id].push({
                id: reaction.id,
                message_id: reaction.message_id,
                user_id: reaction.user_id,
                emoji: reaction.emoji,
                created_at: new Date(reaction.created_at).toISOString()
              });
            });

            // Update cache with fresh SQLite data
            messageCache.setCachedMessages(groupId, messages);

            // Update UI with local data (only if we didn't already show cached data)
            // Check if there are more messages by trying to fetch one more
            const hasMore = messages.length >= 50;
            console.log(`📊 hasMoreOlder calculation: messages.length=${messages.length}, hasMore=${hasMore}`);

            if (!cachedMessages) {
              setSafely({
                messages: mergeWithPending(mergePendingReplies(structuredMessages)),
                polls: polls,
                userVotes: userVotesMap,
                messageReactions: messageReactionsMap,
                hasMoreOlder: hasMore // If we got 50 messages, there might be more
              });
              console.log(`✅ Loaded ${structuredMessages.length} recent messages, ${polls.length} polls, and ${reactionsData.length} reactions from SQLite, hasMoreOlder=${hasMore}`);
            } else {
              // Silently update the UI with fresh data from SQLite
              setSafely({
                messages: mergeWithPending(mergePendingReplies(structuredMessages)),
                polls: polls,
                userVotes: userVotesMap,
                messageReactions: messageReactionsMap,
                hasMoreOlder: hasMore // If we got 50 messages, there might be more
              });
              console.log(`🔄 Background: Updated UI with ${structuredMessages.length} fresh messages and ${reactionsData.length} reactions from SQLite, hasMoreOlder=${hasMore}`);
            }
            localDataLoaded = true;

            // Background task: Refresh poll votes with user context (non-blocking)
            if (polls.length > 0) {
              setTimeout(async () => {
                try {
                  if (!stillCurrent()) return;

                  // Get current user with fast timeout
                  let currentUser = null;
                  try {
                    const userPromise = supabasePipeline.getUser();
                    const timeoutPromise = new Promise((_, reject) =>
                      setTimeout(() => reject(new Error('Auth timeout')), 1000) // 1s timeout
                    );
                    const { data } = await Promise.race([userPromise, timeoutPromise]) as any;
                    currentUser = data?.user || null;
                  } catch (error) {
                    // Continue without user - votes will show as null
                    currentUser = null;
                  }

                  if (currentUser) {
                    // Refresh poll votes with user context
                    const pollIds = polls.map(p => p.id);
                    const pollVotesData = await sqliteService.getPollVotes(pollIds);

                    const updatedUserVotes: Record<string, number | null> = {};
                    polls.forEach(poll => {
                      const userVote = pollVotesData.find(vote => vote.poll_id === poll.id && vote.user_id === currentUser.id);
                      updatedUserVotes[poll.id] = userVote?.option_index ?? null;
                    });

                    if (stillCurrent()) {
                      setSafely({ userVotes: updatedUserVotes });
                      console.log(`🔄 Background: Updated poll votes for ${Object.keys(updatedUserVotes).length} polls`);
                    }
                  }
                } catch (error) {
                  console.warn('⚠️ Background poll vote refresh failed:', error);
                }
              }, 100); // Quick background task
            }

            // Load remaining messages in background (increased to 50 for better history)
            setTimeout(async () => {
              try {
                console.log('🔄 Loading remaining messages in background...');
                const allLocalMessages = await sqliteService.getRecentMessages(groupId, 50);

                if (allLocalMessages && allLocalMessages.length > localMessages.length) {
                  // Process all messages the same way
                  const userIds = [...new Set(allLocalMessages.filter(msg => !msg.is_ghost).map(msg => msg.user_id))];
                  const userCache = new Map();

                  for (const userId of userIds) {
                    try {
                      const user = await sqliteService.getUser(userId);
                      if (user) {
                        userCache.set(userId, {
                          display_name: user.display_name,
                          avatar_url: user.avatar_url || null
                        });
                      }
                    } catch (error) {
                      console.error(`Error loading user ${userId}:`, error);
                    }
                  }

                  const pollMessages = allLocalMessages.filter(msg => msg.message_type === 'poll');
                  const pollMessageIds = pollMessages.map(msg => msg.id);

                  // Get user for poll votes in background (with fast timeout)
                  // Typing as nullable with id to allow optional chaining (user?.id)
                  let user: { id?: string } | null = null;
                  try {
                    const userPromise = supabasePipeline.getUser();
                    const timeoutPromise = new Promise((_, reject) =>
                      setTimeout(() => reject(new Error('Auth timeout')), 2000) // 2s timeout for background task
                    );
                    const { data } = await Promise.race([userPromise, timeoutPromise]) as any;
                    user = data?.user || null;
                  } catch (error) {
                    console.warn('⚠️ Could not get current user for poll data (background task)');
                    user = null;
                  }

                  let pollsData: any[] = [];
                  let pollVotesData: any[] = [];
                  if (pollMessageIds.length > 0) {
                    try {
                      pollsData = await sqliteService.getPolls(pollMessageIds);
                      const pollIds = pollsData.map(poll => poll.id);
                      if (pollIds.length > 0) {
                        pollVotesData = await sqliteService.getPollVotes(pollIds);
                      }
                    } catch (error) {
                      console.error('Error loading poll data:', error);
                    }
                  }

                  const pollDataMap = new Map();
                  pollsData.forEach(poll => {
                    const pollVotes = pollVotesData.filter(vote => vote.poll_id === poll.id);
                    const pollOptions = JSON.parse(poll.options);
                    const voteCounts = new Array(pollOptions.length).fill(0);

                    pollVotes.forEach(vote => {
                      if (vote.option_index < voteCounts.length) {
                        voteCounts[vote.option_index]++;
                      }
                    });

                    const currentUserId: any = (user as any)?.id;
                    const userVote = pollVotes.find(vote => vote.user_id === currentUserId);

                    pollDataMap.set(poll.message_id, {
                      ...poll,
                      options: pollOptions,
                      vote_counts: voteCounts,
                      total_votes: pollVotes.length,
                      user_vote: userVote?.option_index ?? null,
                      is_closed: new Date(poll.closes_at) < new Date(),
                    });
                  });

                  // Filter tombstones from background load too
                  const deletedIds = await sqliteService.getAllDeletedMessageIds();
                  const filteredAllMessages = allLocalMessages.filter(msg => !deletedIds.has(msg.id));

                  const allMessages: Message[] = filteredAllMessages.map((msg) => {
                    let author = undefined;
                    if (!msg.is_ghost) {
                      author = userCache.get(msg.user_id) || {
                        display_name: 'Unknown User',
                        avatar_url: null
                      };
                    }

                    const pollData = msg.message_type === 'poll' ? pollDataMap.get(msg.id) : undefined;

                    return {
                      id: msg.id,
                      group_id: msg.group_id,
                      user_id: msg.user_id,
                      content: msg.content,
                      is_ghost: msg.is_ghost === 1,
                      message_type: msg.message_type,
                      category: msg.category,
                      parent_id: msg.parent_id,
                      image_url: msg.image_url,
                      created_at: new Date(msg.created_at).toISOString(),
                      author: author,
                      reply_count: 0,
                      replies: [],
                      delivery_status: 'delivered' as const,
                      reactions: [],
                      poll: pollData
                    };
                  });

                  const allStructuredMessages = structureMessagesWithReplies(allMessages);
                  const allPolls = allMessages
                    .filter(msg => msg.poll)
                    .map(msg => msg.poll!)
                    .filter(poll => poll);

                  const allUserVotesMap: Record<string, number | null> = {};
                  allPolls.forEach(poll => {
                    if (poll.user_vote !== null && poll.user_vote !== undefined) {
                      allUserVotesMap[poll.id] = poll.user_vote;
                    }
                  });

                  // Update cache with all messages (only recent 10 will be cached)
                  messageCache.setCachedMessages(groupId, allMessages);

                  // Update with all messages silently, preserving any pending optimistic messages
                  setSafely({
                    messages: mergeWithPending(mergePendingReplies(allStructuredMessages)),
                    polls: allPolls,
                    userVotes: allUserVotesMap,
                    hasMoreOlder: allMessages.length >= 50, // If we got 50 messages, there might be more
                    isLoading: false // ✅ Set loading to false after SQLite data is displayed
                  });
                  console.log(`🔄 Background loaded ${allStructuredMessages.length} total messages`);

                  // ✅ Fetch unread tracking data immediately after SQLite load
                  try {
                    const firstUnreadId = await unreadTracker.getFirstUnreadMessageId(groupId);
                    const unreadCount = await unreadTracker.getUnreadCount(groupId);
                    setSafely({
                      firstUnreadMessageId: firstUnreadId,
                      unreadCount: unreadCount
                    });
                    console.log(`📊 Unread tracking: firstUnreadId=${firstUnreadId}, count=${unreadCount}`);
                  } catch (error) {
                    console.error('❌ Error fetching unread tracking data:', error);
                  }
                }
              } catch (error) {
                console.error('❌ Error loading background messages:', error);
              }
            }, 100); // Load background messages after 100ms
          }

          // ✅ CRITICAL: Set loading to false immediately after SQLite data is displayed
          // This ensures instant UI update without waiting for Supabase
          localDataLoaded = true;
        } catch (error) {
          console.error('❌ Error loading messages from local storage:', error);
        }
      }

      // If we've already loaded data from cache or local storage, don't show loading indicator
      if (!cachedMessages && !localDataLoaded) {
        setSafely({ isLoading: true });
      } else {
        // ✅ We have local data - hide loading indicator immediately
        setSafely({ isLoading: false });
      }

      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;

      // If offline, check if we have local data
      if (!isOnline) {
        if (!cachedMessages && !localDataLoaded) {
          // No local data available and offline - show empty state
          console.log('📵 Offline: No local data available for this group');
          setSafely({ messages: [], isLoading: false });
        } else {
          // We have local data - we're good to go
          console.log('📵 Offline: Using local data only');
          setSafely({ isLoading: false });
        }
        return;
      }

      // ✅ If we have local data, fetch from Supabase in background (non-blocking)
      // This ensures instant UI display from SQLite while Supabase syncs in background
      if (localDataLoaded || cachedMessages) {
        console.log('🌐 Background: Fetching messages from Supabase (non-blocking)...');

        // Fetch in background without blocking - don't await this
        setTimeout(async () => {
          try {
            // Only proceed if still on the same group
            if (!stillCurrent()) {
              console.log('⏭️ Skipping background Supabase fetch - user switched groups');
              return;
            }

            const client = await supabasePipeline.getDirectClient();
            const { data, error } = await client
              .from('messages')
              .select(`
                *,
                reactions(*),
                users!messages_user_id_fkey(display_name, avatar_url, created_at)
              `)
              .eq('group_id', groupId)
              .order('created_at', { ascending: false })
              .limit(50);

            if (error) throw error;

            // CRITICAL: Filter tombstones before syncing
            const deletedIds = await sqliteService.getAllDeletedMessageIds();
            const filteredData = (data || []).filter((msg: any) => !deletedIds.has(msg.id));
            
            if (deletedIds.size > 0 && filteredData.length < (data || []).length) {
              console.log(`🪦 Background: Filtered ${(data || []).length - filteredData.length} tombstoned messages`);
            }

            // Sync to SQLite in background (syncMessagesFromRemote also filters tombstones internally)
            if (isSqliteReady && filteredData && filteredData.length > 0) {
              await sqliteService.syncMessagesFromRemote(groupId, filteredData);
              console.log(`🔄 Background: Synced ${filteredData.length} messages from Supabase to SQLite`);
            }

            // Update cache
            if (data && data.length > 0) {
              messageCache.setCachedMessages(groupId, data);
            }

            // CRITICAL FIX (LOG52): Update UI state with new messages from background sync
            // This fixes the issue where messages sent while app was dead don't appear until user navigates away and back
            if (filteredData && filteredData.length > 0) {
              const currentState = get();

              // Only update if we're still viewing the same group
              if (currentState.activeGroup?.id === groupId) {
                const existingIds = new Set(currentState.messages.map((m: Message) => m.id));
                const newMessages = filteredData.filter((msg: any) => !existingIds.has(msg.id));

                if (newMessages.length > 0) {
                  console.log(`🔄 Background: Found ${newMessages.length} new messages from Supabase, updating UI`);

                  // Convert raw Supabase data to Message format
                  const builtMessages: Message[] = newMessages.map((msg: any) => ({
                    id: msg.id,
                    group_id: msg.group_id,
                    user_id: msg.user_id,
                    content: msg.content,
                    is_ghost: msg.is_ghost,
                    message_type: msg.message_type || 'text',
                    category: msg.category,
                    parent_id: msg.parent_id,
                    image_url: msg.image_url,
                    created_at: typeof msg.created_at === 'string' ? msg.created_at : new Date(msg.created_at).toISOString(),
                    author: msg.is_ghost ? undefined : msg.users,
                    reply_count: 0,
                    replies: [],
                    delivery_status: 'delivered' as const,
                    reactions: msg.reactions || [],
                    poll: undefined
                  }));

                  // CRITICAL FIX (LOG54): Merge and sort by created_at to ensure chronological order
                  // This prevents messages from appearing out of order when some were saved to SQLite
                  // by FCM while user was on dashboard
                  const updatedMessages = [...currentState.messages, ...builtMessages]
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                  set({ messages: updatedMessages });

                  console.log(`✅ Background: UI updated with ${builtMessages.length} new messages (sorted by timestamp)`);
                } else {
                  console.log(`🔄 Background: No new messages to add to UI (all ${filteredData.length} already exist)`);
                }
              } else {
                console.log(`🔄 Background: User switched groups, skipping UI update`);
              }
            }

            console.log('✅ Background Supabase sync completed');
          } catch (error) {
            console.error('❌ Background Supabase fetch failed:', error);
          }
        }, 200); // Small delay to ensure UI is responsive

        // Return immediately - UI is already showing local data
        return;
      }

      // If we don't have local data, fetch from Supabase (blocking)
      console.log('🌐 Fetching messages from Supabase (no local data)...');
      const client = await supabasePipeline.getDirectClient();
      const { data, error } = await client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // CRITICAL: Filter tombstones from remote fetch
      const deletedIds = await sqliteService.getAllDeletedMessageIds();
      const filteredData = (data || []).filter((msg: any) => !deletedIds.has(msg.id));
      
      if (deletedIds.size > 0 && filteredData.length < (data || []).length) {
        console.log(`🪦 Filtered ${(data || []).length - filteredData.length} tombstoned messages from remote fetch`);
      }

      const rows = filteredData.slice().reverse();
      const messages = await Promise.all(rows.map(async (msg: any) => {
        const { count: replyCount } = await client
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('parent_id', msg.id);

        const { data: replies } = await client
          .from('messages')
          .select(`
            *,
            reactions(*),
            users!messages_user_id_fkey(display_name, avatar_url, created_at)
          `)
          .eq('parent_id', msg.id)
          .order('created_at', { ascending: true })
          .limit(3);

        const formattedReplies = (replies || []).map((reply: any) => ({
          ...reply,
          author: reply.is_ghost ? undefined : reply.users,
          reply_count: 0,
          delivery_status: 'delivered' as const,
        }));

        // Fetch poll data if this is a poll message
        let pollData = null;
        if (msg.message_type === 'poll') {
          const { data: poll } = await client
            .from('polls')
            .select('*')
            .eq('message_id', msg.id)
            .single();

          if (poll) {
            // Fetch vote counts
            const { data: votes } = await client
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id);

            const pollOptions = poll.options as string[];
            const voteCounts = new Array(pollOptions.length).fill(0);
            votes?.forEach((vote: any) => {
              if (vote.option_index < voteCounts.length) {
                voteCounts[vote.option_index]++;
              }
            });

            // Check user's vote
            const { data: { user } } = await supabasePipeline.getUser();
            const { data: userVote } = await client
              .from('poll_votes')
              .select('option_index')
              .eq('poll_id', poll.id)
              .eq('user_id', user?.id)
              .maybeSingle();

            pollData = {
              ...poll,
              options: pollOptions,
              vote_counts: voteCounts,
              total_votes: votes?.length || 0,
              user_vote: userVote?.option_index ?? null,
              is_closed: new Date(poll.closes_at) < new Date(),
            };
          }
        }

        return {
          ...msg,
          author: msg.is_ghost ? undefined : msg.users,
          reply_count: replyCount || 0,
          replies: formattedReplies,
          delivery_status: 'delivered' as const,
          poll: pollData,
        };
      }));

      // Structure messages with nested replies
      const structuredMessages = structureMessagesWithReplies(messages);

      // If SQLite is available, sync messages and user data to local storage
      if (isSqliteReady) {
        try {
          console.log('🔄 Syncing messages from Supabase to local storage...');

          // First, sync user data for message authors
          for (const msg of data || []) {
            if (!msg.is_ghost && msg.users) {
              await sqliteService.saveUser({
                id: msg.user_id,
                display_name: msg.users.display_name,
                phone_number: msg.users.phone_number || null,
                avatar_url: msg.users.avatar_url || null,
                is_onboarded: 1,
                created_at: SupabasePipeline.safeTimestamp(msg.users.created_at)
              });
            }
          }

          // Also sync reply authors
          for (const msg of messages) {
            if (msg.replies && msg.replies.length > 0) {
              for (const reply of msg.replies) {
                if (!reply.is_ghost && (reply as any).users) {
                  await sqliteService.saveUser({
                    id: reply.user_id,
                    display_name: (reply as any).users.display_name,
                    phone_number: (reply as any).users.phone_number || null,
                    avatar_url: (reply as any).users.avatar_url || null,
                    is_onboarded: 1,
                    created_at: (reply as any).users.created_at ? new Date((reply as any).users.created_at).getTime() : Date.now()
                  });
                }
              }
            }
          }

          // Then sync the messages
          const syncCount = await sqliteService.syncMessagesFromRemote(groupId, data || []);

          // Update last sync timestamp
          await sqliteService.updateLastSyncTimestamp(groupId, Date.now());

          console.log(`🔄 Synced ${syncCount} messages from Supabase to local storage`);

          // Sync reactions, polls, and other related data
          await get().syncMessageRelatedData(groupId, data || []);

          console.log('✅ Background sync completed');
        } catch (error) {
          console.error('❌ Error syncing messages to local storage:', error);
        }
      }

      // Update cache with fresh Supabase data
      if (messages && messages.length > 0) {
        messageCache.setCachedMessages(groupId, messages);
      }

      // Update UI with Supabase data
      // If we already loaded from cache/local, merge the Supabase data to ensure we have the latest
      if (cachedMessages || localDataLoaded) {
        // We already showed local data, now silently update with Supabase data if it's newer/different
        console.log('🔄 Background: Updating UI with fresh Supabase data');
        setSafely({
          messages: mergeWithPending(mergePendingReplies(structuredMessages)),
          isLoading: false,
          hasMoreOlder: messages.length >= 50 // If we got 50 messages, there might be more
        });
      } else {
        // First load from Supabase (no local data was available)
        console.log('✅ Loaded messages from Supabase (no local data available)');
        setSafely({
          messages: structuredMessages,
          isLoading: false,
          hasMoreOlder: messages.length >= 50 // If we got 50 messages, there might be more
        });
      }

      // Fetch unread tracking data
      try {
        const firstUnreadId = await unreadTracker.getFirstUnreadMessageId(groupId);
        const unreadCount = await unreadTracker.getUnreadCount(groupId);
        setSafely({
          firstUnreadMessageId: firstUnreadId,
          unreadCount: unreadCount
        });
        console.log(`📊 Unread tracking: firstUnreadId=${firstUnreadId}, count=${unreadCount}`);
      } catch (error) {
        console.error('❌ Error fetching unread tracking data:', error);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      { const st = get(); if (st.activeGroup?.id === groupId && st.currentFetchGroupId === groupId && st.fetchToken) { set({ isLoading: false }); } }
    }
  },

  // Lazy-load older messages for infinite scroll
  	loadOlderMessages: async (groupId: string, pageSize: number = 30) => {
  	  try {
  	    const state = get();
  	    console.log(`📜 loadOlderMessages called: groupId=${groupId}, pageSize=${pageSize}, isLoadingOlder=${state.isLoadingOlder}, hasMoreOlder=${state.hasMoreOlder}`);
  	    
  	    if (state.isLoadingOlder || !state.activeGroup || state.activeGroup.id !== groupId) {
  	      console.log(`📜 loadOlderMessages: Skipping - isLoadingOlder=${state.isLoadingOlder}, activeGroup=${state.activeGroup?.id}, requestedGroup=${groupId}`);
  	      return 0;
  	    }
  	    const current = state.messages || [];
  	    if (current.length === 0) {
  	      console.log('📜 loadOlderMessages: No messages in current state');
  	      return 0;
  	    }

  	    set({ isLoadingOlder: true });

  	    const oldestIso = current[0].created_at;
  	    const oldestMs = new Date(oldestIso).getTime();
  	    console.log(`📜 loadOlderMessages: Loading messages before ${oldestIso} (${oldestMs})`);

  	    let combined: Message[] = [];

  	    // Try local first (SQLite)
  	    const isNative = Capacitor.isNativePlatform();
  	    const isSqliteReady = isNative && await sqliteService.isReady();
  	    if (isSqliteReady) {
  	      try {
  	        // First, check total message count for this group
  	        const allMessages = await sqliteService.getAllMessagesForGroup(groupId);
  	        console.log(`📜 loadOlderMessages: Total messages in DB for group: ${allMessages.length}`);
  	        
  	        const localOlder = await sqliteService.getMessagesBefore(groupId, oldestMs, pageSize);
  	        console.log(`📜 loadOlderMessages: Requested ${pageSize} messages before ${oldestMs}, got ${localOlder?.length || 0} messages`);
  	        
  	        if (localOlder && localOlder.length > 0) {
  	          console.log(`📜 loadOlderMessages: Loaded ${localOlder.length} messages from SQLite`);

  	          // Batch load authors for non-ghost messages
  	          const userIds: string[] = Array.from(
	            new Set<string>(
	              localOlder
	                .filter((m: any) => !m.is_ghost)
	                .map((m: any) => String(m.user_id))
	            )
	          );
  	          const userCache = new Map();
  	          for (const uid of userIds) {
  	            try {
  	              const u = await sqliteService.getUser(uid);
  	              if (u) userCache.set(uid, { display_name: u.display_name, avatar_url: u.avatar_url || null });
  	            } catch {}
  	          }

  	          // CRITICAL FIX: Batch load pseudonyms for ghost messages from SQLite
  	          // This prevents RPC calls when MessageBubble renders
  	          const ghostUserIds: string[] = Array.from(
	            new Set<string>(
	              localOlder
	                .filter((m: any) => m.is_ghost)
	                .map((m: any) => String(m.user_id))
	            )
	          );

  	          const pseudonymCache = new Map<string, string>();
  	          if (ghostUserIds.length > 0) {
  	            try {
  	              const localPseudonyms = await sqliteService.getUserPseudonyms(groupId);
  	              console.log(`📜 loadOlderMessages: Loaded ${localPseudonyms.length} pseudonyms from SQLite`);

  	              const now = Date.now();
  	              const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  	              for (const p of localPseudonyms) {
  	                const age = now - p.created_at;
  	                // Only use pseudonyms that are less than 24 hours old
  	                if (age < CACHE_DURATION) {
  	                  pseudonymCache.set(p.user_id, p.pseudonym);
  	                }
  	              }
  	              console.log(`📜 loadOlderMessages: Cached ${pseudonymCache.size} valid pseudonyms`);
  	            } catch (e) {
  	              console.warn('⚠️ loadOlderMessages: Failed to load pseudonyms from SQLite', e);
  	            }
  	          }

  	          // CRITICAL: Filter tombstones before mapping
  	          const deletedIds = await sqliteService.getAllDeletedMessageIds();
  	          const filteredOlder = localOlder.filter((msg: any) => !deletedIds.has(msg.id));
  	          
  	          if (deletedIds.size > 0 && filteredOlder.length < localOlder.length) {
  	            console.log(`🪦 Filtered ${localOlder.length - filteredOlder.length} tombstoned messages from pagination`);
  	          }

  	          const mapped: Message[] = filteredOlder.map((msg: any) => {
  	            const isGhost = msg.is_ghost === 1;
  	            const pseudonym = isGhost ? pseudonymCache.get(msg.user_id) : undefined;

  	            return {
  	              id: msg.id,
  	              group_id: msg.group_id,
  	              user_id: msg.user_id,
  	              content: msg.content,
  	              is_ghost: isGhost,
  	              message_type: msg.message_type,
  	              category: msg.category,
  	              parent_id: msg.parent_id,
  	              image_url: msg.image_url,
  	              created_at: new Date(msg.created_at).toISOString(),
  	              author: isGhost ? undefined : (userCache.get(msg.user_id) || { display_name: 'Unknown User', avatar_url: null }),
  	              pseudonym: pseudonym, // CRITICAL: Attach pseudonym to prevent RPC call
  	              reply_count: 0,
  	              replies: [],
  	              delivery_status: 'delivered',
  	              reactions: [],
  	            };
  	          });
  	          combined = combined.concat(mapped);
  	        }
  	      } catch (e) {
  	        console.warn('⚠️ loadOlderMessages: local fetch failed', e);
  	      }
  	    }

  	    // If local fewer than pageSize, fetch remainder from remote
  	    if (combined.length < pageSize) {
  	      try {
  	        const client = await supabasePipeline.getDirectClient();
  	        const limit = pageSize - combined.length;
  	        const { data, error } = await client
  	          .from('messages')
  	          .select(`*, users!messages_user_id_fkey(display_name, avatar_url, created_at)`)
  	          .eq('group_id', groupId)
  	          .lt('created_at', oldestIso)
  	          .order('created_at', { ascending: false })
  	          .limit(limit);
  	        if (!error && data && data.length > 0) {
  	          // Map remote rows to Message
  	          const rows = data.slice().reverse();
  	          const mapped: Message[] = rows.map((msg: any) => ({
  	            ...msg,
  	            author: msg.is_ghost ? undefined : msg.users,
  	            reply_count: 0,
  	            replies: [],
  	            delivery_status: 'delivered' as const,
  	          }));
  	          combined = combined.concat(mapped);

  	          // Persist to SQLite (best-effort)
  	          if (isSqliteReady) {
  	            try { await sqliteService.syncMessagesFromRemote(groupId, data); } catch (e) {}
  	          }
  	        }
  	      } catch (e) {
  	        console.warn('⚠️ loadOlderMessages: remote fetch failed', e);
  	      }
  	    }

  	    if (combined.length === 0) {
  	      set({ isLoadingOlder: false, hasMoreOlder: false });
  	      return 0;
  	    }

  	    // Merge and dedupe, keep ascending chronological order
  	    const existing: Message[] = get().messages || [];
  	    const seen = new Set(existing.map(m => m.id));
  	    const newOnes = combined.filter(m => !seen.has(m.id));
  	    const merged = [...newOnes, ...existing];
  	    merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  	    set({ messages: merged, isLoadingOlder: false, hasMoreOlder: newOnes.length >= pageSize });
  	    return newOnes.length;
  	  } catch (e) {
  	    console.error('❌ loadOlderMessages failed:', e);
  	    set({ isLoadingOlder: false });
  	    return 0;
  	  }
  	},



  fetchMessageById: async (messageId: string) => {
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data, error } = await client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('id', messageId)
        .single();

      if (error) throw error;

      return {
        ...data,
        author: data.is_ghost ? undefined : data.users,
        reply_count: 0,
        delivery_status: 'delivered' as const,
      };
    } catch (error) {
      console.error('Error fetching message:', error);
      return null;
    }
  },

  fetchReplies: async (messageId: string) => {
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data, error } = await client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('parent_id', messageId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return (data || []).map((reply: any) => ({
        ...reply,
        author: reply.is_ghost ? undefined : reply.users,
        reply_count: 0,
        delivery_status: 'delivered' as const,
      }));
    } catch (error) {
      console.error('Error fetching replies:', error);
      return [];
    }
  },

  // REMOVED: preloadTopGroupMessages - preloader removed entirely (Fix #3)
  // Messages load instantly from SQLite when opening groups, no need for preloading

  // Delta sync implementation
  deltaSyncSince: async (groupId: string, sinceIso: string) => {
    try {
      // Fetch only messages created after the given ISO timestamp
      const client = await supabasePipeline.getDirectClient();
      const { data, error } = await client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('group_id', groupId)
        .gt('created_at', sinceIso)
        .order('created_at', { ascending: true });
      if (error) throw error;

      if (!data || data.length === 0) return;

      const formatted = data.map((msg: any) => ({
        ...msg,
        author: msg.is_ghost ? undefined : msg.users,
        reply_count: 0,
        replies: [],
        delivery_status: 'delivered' as const,
      }));

      // Merge into current state and update message cache
      const existing = get().messages || [];
      const merged: Message[] = [...existing];
      const seen = new Set(existing.map((m: Message) => m.id));
      for (const m of formatted) {
        if (!seen.has(m.id)) {
          merged.push(m);
          seen.add(m.id);
        }
      }
      // Sort after merge
      merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      set({ messages: merged });

      try {
        const { messageCache } = await import('@/lib/messageCache');
        messageCache.setCachedMessages(groupId, merged);
      } catch (e) {}
    } catch (e) {
      console.error('❌ Delta sync failed:', e);
    }
  },

  syncMissed: async (groupId: string) => {
    try {
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();
      if (!isSqliteReady) return;
      const result = await (sqliteService as any).syncMissed(groupId);
      if (result?.merged > 0) {
        // Refresh UI data for the group
        await (get() as any).fetchMessages(groupId);
      }
    } catch (e) {
      console.error('❌ Missed sync failed:', e);
    }
  },
});