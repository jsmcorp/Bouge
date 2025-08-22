import { supabase } from '@/lib/supabase';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { outboxProcessorInterval, setOutboxProcessorInterval } from './utils';
import { FEATURES_PUSH } from '@/lib/featureFlags';

// ============================================================================
// UNIFIED OUTBOX PROCESSING TRIGGER SYSTEM
// ============================================================================

// Processing state
let isProcessingOutbox = false;
let pendingRerunCount = 0; // Count instead of boolean to handle multiple rapid triggers
let processingWatchdog: NodeJS.Timeout | null = null;
let triggerTimeout: NodeJS.Timeout | null = null;
let watchdogTimeoutCount = 0; // Track consecutive watchdog timeouts to prevent infinite loops

// Reset processing state (called from realtime cleanup/reconnect)
export const resetOutboxProcessingState = () => {
  console.log('[outbox-unified] Resetting outbox processing state');
  isProcessingOutbox = false;
  pendingRerunCount = 0;
  if (processingWatchdog) {
    clearTimeout(processingWatchdog);
    processingWatchdog = null;
  }
  if (triggerTimeout) {
    clearTimeout(triggerTimeout);
    triggerTimeout = null;
  }
  // Reset watchdog timeout count on manual reset
  watchdogTimeoutCount = 0;
  console.log('[outbox-unified] Reset watchdog timeout count - state cleared, no auto-trigger');
};

// Unified trigger system - this is the ONLY way to trigger outbox processing
export const triggerOutboxProcessing = (context: string, priority: 'immediate' | 'high' | 'normal' | 'low' = 'normal') => {
  console.log(`[outbox-unified] Trigger requested from: ${context} (priority: ${priority})`);
  
  if (isProcessingOutbox) {
    pendingRerunCount++;
    console.log(`[outbox-unified] Processing active, queued rerun #${pendingRerunCount} from: ${context}`);
    return;
  }
  
  // Clear any existing trigger timeout
  if (triggerTimeout) {
    clearTimeout(triggerTimeout);
    triggerTimeout = null;
  }
  
  // Simplified debouncing with shorter delays for better responsiveness
  const delays = {
    immediate: 0,       // For critical situations (resets, errors)
    high: 50,          // For important events (network reconnect, auth refresh)
    normal: 75,        // For normal operations (user sends message)
    low: 100          // For background operations (no more periodic)
  };
  
  const delay = delays[priority];
  console.log(`[outbox-unified] Scheduling processing in ${delay}ms for: ${context}`);
  
  triggerTimeout = setTimeout(async () => {
    triggerTimeout = null;
    try {
      // Get the latest store state and call processOutbox
      const { useChatStore } = await import('../chatstore_refactored');
      const processOutbox = useChatStore.getState().processOutbox;
      if (typeof processOutbox === 'function') {
        await processOutbox();
      } else {
        console.warn('[outbox-unified] processOutbox function not available');
      }
    } catch (error) {
      console.error(`[outbox-unified] Error processing outbox from ${context}:`, error);
    }
  }, delay);
};

export interface OfflineActions {
  processOutbox: () => Promise<void>;
  startOutboxProcessor: () => void;
  stopOutboxProcessor: () => void;
  syncMessageRelatedData: (groupId: string, messages: any[]) => Promise<void>;
  forceMessageSync: (groupId: string) => Promise<void>;
  // Unified trigger system
  triggerOutboxProcessing: (context: string, priority?: 'immediate' | 'high' | 'normal' | 'low') => void;
  // New lifecycle helpers for guaranteed delivery
  markMessageAsDraft: (msg: {
    id: string; group_id: string; user_id: string; content: string; is_ghost: boolean;
    message_type: string; category: string | null; parent_id: string | null;
    image_url: string | null; created_at: number;
  }) => Promise<void>;
  enqueueOutbox: (msg: {
    id: string; group_id: string; user_id: string; content: string; is_ghost: boolean;
    message_type: string; category: string | null; parent_id: string | null; image_url: string | null;
  }) => Promise<void>;
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
  // Unified trigger system - accessible as a store action
  triggerOutboxProcessing: (context: string, priority: 'immediate' | 'high' | 'normal' | 'low' = 'normal') => {
    triggerOutboxProcessing(context, priority);
  },
  // Draft stage: persist local message immediately for guaranteed recovery
  markMessageAsDraft: async (msg) => {
    try {
      const isNative = Capacitor.isNativePlatform();
      const ready = isNative && await sqliteService.isReady();
      if (!ready) return;
      await sqliteService.saveMessage({
        id: msg.id,
        group_id: msg.group_id,
        user_id: msg.user_id,
        content: msg.content,
        is_ghost: msg.is_ghost ? 1 : 0,
        message_type: msg.message_type,
        category: msg.category || null,
        parent_id: msg.parent_id || null,
        image_url: msg.image_url || null,
        created_at: msg.created_at
      });
    } catch (e) {
      console.error('❌ markMessageAsDraft failed:', e);
    }
  },

