import { supabasePipeline, SupabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { useAuthStore } from '@/store/authStore';
import { Message } from './types';

export interface MessageActions {
  sendMessage: (groupId: string, content: string, isGhost: boolean, messageType?: string, category?: string | null, parentId?: string | null, pollId?: string | null, imageFile?: File | null) => Promise<void>;
}

export const createMessageActions = (set: any, get: any): MessageActions => ({
  sendMessage: async (groupId: string, content: string, isGhost: boolean, messageType = 'text', category: string | null = null, parentId: string | null = null, _pollId: string | null = null, imageFile: File | null = null) => {
    console.log('📤 sendMessage called:', { groupId, content, isGhost, messageType, isOnline: 'checking...' });
    
    // Declare messageId at function scope so it's accessible in catch block
    let messageId: string = 'unknown';
    
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
            const { data: { user: authUser } } = await supabasePipeline.getUser();
            user = authUser;
            console.log('✅ Got user from server:', !!user);
          } catch (error) {
            console.log('❌ Failed to get user from server:', error instanceof Error ? error.message : String(error));
            try {
              console.log('🔄 Falling back to local session...');
              const session = await supabasePipeline.getSession();
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

          // Upload to Supabase Storage via pipeline
          const { data: uploadData, error: uploadError } = await supabasePipeline.uploadFile(
            'chat-media',
            fileName,
            blob,
            {
              contentType: 'image/jpeg',
              upsert: false
            }
          );

          if (uploadError) throw uploadError;

          // Get public URL via pipeline
          const { data: { publicUrl } } = await supabasePipeline.getPublicUrl('chat-media', uploadData.path);

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
      messageId = isOnline ? clientMsgId : `temp-${clientMsgId}`;
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
            // Immediate outbox trigger for offline messages using unified system
            try {
              const { triggerOutboxProcessing } = get();
              if (typeof triggerOutboxProcessing === 'function') {
                triggerOutboxProcessing('offline-message', 'high');
              }
            } catch {}
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

      // Enhanced client health validation before sending
      console.log(`📤 Performing client health check before sending message ${messageId}`);
      
      // Check 1: Session validity
      let sessionValid = false;
      let clientHealthy = false;
      
      try {
        const sessionResult = await supabasePipeline.getSession();
        sessionValid = !!sessionResult?.data?.session?.access_token;
        console.log(`📤 Session validity check: ${sessionValid}`);
      } catch (e) {
        console.warn(`📤 Session check failed for message ${messageId}:`, e);
      }
      
      // Check 2: Quick connectivity test (if session is valid)
      if (sessionValid) {
        try {
          console.log(`📤 Testing client connectivity for message ${messageId}...`);
          const connectivityTest = await Promise.race([
            (async () => {
              const client = await supabasePipeline.getDirectClient();
              return client.from('messages').select('id').limit(1).then(() => true);
            })(),
            new Promise<boolean>((resolve) => 
              setTimeout(() => {
                console.log(`📤 Connectivity test timeout for message ${messageId}`);
                resolve(false);
              }, 2000)
            )
          ]);
          clientHealthy = connectivityTest;
          console.log(`📤 Client health check result: ${clientHealthy}`);
        } catch (e) {
          console.warn(`📤 Client health check failed for message ${messageId}:`, e);
          clientHealthy = false;
        }
      }
      
      // If client is not healthy, immediately fallback to outbox
      if (!sessionValid || !clientHealthy) {
        console.log(`📤 Client unhealthy (session: ${sessionValid}, connectivity: ${clientHealthy}), falling back to outbox for message ${messageId}`);
        
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
            console.log(`📤 Message ${messageId} enqueued to outbox due to unhealthy client`);
            
            // Trigger outbox processing immediately
            try {
              const { triggerOutboxProcessing } = get();
              if (typeof triggerOutboxProcessing === 'function') {
                triggerOutboxProcessing('unhealthy-client', 'high');
              }
            } catch {}
            
            return; // Exit early - outbox will handle delivery
          }
        } catch (outboxError) {
          console.error(`📤 Outbox fallback failed for unhealthy client - message ${messageId}:`, outboxError);
        }
        
        throw new Error(`Client unhealthy - session: ${sessionValid}, connectivity: ${clientHealthy}`);
      }
      
      // Client is healthy, proceed with direct send with enhanced retry logic
      console.log(`📤 Client healthy, proceeding with direct Supabase send for message ${messageId}`);
      
      let lastError: any = null;
      let retryCount = 0;
      const maxRetries = 3; // Initial attempt + 2 retries (increased for better reliability)
      let successData: any = undefined;

      while (retryCount <= maxRetries) {
        const attemptNum = retryCount + 1;
        const timeoutMs = retryCount === 0 ? 12000 : 18000; // 12s first attempt, 18s retry (increased for mobile networks)
        
        try {
          console.log(`📤 Attempt ${attemptNum}/${maxRetries + 1}: Sending message ${messageId} to Supabase...`);
          
          // Create the insert promise
          const client = await supabasePipeline.getDirectClient();
          const insertPromise = client
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
              users!messages_user_id_fkey(display_name, avatar_url, created_at)
            `)
            .single();
          
          console.log(`📤 Starting ${timeoutMs}ms timeout race for Supabase insert of message ${messageId} (attempt ${attemptNum})...`);
          const { data, error } = await Promise.race([
            insertPromise.then((result: any) => {
              console.log(`📤 Supabase insert completed for message ${messageId} (attempt ${attemptNum})`);
              return result;
            }),
            new Promise<never>((_, reject) => 
              setTimeout(() => {
                console.log(`📤 Supabase insert timeout reached for message ${messageId} (attempt ${attemptNum}) after ${timeoutMs}ms`);
                reject(new Error(`Supabase insert timeout after ${timeoutMs}ms (attempt ${attemptNum})`));
              }, timeoutMs)
            )
          ]);
          
          if (error) {
            console.error(`📤 Supabase error for message ${messageId} (attempt ${attemptNum}):`, error);
            lastError = error;
            
            // Determine if error is retryable
            const isRetryableError = (
              error.message?.includes('timeout') ||
              error.message?.includes('network') ||
              error.message?.includes('ENOTFOUND') ||
              error.message?.includes('ECONNRESET') ||
              error.code === 'PGRST301' || // JWT expired
              error.code === 'PGRST116'    // Row level security
            );
            
            if (retryCount < maxRetries && isRetryableError) {
              const backoffMs = 1000 * (retryCount + 1); // 1s, 2s backoff
              console.log(`📤 Retryable error for message ${messageId}, backing off ${backoffMs}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
              retryCount++;
              continue; // Try again
            } else {
              // Non-retryable error or max retries reached
              throw error;
            }
          }
          
          // Success! Store the result and break
          successData = data;
          break;
          
        } catch (attemptError: any) {
          console.error(`📤 Attempt ${attemptNum} failed for message ${messageId}:`, attemptError);
          lastError = attemptError;
          
          // Determine if error is retryable
          const isRetryableError = (
            attemptError.message?.includes('timeout') ||
            attemptError.message?.includes('network') ||
            attemptError.message?.includes('ENOTFOUND') ||
            attemptError.message?.includes('ECONNRESET') ||
            attemptError.code === 'PGRST301' || // JWT expired
            attemptError.code === 'PGRST116'    // Row level security
          );
          
          if (retryCount < maxRetries && isRetryableError) {
            const backoffMs = 1000 * (retryCount + 1); // 1s, 2s backoff
            console.log(`📤 Retryable error for message ${messageId}, backing off ${backoffMs}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            retryCount++;
            continue; // Try again
          } else {
            // Non-retryable error or max retries reached - fallback to outbox
            break;
          }
        }
      }
      
      // Check if we have successful data to process
      if (successData) {
        console.log(`📤 Successfully sent message ${messageId} to Supabase, got server ID: ${successData.id}`);

        // Replace optimistic message with real message
        const realMessage = {
          ...successData,
          author: successData.is_ghost ? undefined : successData.users,
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
              id: successData.id,
              group_id: successData.group_id,
              user_id: successData.user_id,
              content: successData.content,
              is_ghost: successData.is_ghost ? 1 : 0,
              message_type: successData.message_type,
              category: successData.category || null,
              parent_id: successData.parent_id || null,
              image_url: successData.image_url || null,
              created_at: new Date(successData.created_at).getTime()
            });

            // Save user info
            if (!successData.is_ghost && successData.users) {
              await sqliteService.saveUser({
                id: successData.user_id,
                display_name: successData.users.display_name,
                phone_number: successData.users.phone_number || null,
                avatar_url: successData.users.avatar_url || null,
                is_onboarded: 1,
                created_at: SupabasePipeline.safeTimestamp(successData.users.created_at)
              });
            }

            // Remove the temporary message if it exists (temp IDs are not UUIDs)
            // Temp IDs format: "temp-{timestamp}-{random}" or "{timestamp}-{random}"
            // Real IDs are UUIDs with format: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);
            if (!isUUID) {
              try {
                await sqliteService.deleteMessage(messageId);
                console.log(`🗑️ Removed temp message ${messageId} after saving server message ${successData.id}`);
              } catch (error) {
                console.error(`❌ Error removing temp message ${messageId}:`, error);
              }
            }

            console.log(`✅ Message ${successData.id} synced to local storage`);
          } catch (error) {
            console.error('❌ Error syncing message to local storage:', error);
          }
        }

        // Clear reply state if not in thread
        if (!get().activeThread) {
          set({ replyingTo: null });
        }

        // No cache invalidation here; realtime/outbox refresh handles updates
        
        return; // Success - exit function
      }
      
      // If we get here, all attempts failed - graceful fallback to outbox
      console.log(`📤 All direct send attempts failed for ${messageId}, falling back to outbox`);
      console.error(`📤 Final error for message ${messageId}:`, lastError);
      
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
          console.log(`📤 Message ${messageId} enqueued to outbox after all direct send attempts failed`);
          
          // Trigger outbox processing immediately
          try {
            const { triggerOutboxProcessing } = get();
            if (typeof triggerOutboxProcessing === 'function') {
              triggerOutboxProcessing('direct-send-exhausted', 'high');
            }
          } catch {}
          
          // Don't throw error - let outbox handle delivery
          return;
        }
      } catch (outboxError) {
        console.error(`📤 Outbox fallback also failed for ${messageId}:`, outboxError);
      }
      
      throw lastError || new Error('All send attempts failed');
      
    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // Enhanced error categorization
      const errorCategory = (() => {
        if (error.message?.includes('timeout')) return 'timeout';
        if (error.message?.includes('network') || error.message?.includes('ENOTFOUND')) return 'network';
        if (error.code === 'PGRST301' || error.code === 'PGRST116') return 'auth';
        if (error.message?.includes('Client unhealthy')) return 'client';
        return 'server';
      })();
      
      console.log(`📤 Error category for message ${messageId}: ${errorCategory}`);

      // Update optimistic message to show failed status with error info
      const updateMessageStatus = (msg: Message) => {
        if (msg.id === messageId || msg.id.startsWith('temp-')) {
          return { 
            ...msg, 
            delivery_status: 'failed' as const,
            error_info: { category: errorCategory, message: error.message }
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
              replies: (msg.replies || []).map(updateMessageStatus),
            };
          }
          return msg;
        });
        set({ messages: updatedMessages });
      } else {
        const state = get();
        const updatedMessages = state.messages.map(updateMessageStatus);
        set({ messages: updatedMessages });
      }

      // For certain error categories, don't throw (outbox will handle)
      if (errorCategory === 'timeout' || errorCategory === 'network' || errorCategory === 'client') {
        console.log(`📤 Final fallback: marking message ${messageId} as failed`);
        return; // Don't throw - message is marked as failed in UI
      }
      
      throw error;
    }
  },
});
