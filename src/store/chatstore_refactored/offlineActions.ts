import { supabase } from '@/lib/supabase';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { outboxProcessorInterval, setOutboxProcessorInterval } from './utils';

export interface OfflineActions {
  processOutbox: () => Promise<void>;
  setupNetworkListener: () => void;
  cleanupNetworkListener: () => void;
  startOutboxProcessor: () => void;
  stopOutboxProcessor: () => void;
  syncMessageRelatedData: (groupId: string, messages: any[]) => Promise<void>;
  forceMessageSync: (groupId: string) => Promise<void>;
}

export const createOfflineActions = (_set: any, get: any): OfflineActions => ({
  processOutbox: async () => {
    try {
      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) return;

      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;

      if (!isOnline) {
        console.log('📵 Cannot process outbox while offline');
        return;
      }

      console.log('🔄 Processing outbox messages...');

      // Get pending outbox messages
      const outboxMessages = await sqliteService.getOutboxMessages();

      if (outboxMessages.length === 0) {
        console.log('✅ No pending outbox messages to process');
        return;
      }

      console.log(`📤 Found ${outboxMessages.length} pending messages to send`);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('❌ Cannot process outbox: User not authenticated');
        return;
      }

      // Process each message
      for (const outboxItem of outboxMessages) {
        try {
          // Parse the content
          const messageData = JSON.parse(outboxItem.content);

          // Send to Supabase (don't include the temp ID, let Supabase generate a new one)
          const { data, error } = await supabase
            .from('messages')
            .insert({
              group_id: outboxItem.group_id,
              user_id: outboxItem.user_id,
              content: messageData.content,
              is_ghost: messageData.is_ghost,
              message_type: messageData.message_type,
              category: messageData.category,
              parent_id: messageData.parent_id,
              image_url: messageData.image_url,
            })
            .select(`
              *,
              reactions(*),
              users!messages_user_id_fkey(display_name, avatar_url)
            `)
            .single();

          if (error) {
            console.error(`❌ Error sending outbox message ${outboxItem.id}:`, error);

            // Update retry count and next retry time
            const nextRetry = Date.now() + (outboxItem.retry_count + 1) * 60000; // Exponential backoff
            await sqliteService.updateOutboxRetry(
              outboxItem.id!,
              outboxItem.retry_count + 1,
              nextRetry
            );
            continue;
          }

          console.log(`✅ Successfully sent outbox message ${outboxItem.id}`);

          // Remove from outbox
          await sqliteService.removeFromOutbox(outboxItem.id!);

          // Update the local message with the server-generated ID and data
          await sqliteService.saveMessage({
            id: data.id, // Use server ID
            group_id: data.group_id,
            user_id: data.user_id,
            content: data.content,
            is_ghost: data.is_ghost ? 1 : 0,
            message_type: data.message_type,
            category: data.category || null,
            parent_id: data.parent_id || null,
            image_url: data.image_url || null,
            created_at: new Date(data.created_at).getTime()
          });

          // Remove the temp message from local storage
          try {
            await sqliteService.deleteMessage(messageData.id);
          } catch (error) {
            console.error(`❌ Error removing temp message ${messageData.id}:`, error);
          }

          // Save user info if not ghost
          if (!data.is_ghost && data.users) {
            await sqliteService.saveUser({
              id: data.user_id,
              display_name: data.users.display_name,
              phone_number: data.users.phone_number || null,
              avatar_url: data.users.avatar_url || null,
              is_onboarded: 1,
              created_at: new Date(data.users.created_at).getTime()
            });
          }
        } catch (error) {
          console.error(`❌ Error processing outbox message ${outboxItem.id}:`, error);
        }
      }

      console.log('✅ Finished processing outbox');

      // Refresh the current group's messages if any were processed
      const state = get();
      if (state.activeGroup && outboxMessages.length > 0) {
        console.log('🔄 Refreshing messages after outbox processing...');
        await get().fetchMessages(state.activeGroup.id);
      }
    } catch (error) {
      console.error('❌ Error processing outbox:', error);
    }
  },

  setupNetworkListener: () => {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) return;

    console.log('🔌 Setting up network status listener');

    // Listen for network status changes
    Network.addListener('networkStatusChange', async ({ connected }) => {
      console.log(`🌐 Network status changed: ${connected ? 'online' : 'offline'}`);

      if (connected) {
        // Process outbox when coming back online
        console.log('🔄 Network is back online, processing outbox...');
        await get().processOutbox();
      }
    });
  },

  cleanupNetworkListener: () => {
    if (!Capacitor.isNativePlatform()) return;

    console.log('🧹 Cleaning up network status listener');
    Network.removeAllListeners();
  },

  startOutboxProcessor: () => {
    const { processOutbox } = get();

    // Clear any existing interval
    if (outboxProcessorInterval) {
      clearInterval(outboxProcessorInterval);
    }

    // Start processing outbox every 30 seconds
    const interval = setInterval(() => {
      processOutbox();
    }, 30000);

    setOutboxProcessorInterval(interval);

    // Process immediately
    processOutbox();
  },

  stopOutboxProcessor: () => {
    if (outboxProcessorInterval) {
      clearInterval(outboxProcessorInterval);
      setOutboxProcessorInterval(null);
    }
  },

  syncMessageRelatedData: async (groupId: string, messages: any[]) => {
    try {
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) return;

      console.log(`📊 Syncing message-related data for group ${groupId}...`);

      // Sync group data
      const { data: groupData } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .single();

      if (groupData) {
        await sqliteService.saveGroup({
          id: groupData.id,
          name: groupData.name,
          description: groupData.description,
          invite_code: groupData.invite_code,
          created_by: groupData.created_by,
          created_at: new Date(groupData.created_at).getTime(),
          last_sync_timestamp: Date.now(),
          avatar_url: groupData.avatar_url,
          is_archived: 0
        });
      }

      // Sync group members
      const { data: members } = await supabase
        .from('group_members')
        .select('*, users!group_members_user_id_fkey(*)')
        .eq('group_id', groupId);

      if (members) {
        for (const member of members) {
          await sqliteService.saveUser({
            id: member.user_id,
            display_name: member.users.display_name,
            phone_number: member.users.phone_number,
            avatar_url: member.users.avatar_url,
            is_onboarded: member.users.is_onboarded ? 1 : 0,
            created_at: new Date(member.users.created_at).getTime()
          });

          await sqliteService.saveGroupMember({
            group_id: groupId,
            user_id: member.user_id,
            role: member.role || 'participant',
            joined_at: new Date(member.joined_at).getTime()
          });
        }
      }

      // Sync reactions for all messages
      const messageIds = messages.map(msg => msg.id);
      if (messageIds.length > 0) {
        const { data: reactions } = await supabase
          .from('reactions')
          .select('*')
          .in('message_id', messageIds);

        if (reactions) {
          for (const reaction of reactions) {
            await sqliteService.saveReaction({
              id: reaction.id,
              message_id: reaction.message_id,
              user_id: reaction.user_id,
              emoji: reaction.emoji,
              created_at: new Date(reaction.created_at).getTime()
            });
          }
        }
      }

      // Sync polls for poll messages
      const pollMessages = messages.filter(msg => msg.message_type === 'poll');
      if (pollMessages.length > 0) {
        const { data: polls } = await supabase
          .from('polls')
          .select('*')
          .in('message_id', pollMessages.map(msg => msg.id));

        if (polls) {
          for (const poll of polls) {
            await sqliteService.savePoll({
              id: poll.id,
              message_id: poll.message_id,
              question: poll.question,
              options: JSON.stringify(poll.options),
              created_at: new Date(poll.created_at).getTime(),
              closes_at: new Date(poll.closes_at).getTime()
            });
          }
        }
      }

      console.log(`✅ Message-related data synced for group ${groupId}`);
    } catch (error) {
      console.error('❌ Error syncing message-related data:', error);
    }
  },

  forceMessageSync: async (groupId: string) => {
    try {
      console.log('🔄 Forcing full message sync for group:', groupId);

      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      if (!isSqliteReady) {
        console.log('❌ SQLite not available, cannot sync messages');
        return;
      }

      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;

      if (!isOnline) {
        console.log('❌ Cannot sync messages while offline');
        return;
      }

      // Fetch messages from Supabase
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

      // Sync user data first
      console.log(`🧑‍💼 Syncing user data for ${data?.length || 0} messages`);
      for (const message of data || []) {
        if (!message.is_ghost && message.users) {
          await sqliteService.saveUser({
            id: message.user_id,
            display_name: message.users.display_name,
            phone_number: message.users.phone_number || null,
            avatar_url: message.users.avatar_url || null,
            is_onboarded: 1,
            created_at: new Date(message.users.created_at).getTime()
          });
        }
      }

      // Then sync messages
      console.log(`📨 Syncing ${data?.length || 0} messages to local storage`);
      const syncCount = await sqliteService.syncMessagesFromRemote(groupId, data || []);

      // Sync reactions, polls, and other related data
      await get().syncMessageRelatedData(groupId, data || []);

      // Update last sync timestamp
      await sqliteService.updateLastSyncTimestamp(groupId, Date.now());

      console.log(`✅ Force sync complete: ${syncCount} messages synced to local storage`);

      // Refresh the UI by re-fetching messages
      await get().fetchMessages(groupId);

    } catch (error) {
      console.error('❌ Error force syncing messages:', error);
      throw error;
    }
  },
});