  // Outbox stage: persist retry metadata so retries survive restarts
  enqueueOutbox: async (msg) => {
    console.log(`[outbox-enqueue] Enqueueing message ${msg.id} to outbox...`);
    try {
      const isNative = Capacitor.isNativePlatform();
      const ready = isNative && await sqliteService.isReady();
      if (!ready) {
        console.log(`[outbox-enqueue] SQLite not ready for message ${msg.id}`);
        return;
      }
      console.log(`[outbox-enqueue] Adding message ${msg.id} to SQLite outbox...`);
      await sqliteService.addToOutbox({
        group_id: msg.group_id,
        user_id: msg.user_id,
        content: JSON.stringify({
          id: msg.id,
          content: msg.content,
          is_ghost: msg.is_ghost,
          message_type: msg.message_type,
          category: msg.category,
          parent_id: msg.parent_id,
          image_url: msg.image_url
        }),
        retry_count: 0,
        next_retry_at: Date.now(),
        message_type: msg.message_type,
        category: msg.category,
        parent_id: msg.parent_id,
        image_url: msg.image_url,
        is_ghost: msg.is_ghost ? 1 : 0
      });
      
      console.log(`[outbox-enqueue] Successfully enqueued message ${msg.id}, triggering processing...`);
      // Trigger processing immediately after enqueueing
      triggerOutboxProcessing('enqueue-outbox', 'high');
    } catch (e) {
      console.error(`[outbox-enqueue] Failed to enqueue message ${msg.id}:`, e);
    }
  },
  processOutbox: async () => {
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      if (isProcessingOutbox) {
        pendingRerunCount++;
        console.log(`[outbox-unified] Processing already active, queued rerun #${pendingRerunCount}`);
        return;
      }
      
      isProcessingOutbox = true;
      console.log(`[outbox-unified] Starting processing session ${sessionId}`);
      
      // Set watchdog to prevent permanent blocking (reduced to 15 second timeout)
      processingWatchdog = setTimeout(() => {
        watchdogTimeoutCount++;
        console.warn(`⚠️ [outbox-unified] Watchdog timeout after 15s - session ${sessionId} - timeout count: ${watchdogTimeoutCount}`);
        
        // If we've had too many consecutive timeouts, stop triggering to prevent infinite loops
        if (watchdogTimeoutCount >= 5) {
          console.warn(`⚠️ [outbox-unified] Too many consecutive timeouts (${watchdogTimeoutCount}), stopping auto-recovery`);
          isProcessingOutbox = false;
          pendingRerunCount = 0;
          if (processingWatchdog) {
            clearTimeout(processingWatchdog);
            processingWatchdog = null;
          }
          return;
        }
        
        resetOutboxProcessingState();
      }, 15000);
      console.log(`[outbox-unified] ${sessionId} - Checking SQLite readiness...`);
      if (!await checkSqliteReady()) {
        console.log(`[outbox-unified] ${sessionId} - SQLite not ready, aborting`);
        return;
      }
      
      console.log(`[outbox-unified] ${sessionId} - Checking network connectivity...`);
      if (!await checkOnline()) {
        console.log(`[outbox-unified] ${sessionId} - Network offline, aborting`);
        return;
      }

      console.log(`[outbox-unified] ${sessionId} - Fetching outbox messages...`);
      const outboxMessages = await sqliteService.getOutboxMessages();

      if (outboxMessages.length === 0) {
        console.log(`[outbox-unified] ${sessionId} - No pending outbox messages to process`);
        return;
      }

      console.log(`[outbox-unified] ${sessionId} - Found ${outboxMessages.length} pending messages to send`);

      // Skip auth check and session check completely to avoid hangs
      // Let the server validate auth per request instead
      console.log(`[outbox-unified] ${sessionId} - Skipping auth pre-check to avoid hangs after device unlock`);
      console.log(`[outbox-unified] ${sessionId} - Server will validate auth per message`);

      const now = Date.now();
      for (let i = 0; i < outboxMessages.length; i++) {
        const outboxItem = outboxMessages[i];
        console.log(`[outbox-unified] ${sessionId} - Processing message ${i + 1}/${outboxMessages.length} (ID: ${outboxItem.id})`);
        try {
          const messageData = JSON.parse(outboxItem.content);

          // Respect next_retry_at; skip until it's due
          if (outboxItem.next_retry_at && outboxItem.next_retry_at > now) {
            console.log(`[outbox-unified] ${sessionId} - Skipping outbox ${outboxItem.id} until ${new Date(outboxItem.next_retry_at).toISOString()}`);
            continue;
          }

          console.log(`[outbox-unified] ${sessionId} - Sending message ${outboxItem.id} to Supabase...`);
          
          // Add timeout to the Supabase insert operation
          const insertPromise = supabase
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

          // Wrap with shorter timeout since session is now properly refreshed after device unlock
          const { data, error } = await Promise.race([
            insertPromise,
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Supabase insert timeout after 5s')), 5000)
            )
          ]) as { data: any; error: any };

          if (error) {
            console.error(`[outbox-unified] ${sessionId} - Error sending outbox message ${outboxItem.id}:`, error);
            // Detect auth-related errors and handle with fast refresh + quick retry
            const status = (error as any)?.status || (error as any)?.code;
            const message = String((error as any)?.message || '').toLowerCase();
            const isAuthError = status === 401 || status === 403 || message.includes('jwt') || message.includes('auth');

            console.log(`[outbox-unified] ${sessionId} - Error analysis for ${outboxItem.id}: status=${status}, isAuth=${isAuthError}`);

            if (isAuthError) {
              try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), FEATURES_PUSH.auth.refreshTimeoutMs);
                const refreshed = await Promise.race([
                  supabase.auth.refreshSession(),
                  new Promise<null>((resolve) => controller.signal.addEventListener('abort', () => resolve(null)))
                ]);
                clearTimeout(timeout);
                const ok = (refreshed as any)?.data?.session?.access_token;
                if (ok) {
                  // One immediate retry after refresh
                  const retryRes = await supabase
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
                  if (!(retryRes as any).error) {
                    // Treat as success path
                    const data = (retryRes as any).data;
                    console.log(`✅ Successfully sent outbox message ${outboxItem.id} after auth refresh`);
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
                    try { await sqliteService.deleteMessage(messageData.id); } catch {}
                    if (!data.is_ghost && data.users) {
                      await saveUserFromSupabase({ ...data.users, id: data.user_id, is_onboarded: 1 });
                    }
                    continue; // handled
                  }
                }
              } catch (_) {}
              // Quick retry soon for auth failures
              const attempt = (outboxItem.retry_count || 0) + 1;
              const nextRetry = Date.now() + Math.min(1500, FEATURES_PUSH.outbox.retryShortDelayMs);
              await sqliteService.updateOutboxRetry(outboxItem.id!, attempt, nextRetry);
              continue;
            }

