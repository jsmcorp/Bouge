import { supabasePipeline, SupabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { outboxProcessorInterval, setOutboxProcessorInterval } from './utils';


// ============================================================================
// UNIFIED OUTBOX PROCESSING TRIGGER SYSTEM
// ============================================================================

// Processing state
let isProcessingOutbox = false;
let pendingRerunCount = 0; // Count instead of boolean to handle multiple rapid triggers
let processingWatchdog: NodeJS.Timeout | null = null;
let triggerTimeout: NodeJS.Timeout | null = null;
let watchdogTimeoutCount = 0; // Track consecutive watchdog timeouts to prevent infinite loops
// Throttle empty outbox checks to avoid spinning when there's nothing to send
let lastEmptyOutboxAt = 0;

// Simple per-group refresh throttling (WhatsApp-style: avoid frequent back-to-back refresh)
const groupRefreshThrottleMs = 2000;
const lastGroupRefreshAt: Record<string, number> = {};

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
  
  // Clear any existing trigger timeout (coalesce; trailing-edge true)
  if (triggerTimeout) {
    console.log(`[outbox-unified] Coalescing trigger (debounced) from: ${context}`);
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
    created_at: SupabasePipeline.safeTimestamp(user.created_at)
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
      // Persist dedupe_key inside content to ensure realtime replacement later
      const contentPayload: any = {
        id: msg.id,
        content: msg.content,
        is_ghost: msg.is_ghost,
        message_type: msg.message_type,
        category: msg.category,
        parent_id: msg.parent_id,
        image_url: msg.image_url,
        // Optional dedupe_key for stable replacement; compute fallback on processing if absent
        dedupe_key: (msg as any).dedupe_key || undefined,
      };
      await sqliteService.addToOutbox({
        group_id: msg.group_id,
        user_id: msg.user_id,
        content: JSON.stringify(contentPayload),
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
    // Prevent overlapping outbox processing
    if (isProcessingOutbox) {
      pendingRerunCount++;
      console.log(`[outbox-unified] Processing already active, queued rerun #${pendingRerunCount}`);
      return;
    }
    
    isProcessingOutbox = true;
    const sessionId = `outbox-${Date.now()}`;
    console.log(`[outbox-unified] Starting processing session ${sessionId}`);
    
    try {
      // Set watchdog to prevent permanent blocking
      processingWatchdog = setTimeout(() => {
        watchdogTimeoutCount++;
        console.warn(`⚠️ [outbox-unified] Watchdog timeout after 15s - session ${sessionId} - timeout count: ${watchdogTimeoutCount}`);
        
        if (watchdogTimeoutCount >= 5) {
          console.warn(`⚠️ [outbox-unified] Too many consecutive timeouts (${watchdogTimeoutCount}), stopping auto-recovery`);
          resetOutboxProcessingState();
          return;
        }
        
        resetOutboxProcessingState();
      }, 15000);

      // Check prerequisites
      if (!await checkSqliteReady()) {
        console.log(`[outbox-unified] ${sessionId} - SQLite not ready, aborting`);
        return;
      }

      // Short-circuit if we've very recently checked and found no work
      if (Date.now() - lastEmptyOutboxAt < 1000) {
        console.log(`[outbox-unified] ${sessionId} - Skipping (recent empty outbox)`);
        return;
      }

      if (!await checkOnline()) {
        console.log(`[outbox-unified] ${sessionId} - Network offline, aborting`);
        return;
      }

      // Preflight: avoid invoking pipeline when outbox is empty
      try {
        const pending = await sqliteService.getOutboxMessages();
        if (!pending || pending.length === 0) {
          lastEmptyOutboxAt = Date.now();
          console.log(`[outbox-unified] ${sessionId} - No outbox messages to process (preflight)`);
          return;
        }
      } catch (e) {
        console.warn(`[outbox-unified] ${sessionId} - Preflight outbox check failed (continuing):`, e);
      }

      // Use pipeline to process outbox (handles all retry logic, auth, timeouts)
      await supabasePipeline.processOutbox();
      const stats = supabasePipeline.getLastOutboxStats();

      // Reset watchdog timeout count on successful completion
      watchdogTimeoutCount = 0;
      console.log(`[outbox-unified] ${sessionId} - Pipeline processing completed successfully`, stats);

      // Refresh only if any messages were delivered, with per-group throttle
      const state = get();
      const groupsToRefresh = new Set<string>(stats?.groupsWithSent || []);
      if (groupsToRefresh.size > 0) {
        for (const groupId of groupsToRefresh) {
          const lastAt = lastGroupRefreshAt[groupId] || 0;
          const now = Date.now();
          if (now - lastAt >= groupRefreshThrottleMs) {
            lastGroupRefreshAt[groupId] = now;
            try {
              console.log(`[outbox-unified] ${sessionId} - Refreshing messages for group ${groupId} (sent=${stats?.sent})`);
              // Prefer delta sync for active chat if we have a recent cursor
              const currentState = get();
              if (currentState.activeGroup?.id === groupId && Array.isArray(currentState.messages) && currentState.messages.length > 0 && typeof currentState.deltaSyncSince === 'function') {
                const lastMessage = currentState.messages[currentState.messages.length - 1];
                const sinceIso = lastMessage?.created_at;
                if (sinceIso) {
                  await currentState.deltaSyncSince(groupId, sinceIso);
                } else {
                  await get().fetchMessages(groupId);
                }
              } else {
                await get().fetchMessages(groupId);
              }
            } catch (e) {
              console.error(`[outbox-unified] ${sessionId} - Error refreshing group ${groupId}:`, e);
            }
          } else {
            console.log(`[outbox-unified] ${sessionId} - Skipping refresh for group ${groupId} (throttled)`);
          }
        }
        // Refresh thread replies if thread is open and belongs to a refreshed group
        if (state.activeThread?.id && state.activeGroup?.id && groupsToRefresh.has(state.activeGroup.id)) {
          try {
            const replies = await get().fetchReplies(state.activeThread.id);
            _set({ threadReplies: replies });
          } catch (e) {
            console.error(`[outbox-unified] ${sessionId} - Error refreshing thread replies:`, e);
          }
        }
      } else {
        console.log(`[outbox-unified] ${sessionId} - No deliveries; skipping refresh`);
      }
      
    } catch (error) {
      console.error(`[outbox-unified] ${sessionId} - Pipeline processing failed:`, error);
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

      const client = await supabasePipeline.getDirectClient();
      const { data: groupData } = await client
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

      const { data: members } = await client
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
        const { data: reactions } = await client
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
        const { data: polls } = await client
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

      const client = await supabasePipeline.getDirectClient();
      const { data, error } = await client
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
