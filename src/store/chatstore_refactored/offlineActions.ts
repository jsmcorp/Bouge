import { supabase } from '@/lib/supabase';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { outboxProcessorInterval, setOutboxProcessorInterval } from './utils';

// Concurrency guard to prevent duplicate processing runs
let isProcessingOutbox = false;

export interface OfflineActions {
  processOutbox: () => Promise<void>;
  setupNetworkListener: () => void;
  cleanupNetworkListener: () => void;
  startOutboxProcessor: () => void;
  stopOutboxProcessor: () => void;
  syncMessageRelatedData: (groupId: string, messages: any[]) => Promise<void>;
  forceMessageSync: (groupId: string) => Promise<void>;
}

// 🔁 Helpers to remove duplicate code
async function checkSqliteReady(): Promise<boolean> {
  const isNative = Capacitor.isNativePlatform();
  return isNative && await sqliteService.isReady();
}

async function checkOnline(): Promise<boolean> {
  const networkStatus = await Network.getStatus();
  return networkStatus.connected;
}

async function saveUserFromSupabase(user: any) {
  if (!user) return;
  await sqliteService.saveUser({
    id: user.id,
    display_name: user.display_name,
    phone_number: user.phone_number || null,
    avatar_url: user.avatar_url || null,
    is_onboarded: user.is_onboarded ? 1 : 0,
    created_at: new Date(user.created_at).getTime()
  });
}

export const createOfflineActions = (_set: any, get: any): OfflineActions => ({
  processOutbox: async () => {
    try {
      if (isProcessingOutbox) {
        console.log('⏳ Outbox processing already in progress; skipping concurrent run');
        return;
      }
      isProcessingOutbox = true;
      if (!await checkSqliteReady()) return;
      if (!await checkOnline()) {
        console.log('📵 Cannot process outbox while offline');
        return;
      }

      console.log('🔄 Processing outbox messages...');
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

      for (const outboxItem of outboxMessages) {
        try {
          const messageData = JSON.parse(outboxItem.content);

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
            const nextRetry = Date.now() + (outboxItem.retry_count + 1) * 60000;
            await sqliteService.updateOutboxRetry(
              outboxItem.id!,
              outboxItem.retry_count + 1,
              nextRetry
            );
            continue;
          }

          console.log(`✅ Successfully sent outbox message ${outboxItem.id}`);
          await sqliteService.removeFromOutbox(outboxItem.id!);

          const state = get();
          if (messageData.parent_id) {
            const updatedMessages = state.messages.map((msg: any) => {
              if (msg.id === messageData.parent_id) {
                return {
                  ...msg,
                  replies: (msg.replies || []).map((reply: any) =>
                    reply.id === messageData.id 
                      ? { 
                          ...reply, 
                          delivery_status: 'delivered', 
                          id: data.id,
                          created_at: data.created_at
                        }
                      : reply
                  ),
                };
              }
              return msg;
            });
            _set({ messages: updatedMessages });

            if (state.activeThread?.id === messageData.parent_id) {
              const updatedReplies = state.threadReplies.map((reply: any) =>
                reply.id === messageData.id 
                  ? { ...reply, delivery_status: 'delivered', id: data.id, created_at: data.created_at }
                  : reply
              );
              _set({ threadReplies: updatedReplies });
            }
          } else {
            // Update the optimistic message to the real ID and delivered status
            const updatedMessages = state.messages.map((msg: any) =>
              msg.id === messageData.id 
                ? { ...msg, delivery_status: 'delivered', id: data.id, created_at: data.created_at }
                : msg
            );
            _set({ messages: updatedMessages });
          }

          await sqliteService.saveMessage({
            id: data.id,
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

          try {
            await sqliteService.deleteMessage(messageData.id);
            console.log(`🗑️ Removed temp message ${messageData.id} after successful sync`);
          } catch (error) {
            console.error(`❌ Error removing temp message ${messageData.id}:`, error);
          }

          if (!data.is_ghost && data.users) {
            await saveUserFromSupabase({ ...data.users, id: data.user_id, is_onboarded: 1 });
          }
        } catch (error) {
          console.error(`❌ Error processing outbox message ${outboxItem.id}:`, error);
        }
      }

      console.log('✅ Finished processing outbox');
      const state = get();
      if (state.activeGroup && outboxMessages.length > 0) {
        console.log('🔄 Refreshing messages after outbox processing...');
        await get().fetchMessages(state.activeGroup.id);
      }
    } catch (error) {
      console.error('❌ Error processing outbox:', error);
    } finally {
      isProcessingOutbox = false;
    }
  },

  setupNetworkListener: () => {
    if (!Capacitor.isNativePlatform()) return;
    console.log('🔌 Setting up network status listener');
    Network.addListener('networkStatusChange', async ({ connected }) => {
      console.log(`🌐 Network status changed: ${connected ? 'online' : 'offline'}`);
      if (connected) {
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
    if (outboxProcessorInterval) clearInterval(outboxProcessorInterval);
    const interval = setInterval(() => { processOutbox(); }, 30000);
    setOutboxProcessorInterval(interval);
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
      if (!await checkSqliteReady()) return;
      console.log(`📊 Syncing message-related data for group ${groupId}...`);

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

      const { data: members } = await supabase
        .from('group_members')
        .select('*, users!group_members_user_id_fkey(*)')
        .eq('group_id', groupId);

      if (members) {
        for (const member of members) {
          await saveUserFromSupabase(member.users);
          await sqliteService.saveGroupMember({
            group_id: groupId,
            user_id: member.user_id,
            role: member.role || 'participant',
            joined_at: new Date(member.joined_at).getTime()
          });
        }
      }

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
      if (!await checkSqliteReady()) {
        console.log('❌ SQLite not available, cannot sync messages');
        return;
      }
      if (!await checkOnline()) {
        console.log('❌ Cannot sync messages while offline');
        return;
      }

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

      console.log(`🧑‍💼 Syncing user data for ${data?.length || 0} messages`);
      for (const message of data || []) {
        if (!message.is_ghost && message.users) {
          await saveUserFromSupabase({ ...message.users, id: message.user_id, is_onboarded: 1 });
        }
      }

      console.log(`📨 Syncing ${data?.length || 0} messages to local storage`);
      const syncCount = await sqliteService.syncMessagesFromRemote(groupId, data || []);
      await get().syncMessageRelatedData(groupId, data || []);
      await sqliteService.updateLastSyncTimestamp(groupId, Date.now());

      console.log(`✅ Force sync complete: ${syncCount} messages synced to local storage`);
      await get().fetchMessages(groupId);
    } catch (error) {
      console.error('❌ Error force syncing messages:', error);
      throw error;
    }
  },
});
