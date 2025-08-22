import { supabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { messageCache } from '@/lib/messageCache';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { useAuthStore } from '@/store/authStore';
import { Message } from './types';

// Use pipeline's device unlock tracking
export const markDeviceUnlock = () => {
  supabasePipeline.markDeviceUnlocked();
};

export interface MessageActions {
  sendMessage: (groupId: string, content: string, isGhost: boolean, messageType?: string, category?: string | null, parentId?: string | null, pollId?: string | null, imageFile?: File | null) => Promise<void>;
}

export const createMessageActions = (set: any, get: any): MessageActions => ({
  sendMessage: async (groupId: string, content: string, isGhost: boolean, messageType = 'text', category: string | null = null, parentId: string | null = null, _pollId: string | null = null, imageFile: File | null = null) => {
    console.log('📤 sendMessage called:', { groupId, content, isGhost, messageType });
    
    let messageId: string = 'unknown';
    
    try {
      // Check network status
      const networkStatus = await Network.getStatus();
      const isOnline = networkStatus.connected;
      console.log('🌐 Network status:', { isOnline, connectionType: networkStatus.connectionType });

      // Get user from auth store (prefer local to avoid network calls)
      const authStore = useAuthStore.getState();
      let user = authStore.user || authStore.session?.user || null;
      
      // Fallback to Supabase client if no local user and we're online
      if (!user && isOnline) {
        try {
          const client = await supabasePipeline.getDirectClient();
          const { data: { user: authUser } } = await client.auth.getUser();
          user = authUser;
        } catch (error) {
          console.log('❌ Failed to get user from client:', error);
        }
      }

      if (!user) {
        throw new Error('Not authenticated');
      }

      let imageUrl: string | null = null;

      // Handle image upload if provided and online
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

          // Upload to Supabase Storage using direct client
          const client = await supabasePipeline.getDirectClient();
          const { data: uploadData, error: uploadError } = await client.storage
            .from('chat-media')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              upsert: false
            });

          if (uploadError) throw uploadError;

          // Get public URL
          const { data: { publicUrl } } = client.storage
            .from('chat-media')
            .getPublicUrl(uploadData.path);

          imageUrl = publicUrl;
          URL.revokeObjectURL(img.src);
        } catch (error) {
          console.error('Error uploading image:', error);
          throw new Error('Failed to upload image');
        } finally {
          get().setUploadingFile(false);
        }
      } else if (imageFile && !isOnline) {
        throw new Error('Cannot upload images when offline');
      }

      // Generate message ID and dedupe key
      const clientMsgId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      messageId = isOnline ? clientMsgId : `temp-${clientMsgId}`;
      const dedupeKey = `d:${user.id}:${groupId}:${clientMsgId}`;

      // Create optimistic message for UI
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

        if (state.activeThread?.id === parentId) {
          set({ threadReplies: [...state.threadReplies, optimisticMessage] });
        }
      } else {
        get().addMessage(optimisticMessage);
      }

      // Stop typing indicator
      get().sendTypingStatus(false, isGhost);

      // Persist draft for recovery
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

      // If offline, queue for later and return
      if (!isOnline) {
        const isNative = Capacitor.isNativePlatform();
        const isSqliteReady = isNative && await sqliteService.isReady();
        
        if (isSqliteReady) {
          try {
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

            const { triggerOutboxProcessing } = get();
            if (typeof triggerOutboxProcessing === 'function') {
              triggerOutboxProcessing('offline-message', 'high');
            }
          } catch (error) {
            console.error('❌ Error saving offline message:', error);
          }
        }
        return; // Exit - message will be sent when online
      }

      // Online: Use pipeline to send message
      const messageForPipeline = {
        id: messageId,
        group_id: groupId,
        user_id: user.id,
        content,
        is_ghost: isGhost,
        message_type: messageType,
        category,
        parent_id: parentId,
        image_url: imageUrl,
        dedupe_key: dedupeKey,
      };

      try {
        // Send through pipeline (handles retries, health checks, fallback to outbox)
        await supabasePipeline.sendMessage(messageForPipeline);

        // If we get here, it was directly sent. Mark as sent.
        const updateMessageToSent = (msg: Message) => {
          if (msg.id === messageId) {
            return { ...msg, delivery_status: 'sent' as const };
          }
          return msg;
        };

        if (parentId) {
          const state = get();
          const updatedMessages = state.messages.map((msg: Message) => {
            if (msg.id === parentId) {
              return {
                ...msg,
                replies: (msg.replies || []).map(updateMessageToSent),
              };
            }
            return msg;
          });
          set({ messages: updatedMessages });

          if (state.activeThread?.id === parentId) {
            const updatedReplies = state.threadReplies.map(updateMessageToSent);
            set({ threadReplies: updatedReplies });
          }
        } else {
          const state = get();
          const updatedMessages = state.messages.map(updateMessageToSent);
          set({ messages: updatedMessages });
        }

        // Clear reply state if not in thread
        if (!get().activeThread) {
          set({ replyingTo: null });
        }

        // Invalidate message cache for this group
        messageCache.invalidateCache(groupId);

      } catch (error: any) {
        console.error('📤 Pipeline send outcome for message:', messageId, error);
        
        // If queued to outbox, keep UI in 'sending' (WhatsApp-style), do not mark failed/sent
        if (error?.code === 'QUEUED_OUTBOX' || error?.name === 'MessageQueuedError') {
          // Optionally we could tag a subtle queued flag, but we keep 'sending'
          console.log('📦 Message queued to outbox; keeping delivery_status as sending');
        } else {
          // Mark as failed only for real errors
          const updateMessageToFailed = (msg: Message) => {
            if (msg.id === messageId) {
              return { 
                ...msg, 
                delivery_status: 'failed' as const,
                error_info: { category: 'send_failed', message: error?.message }
              };
            }
            return msg;
          };

          if (parentId) {
            const state = get();
            const updatedMessages = state.messages.map((msg: Message) => {
              if (msg.id === parentId) {
                return {
                  ...msg,
                  replies: (msg.replies || []).map(updateMessageToFailed),
                };
              }
              return msg;
            });
            set({ messages: updatedMessages });

            if (state.activeThread?.id === parentId) {
              const updatedReplies = state.threadReplies.map(updateMessageToFailed);
              set({ threadReplies: updatedReplies });
            }
          } else {
            const state = get();
            const updatedMessages = state.messages.map(updateMessageToFailed);
            set({ messages: updatedMessages });
          }
        }

        // Do not throw; pipeline/outbox handles retries
      }
      
    } catch (error: any) {
      console.error('❌ Send message error:', error);
      
      // Update UI to show error
      const updateMessageToError = (msg: Message) => {
        if (msg.id === messageId) {
          return { 
            ...msg, 
            delivery_status: 'failed' as const,
            error_info: { category: 'error', message: error.message }
          };
        }
        return msg;
      };

      if (parentId) {
        const state = get();
        const updatedMessages = state.messages.map((msg: Message) => {
          if (msg.id === parentId) {
            return {
              ...msg,
              replies: (msg.replies || []).map(updateMessageToError),
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });
      } else {
        const state = get();
        const updatedMessages = state.messages.map(updateMessageToError);
        set({ messages: updatedMessages });
      }

      // Only throw for critical errors like auth issues
      if (error.message?.includes('Not authenticated')) {
        throw error;
      }
    }
  },
});
