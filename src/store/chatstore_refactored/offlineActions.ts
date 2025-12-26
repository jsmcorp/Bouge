import { supabasePipeline, SupabasePipeline } from '@/lib/supabasePipeline';
import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { outboxProcessorInterval, setOutboxProcessorInterval } from './utils';


// ============================================================================
// UNIFIED OUTBOX PROCESSING TRIGGER SYSTEM
// ============================================================================

// Processing state (managed in pipeline now)
let triggerTimeout: NodeJS.Timeout | null = null;
let lastTriggerContext: string | null = null;
let lastTriggerTime = 0;

// Simple per-group refresh throttling (WhatsApp-style: avoid frequent back-to-back refresh)
const groupRefreshThrottleMs = 2000;
const lastGroupRefreshAt: Record<string, number> = {};

// Reset processing state (called from realtime cleanup/reconnect)
export const resetOutboxProcessingState = () => {
  console.log('[outbox-unified] Resetting outbox processing state');
  if (triggerTimeout) {
    clearTimeout(triggerTimeout);
    triggerTimeout = null;
  }
  lastTriggerContext = null;
  lastTriggerTime = 0;
  // Processing lock lives in pipeline now; nothing else to reset here
};

// Unified trigger system - thin wrapper that delegates to pipeline (single-flight inside pipeline)
export const triggerOutboxProcessing = (context: string, priority: 'immediate' | 'high' | 'normal' | 'low' = 'normal') => {
  const now = Date.now();
  
  // OPTIMIZATION: Debounce rapid triggers within 100ms window
  if (lastTriggerContext && now - lastTriggerTime < 100) {
    console.log(`[outbox-unified] Debouncing trigger from: ${context} (last: ${lastTriggerContext}, ${now - lastTriggerTime}ms ago)`);
    return;
  }

  console.log(`[outbox-unified] Trigger requested from: ${context} (priority: ${priority})`);
  lastTriggerContext = context;
  lastTriggerTime = now;

  // Clear any existing trigger timeout (coalesce; trailing-edge true)
  if (triggerTimeout) {
    console.log(`[outbox-unified] Coalescing trigger (debounced) from: ${context}`);
    clearTimeout(triggerTimeout);
    triggerTimeout = null;
  }

  const delays = { immediate: 0, high: 50, normal: 75, low: 100 } as const;
  const delay = delays[priority];
  console.log(`[outbox-unified] Scheduling processing in ${delay}ms for: ${context}`);

  triggerTimeout = setTimeout(async () => {
    triggerTimeout = null;
    try {
      await supabasePipeline.processOutbox();
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
  // WHATSAPP-STYLE: Instant UI refresh from SQLite
  refreshUIFromSQLite: (groupId: string) => Promise<void>;
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

  // WHATSAPP-STYLE: Instant UI refresh from SQLite (no network delay)
  // Loads messages from local SQLite and updates UI immediately
  refreshUIFromSQLite: async (groupId: string) => {
    console.log(`[refreshUIFromSQLite] 🔄 Loading messages from SQLite for group ${groupId}`);
    
    try {
      const isNative = Capacitor.isNativePlatform();
      if (!isNative) {
        console.log('[refreshUIFromSQLite] Not on native platform, skipping');
        return;
      }

      const ready = await sqliteService.isReady();
      if (!ready) {
        console.log('[refreshUIFromSQLite] SQLite not ready, skipping');
        return;
      }

      // Load messages from SQLite (up to 50 most recent)
      const localMessages = await sqliteService.getRecentMessages(groupId, 50);
      
      if (!localMessages || localMessages.length === 0) {
        console.log('[refreshUIFromSQLite] No local messages found');
        return;
      }

      console.log(`[refreshUIFromSQLite] 📦 Loaded ${localMessages.length} messages from SQLite`);

      // Get user info for non-ghost messages
      const userIds = [...new Set(localMessages.filter(msg => !msg.is_ghost).map(msg => msg.user_id))];
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
          console.error(`[refreshUIFromSQLite] Error loading user ${userId}:`, error);
        }
      }
      
      // Convert to Message format
      const messages = localMessages.map((msg: any) => ({
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
        author: msg.is_ghost ? undefined : (userCache.get(msg.user_id) || { display_name: 'Unknown User', avatar_url: null }),
        reply_count: 0,
        replies: [],
        delivery_status: 'delivered' as const,
        reactions: [],
      }));
      
      // Sort messages by created_at ascending (oldest first)
      messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      // CRITICAL FIX: Force React re-render by creating new array reference
      // This ensures React detects the change and updates the UI
      const currentState = get();
      const currentMessages = currentState.messages || [];
      
      // Only update if messages actually changed
      const hasNewMessages = messages.length !== currentMessages.length || 
        messages.some((msg, idx) => msg.id !== currentMessages[idx]?.id);
      
      if (hasNewMessages) {
        // Create completely new array to force React re-render
        _set({ messages: [...messages], fetchToken: Date.now().toString() });
        console.log(`[refreshUIFromSQLite] ✅ UI updated with ${messages.length} messages from SQLite (forced re-render)`);
        
        // Force scroll to bottom to show new message
        setTimeout(() => {
          const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
            console.log(`[refreshUIFromSQLite] 📍 Auto-scrolled to bottom`);
          }
        }, 100); // Increased delay to ensure React has rendered
      } else {
        console.log(`[refreshUIFromSQLite] ℹ️ No new messages, skipping update`);
      }

    } catch (error) {
      console.error('[refreshUIFromSQLite] ❌ Error refreshing UI from SQLite:', error);
    }
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
        created_at: msg.created_at,
        topic_id: (msg as any).topic_id || null
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
        // Optional pseudonym compound step for ghost messages
        requires_pseudonym: (msg as any).requires_pseudonym || (msg as any).pseudonym_task || undefined,
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

      console.log(`[outbox-enqueue] Successfully enqueued message ${msg.id}, dedupe_key=${(msg as any).dedupe_key || 'n/a'}, requires_pseudonym=${(msg as any).requires_pseudonym ? 'true' : 'false'}; triggering processing...`);
      // Trigger processing immediately after enqueueing
      triggerOutboxProcessing('enqueue-outbox', 'high');
    } catch (e) {
      console.error(`[outbox-enqueue] Failed to enqueue message ${msg.id}:`, e);
    }
  },
  processOutbox: async () => {
    const sessionId = `outbox-${Date.now()}`;
    console.log(`[outbox-unified] Starting processing session ${sessionId} (delegated to pipeline)`);

    try {
      await supabasePipeline.processOutbox();
      const stats = supabasePipeline.getLastOutboxStats();

      console.log(`[outbox-unified] ${sessionId} - drained. stats=`, stats);

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
      console.log(`[outbox-unified] ${sessionId} - Processing session completed`);
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
            role: 'participant', // Default role for local storage (Supabase doesn't have role column)
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