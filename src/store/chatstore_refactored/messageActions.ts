import { supabase } from '@/lib/supabase';
import { sqliteService } from '@/lib/sqliteService';
import { messageCache } from '@/lib/messageCache';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { useAuthStore } from '@/store/authStore';
import { Message } from './types';
import { ensureAuthForWrites } from './utils';
import { FEATURES_PUSH } from '@/lib/featureFlags';

export interface MessageActions {
  sendMessage: (groupId: string, content: string, isGhost: boolean, messageType?: string, category?: string | null, parentId?: string | null, pollId?: string | null, imageFile?: File | null) => Promise<void>;
}

export const createMessageActions = (set: any, get: any): MessageActions => ({
  sendMessage: async (groupId: string, content: string, isGhost: boolean, messageType = 'text', category: string | null = null, parentId: string | null = null, _pollId: string | null = null, imageFile: File | null = null) => {
    console.log('📤 sendMessage called:', { groupId, content, isGhost, messageType, isOnline: 'checking...' });
    try {
      // Check network status first
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      console.log('🌐 Network status:', { isOnline, connectionType: networkStatus.connectionType });

      // Check if we're on a native platform with SQLite available
      const isNative = Capacitor.isNativePlatform();
      const isSqliteReady = isNative && await sqliteService.isReady();

      // Get user - handle offline case gracefully
      console.log('🔐 Getting user authentication...');
      let user;
      
      if (!isOnline) {
        // When offline, get user from auth store (no network calls)
        console.log('📵 Offline: Getting user from auth store');
        try {
          const authStore = useAuthStore.getState();
          user = authStore.user || authStore.session?.user || null;
          console.log('📱 Got user from auth store:', !!user, user?.id);
        } catch (error) {
          console.log('❌ Failed to get user from auth store:', error instanceof Error ? error.message : String(error));
          user = null;
        }
      } else {
        // When online, prefer fast local store user/session to avoid blocking on auth
        const authStore = useAuthStore.getState();
        if (authStore?.user || authStore?.session?.user) {
          user = authStore.user || authStore.session?.user;
          console.log('📱 Got user from auth store/session (online):', !!user);
        } else {
          // Fallback to Supabase methods only if absolutely necessary
          try {
            const { data: { user: authUser } } = await supabase.auth.getUser();
            user = authUser;
            console.log('✅ Got user from server:', !!user);
          } catch (error) {
            console.log('❌ Failed to get user from server:', error instanceof Error ? error.message : String(error));
            try {
              console.log('🔄 Falling back to local session...');
              const session = await supabase.auth.getSession();
              user = session.data.session?.user || null;
              console.log('📱 Got user from local session fallback:', !!user);
            } catch (sessionError) {
              console.log('❌ Local session fallback failed:', sessionError instanceof Error ? sessionError.message : String(sessionError));
              throw error; // Throw original error
            }
          }
        }
      }

      if (!user) {
        console.log('❌ No user found, throwing authentication error');
        throw new Error('Not authenticated');
      }
      
      console.log('✅ User authenticated, proceeding with message send');

      let imageUrl: string | null = null;

      // Upload image if provided - only possible when online
      if (imageFile && isOnline) {
        get().setUploadingFile(true);

        try {
          // Compress and resize image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = URL.createObjectURL(imageFile);
          });

          // Calculate new dimensions (max 1200px width/height)
          const maxSize = 1200;
          let { width, height } = img;

          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;

          ctx?.drawImage(img, 0, 0, width, height);

          // Convert to blob with compression
          const blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.8);
          });

          // Create file name
          const fileName = `${user.id}/${Date.now()}_${imageFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

          // Upload to Supabase Storage
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('chat-media')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              upsert: false
            });

          if (uploadError) throw uploadError;

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('chat-media')
            .getPublicUrl(uploadData.path);

          imageUrl = publicUrl;

          // Clean up
          URL.revokeObjectURL(img.src);
        } catch (error) {
          console.error('Error uploading image:', error);
          throw new Error('Failed to upload image');
        } finally {
          get().setUploadingFile(false);
        }
      } else if (imageFile && !isOnline) {
        // Cannot upload images when offline
        console.warn('⚠️ Cannot upload images when offline');
        throw new Error('Cannot upload images when offline');
      }

      // Generate client ids: client-visible temp id, plus dedupe_key for server idempotency
      const clientMsgId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const messageId = isOnline ? clientMsgId : `temp-${clientMsgId}`;
      const dedupeKey = `d:${user.id}:${groupId}:${clientMsgId}`;

      // Create optimistic message
      const optimisticMessage: Message = {
        id: messageId,
        group_id: groupId,
        user_id: user.id,
        content,
        is_ghost: isGhost,
        message_type: messageType,
        category,
        parent_id: parentId,
        image_url: imageUrl,
        created_at: new Date().toISOString(),
        author: isGhost ? undefined : { display_name: 'You', avatar_url: null },
        reply_count: 0,
        replies: [],
        reactions: [],
        delivery_status: 'sending',
        dedupe_key: dedupeKey,
      };

      // Add optimistic message to UI
      console.log('📤 Adding optimistic message to UI:', { messageId, content, parentId });
      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map((msg: Message) => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: [...(msg.replies || []), optimisticMessage],
              reply_count: (msg.reply_count || 0) + 1,
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });
        console.log('📤 Added reply to parent message');

        if (state.activeThread?.id === parentId) {
          set({ threadReplies: [...state.threadReplies, optimisticMessage] });
        }
      } else {
        get().addMessage(optimisticMessage);
        console.log('📤 Added new message to chat');
      }

      // Stop typing indicator
      get().sendTypingStatus(false, isGhost);

      // Persist draft immediately for guaranteed recovery (even online, for durability)
      try {
        await get().markMessageAsDraft({
          id: messageId,
          group_id: groupId,
          user_id: user.id,
          content,
          is_ghost: isGhost,
          message_type: messageType,
          category: category || null,
          parent_id: parentId || null,
          image_url: imageUrl || null,
          created_at: Date.now()
        });
      } catch (_) {}

      // If offline, handle message appropriately
      if (!isOnline) {
        if (isSqliteReady) {
          try {
            console.log('📵 Offline mode: Enqueueing message to outbox');
            await get().enqueueOutbox({
              id: messageId,
              group_id: groupId,
              user_id: user.id,
              content,
              is_ghost: isGhost,
              message_type: messageType,
              category: category || null,
              parent_id: parentId || null,
              image_url: imageUrl || null
            });

            console.log('✅ Message saved to local storage and outbox');
          } catch (error) {
            console.error('❌ Error saving offline message:', error);
            // Don't throw error, just log it and continue with optimistic UI update
          }
        } else {
          console.log('📵 Offline mode: SQLite not available, showing optimistic message only');
        }

        // Update message status - keep as 'sending' when offline to show clock icon
        const updatedMessage = { 
          ...optimisticMessage, 
          delivery_status: 'sending' as const 
        };

        if (parentId) {
          const state = get();
          const updatedMessages = state.messages.map((msg: Message) => {
            if (msg.id === parentId) {
              return {
                ...msg,
                replies: (msg.replies || []).map(reply =>
                  reply.id === messageId ? updatedMessage : reply
                ),
                reply_count: (msg.reply_count || 0) + 1,
              };
            }
            return msg;
          });
          set({ messages: updatedMessages });

          if (state.activeThread?.id === parentId) {
            const updatedReplies = state.threadReplies.map((reply: Message) =>
              reply.id === messageId ? updatedMessage : reply
            );
            set({ threadReplies: updatedReplies });
          }
        } else {
          const state = get();
          const updatedMessages = state.messages.map((msg: Message) =>
            msg.id === messageId ? updatedMessage : msg
          );
          set({ messages: updatedMessages });
        }

        // Clear reply state if not in thread
        if (!get().activeThread) {
          set({ replyingTo: null });
        }

        return;
      }

      // If online, ensure auth for writes before hitting Supabase
      if (FEATURES_PUSH.enabled && !FEATURES_PUSH.killSwitch) {
        const authOk = await ensureAuthForWrites();
        if (!authOk.canWrite) {
          // Short defer then enqueue to outbox; return to avoid duplicate online upsert
          console.log('[outbox] deferred reason=auth_refresh');
          await new Promise((r) => setTimeout(r, Math.min(1200, Math.max(300, FEATURES_PUSH.outbox.retryShortDelayMs))));
          try {
            const isNative = Capacitor.isNativePlatform();
            const ready = isNative && await sqliteService.isReady();
            if (ready) {
              await get().enqueueOutbox({
                id: messageId,
                group_id: groupId,
                user_id: user.id,
                content,
                is_ghost: isGhost,
                message_type: messageType,
                category: category || null,
                parent_id: parentId || null,
                image_url: imageUrl || null,
              });
            }
          } catch {}
          return; // Let outbox handle delivery
        }
      }

      const { data, error } = await supabase
        .from('messages')
        .upsert({
          group_id: groupId,
          user_id: user.id,
          content,
          is_ghost: isGhost,
          message_type: messageType,
          category,
          parent_id: parentId,
          image_url: imageUrl,
          dedupe_key: dedupeKey,
        }, { onConflict: 'dedupe_key' })
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url)
        `)
        .single();

      if (error) throw error;

      // Replace optimistic message with real message
      const realMessage = {
        ...data,
        author: data.is_ghost ? undefined : data.users,
        reply_count: 0,
        replies: [],
        delivery_status: 'sent' as const,
      };

      // Update the optimistic message with real data
      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map((msg: Message) => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: (msg.replies || []).map(reply =>
                reply.id === messageId ? realMessage : reply
              ),
              reply_count: (msg.reply_count || 0) + 1,
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });

        if (state.activeThread?.id === parentId) {
          const updatedReplies = state.threadReplies.map((reply: Message) =>
            reply.id === messageId ? realMessage : reply
          );
          set({ threadReplies: updatedReplies });
        }
      } else {
        // Replace the optimistic message with the real one
        const state = get();
        const updatedMessages = state.messages.map((msg: Message) =>
          msg.id === messageId ? realMessage : msg
        );
        set({ messages: updatedMessages });
      }

      // Save message to local storage for offline access
      if (isSqliteReady) {
        try {
          // Save message with server ID
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

          // Save user info
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

          // Remove the temporary message if it exists
          if (messageId.startsWith('temp-') || messageId.includes('-')) {
            try {
              await sqliteService.deleteMessage(messageId);
              console.log(`🗑️ Removed temp message ${messageId} after saving server message ${data.id}`);
            } catch (error) {
              console.error(`❌ Error removing temp message ${messageId}:`, error);
            }
          }

          console.log(`✅ Message ${data.id} synced to local storage`);
        } catch (error) {
          console.error('❌ Error syncing message to local storage:', error);
        }
      }

      // Clear reply state if not in thread
      if (!get().activeThread) {
        set({ replyingTo: null });
      }

      // Invalidate cache for this group since we added a new message
      messageCache.invalidateCache(groupId);
      console.log(`📦 MessageCache: Invalidated cache for group ${groupId} after sending message`);
    } catch (error) {
      console.error('Error sending message:', error);

      // Update optimistic message to show failed status
      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map((msg: Message) => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: (msg.replies || []).map(reply =>
                reply.id.startsWith('temp-')
                  ? { ...reply, delivery_status: 'failed' as const }
                  : reply
              ),
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });
      } else {
        const state = get();
        const updatedMessages = state.messages.map((msg: Message) =>
          msg.id.startsWith('temp-')
            ? { ...msg, delivery_status: 'failed' as const }
            : msg
        );
        set({ messages: updatedMessages });
      }

      throw error;
    }
  },
});