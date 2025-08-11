import { supabase } from '@/lib/supabase';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { Group, Message } from './types';
import { structureMessagesWithReplies } from './utils';

export interface FetchActions {
  fetchGroups: () => Promise<void>;
  fetchMessages: (groupId: string) => Promise<void>;
  fetchMessageById: (messageId: string) => Promise<Message | null>;
  fetchReplies: (messageId: string) => Promise<Message[]>;
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
            console.log('🔄 Background syncing groups with Supabase...');
          } else {
            // No local groups found, but still set loading to false if offline
            const networkStatus = await Network.getStatus();
            if (!networkStatus.connected) {
              set({ groups: [], isLoading: false });
              console.log('📵 No local groups found and offline');
              return;
            }
          }
        } catch (error) {
          console.error('❌ Error loading groups from local storage:', error);
          // If there's an error loading from local storage and we're offline, show empty state
          const networkStatus = await Network.getStatus();
          if (!networkStatus.connected) {
            set({ groups: [], isLoading: false });
            return;
          }
        }
      }

      // If we've already loaded data from local storage, don't show loading indicator for remote fetch
      if (!localDataLoaded) {
        set({ isLoading: true });
      }

      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;

      // If offline and we couldn't load from local storage, show empty state
      if (!isOnline) {
        console.log('📵 Offline and no local group data available');
        if (!localDataLoaded) {
          set({ groups: [], isLoading: false });
        }
        return;
      }

      // If we're online, fetch from Supabase
      console.log('🌐 Fetching groups from Supabase...');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: memberGroups, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (memberError) throw memberError;

      if (!memberGroups || memberGroups.length === 0) {
        if (!localDataLoaded) {
          set({ groups: [], isLoading: false });
        }
        return;
      }

      const groupIds = memberGroups.map(mg => mg.group_id);

      const { data: groups, error: groupsError } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);

      if (groupsError) throw groupsError;

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
      console.log('🔄 Fetching messages for group:', groupId);
      set({ isLoading: true });

      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // ALWAYS load from local storage first if SQLite is available
      let localDataLoaded = false;
      if (isSqliteReady) {
        console.log('📱 Loading messages from local storage first (local-first approach)');
        try {
          const localMessages = await sqliteService.getAllMessagesForGroup(groupId);

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
            
            // Get current user for vote checking
            const { data: { user } } = await supabase.auth.getUser();
            
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
              const userVote = pollVotes.find(vote => vote.user_id === user?.id);

              pollDataMap.set(poll.message_id, {
                ...poll,
                options: pollOptions,
                vote_counts: voteCounts,
                total_votes: pollVotes.length,
                user_vote: userVote?.option_index ?? null,
                is_closed: new Date(poll.closes_at) < new Date(),
              });
            });

            // Convert local messages to the format expected by the UI
            const messages: Message[] = localMessages.map((msg) => {
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
                reactions: [],
                poll: pollData
              };
            });

            // Structure messages with nested replies
            const structuredMessages = structureMessagesWithReplies(messages);

            // Update UI with local data immediately
            set({ messages: structuredMessages, isLoading: false });
            console.log(`✅ Loaded ${structuredMessages.length} parent messages from local storage`);
            localDataLoaded = true;
          }
        } catch (error) {
          console.error('❌ Error loading messages from local storage:', error);
        }
      }

      // If we've already loaded data from local storage, don't show loading indicator for remote fetch
      if (localDataLoaded) {
        set({ isLoading: false });
      }

      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;

      // If offline and we couldn't load from local storage, show empty state
      if (!isOnline) {
        console.log('📵 Offline and no local data available');
        if (!localDataLoaded) {
          set({ messages: [], isLoading: false });
        }
        return;
      }

      // If we're online, fetch from Supabase
      console.log('🌐 Fetching messages from Supabase...');
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const messages = await Promise.all((data || []).map(async (msg) => {
        const { count: replyCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('parent_id', msg.id);

        const { data: replies } = await supabase
          .from('messages')
          .select(`
            *,
            reactions(*),
            users!messages_user_id_fkey(display_name, avatar_url)
          `)
          .eq('parent_id', msg.id)
          .order('created_at', { ascending: true })
          .limit(3);

        const formattedReplies = (replies || []).map((reply) => ({
          ...reply,
          author: reply.is_ghost ? undefined : reply.users,
          reply_count: 0,
          delivery_status: 'delivered' as const,
        }));

        // Fetch poll data if this is a poll message
        let pollData = null;
        if (msg.message_type === 'poll') {
          const { data: poll } = await supabase
            .from('polls')
            .select('*')
            .eq('message_id', msg.id)
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
            const { data: { user } } = await supabase.auth.getUser();
            const { data: userVote } = await supabase
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
                created_at: new Date(msg.users.created_at).getTime()
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
                    created_at: new Date((reply as any).users.created_at).getTime()
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

      // Only update UI with Supabase data if we didn't already load from local storage
      if (!localDataLoaded) {
        set({ messages: structuredMessages, isLoading: false });
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      set({ isLoading: false });
    }
  },

  fetchMessageById: async (messageId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
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
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .eq('parent_id', messageId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return (data || []).map((reply) => ({
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
});