            // Generic backoff for non-auth errors: min(2^n * 5s, 5m) + 0-1s
            const attempt = (outboxItem.retry_count || 0) + 1;
            const base = Math.min(Math.pow(2, attempt) * 5000, 5 * 60 * 1000);
            const jitter = Math.floor(Math.random() * 1000);
            const nextRetry = Date.now() + base + jitter;
            await sqliteService.updateOutboxRetry(
              outboxItem.id!,
              attempt,
              nextRetry
            );
            continue;
          }

          console.log(`[outbox-unified] ${sessionId} - Successfully sent outbox message ${outboxItem.id}`);
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
          console.error(`[outbox-unified] ${sessionId} - Error processing outbox message ${outboxItem.id}:`, error);
        }
      }

      console.log(`[outbox-unified] ${sessionId} - Finished processing all outbox messages`);
      
      // Reset watchdog timeout count on successful completion
      watchdogTimeoutCount = 0;
      console.log(`[outbox-unified] ${sessionId} - Reset watchdog timeout count after successful processing`);
      
      const state = get();
      if (state.activeGroup && outboxMessages.length > 0) {
        console.log(`[outbox-unified] ${sessionId} - Refreshing messages after processing...`);
        await get().fetchMessages(state.activeGroup.id);
        // If a thread is open, refresh its replies too
        if (state.activeThread?.id) {
          try {
            const replies = await get().fetchReplies(state.activeThread.id);
            _set({ threadReplies: replies });
          } catch (e) {
            console.error(`[outbox-unified] ${sessionId} - Error refreshing thread replies:`, e);
          }
        }
      }
    } catch (error) {
      console.error(`[outbox-unified] ${sessionId} - Fatal error during processing:`, error);
    } finally {
      // Clear watchdog
      if (processingWatchdog) {
        clearTimeout(processingWatchdog);
        processingWatchdog = null;
      }
      
      isProcessingOutbox = false;
      console.log(`[outbox-unified] ${sessionId} - Processing session completed`);
      
      // Handle pending reruns if any were queued during processing
      if (pendingRerunCount > 0) {
        const queuedRuns = pendingRerunCount;
        pendingRerunCount = 0; // Reset count atomically
        console.log(`[outbox-unified] ${sessionId} - Executing ${queuedRuns} queued rerun(s) immediately`);
        
        // Use immediate priority for queued reruns to prevent further delays
        triggerOutboxProcessing('pending-rerun', 'immediate');
      }
    }
  },

  startOutboxProcessor: () => {
    // Clear any existing interval and reset state for clean start
    if (outboxProcessorInterval) clearInterval(outboxProcessorInterval);
    resetOutboxProcessingState();
    
    // No more periodic processing - rely entirely on event-driven triggers
    // Set interval to null to indicate processor is "started" but event-driven only
    setOutboxProcessorInterval(null);
    
    // Initial trigger with immediate priority after reset
    triggerOutboxProcessing('processor-start', 'immediate');
  },

  stopOutboxProcessor: () => {
    if (outboxProcessorInterval) {
      clearInterval(outboxProcessorInterval);
      setOutboxProcessorInterval(null);
    }
    // Reset state when stopping processor to prevent stuck flags
    resetOutboxProcessingState();
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
