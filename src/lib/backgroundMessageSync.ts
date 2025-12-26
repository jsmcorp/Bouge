import { supabasePipeline } from './supabasePipeline';
import { sqliteService } from './sqliteService';
import { Capacitor } from '@capacitor/core';

/**
 * Background Message Sync Service
 * 
 * Handles fetching and storing messages when FCM notifications arrive,
 * even when the app is closed or in background. This ensures messages
 * are already in SQLite when the user opens the app - WhatsApp-style.
 */
class BackgroundMessageSyncService {
  private syncInProgress = new Set<string>();
  private fetchQueue: Array<{ messageId: string; groupId: string; timestamp: number }> = [];
  private isProcessingQueue = false;

  /**
   * Fetch a single message by ID and store it in SQLite
   * Called when FCM notification arrives with message_id
   *
   * CRITICAL FIX: Increased timeout to 15s and added retry mechanism
   * If it fails or times out, the caller should trigger fallback sync.
   *
   * @returns true if message was successfully fetched and stored, false otherwise
   */
  public async fetchAndStoreMessage(messageId: string, groupId: string, retryCount: number = 0): Promise<boolean> {
    // Prevent duplicate fetches
    const key = `${groupId}:${messageId}`;
    if (this.syncInProgress.has(key)) {
      console.log(`[bg-sync] Already fetching message ${messageId}, skipping duplicate`);
      return false;
    }

    this.syncInProgress.add(key);

    try {
      console.log(`[bg-sync] 🚀 Starting fetch for message ${messageId} in group ${groupId} (attempt ${retryCount + 1}/3)`);
      const startTime = Date.now();

      // Check if we're on native platform and SQLite is ready
      const isNative = Capacitor.isNativePlatform();
      if (!isNative) {
        console.log('[bg-sync] Not on native platform, skipping SQLite storage');
        return false;
      }

      const isSqliteReady = await sqliteService.isReady();
      if (!isSqliteReady) {
        console.warn('[bg-sync] SQLite not ready, queueing message for later');
        this.queueMessage(messageId, groupId);
        return false;
      }

      // CRITICAL FIX: Skip existence check for cross-group messages to avoid SQLite hang
      // Root cause: SQLite query "SELECT 1 FROM messages WHERE id = ?" hangs for 10+ seconds
      // when checking for messages in non-active groups (database lock/contention issue)
      //
      // For active group: Check existence (realtime might have delivered it)
      // For other groups: Skip check (realtime doesn't deliver cross-group messages yet)
      //
      // This is safe because:
      // 1. Multi-group realtime subscription (LOG45) will deliver messages for all groups
      // 2. If realtime delivered it, INSERT OR REPLACE will be a no-op
      // 3. Better to fetch duplicate than miss message due to 10s hang

      // Get active group from chat store to determine if this is a cross-group message
      // Note: We can't import chatStore here (circular dependency), so we check via a heuristic:
      // If the message was delivered via realtime, it would already be in SQLite
      // If it's not in SQLite after 100ms, it's likely a cross-group message

      // Add 2-second timeout to SQLite existence check to prevent hang
      const existsTimeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('SQLite existence check timeout')), 2000)
      );

      const existsPromise = sqliteService.messageExists(messageId);

      try {
        const exists = await Promise.race([existsPromise, existsTimeoutPromise]);
        if (exists) {
          const elapsed = Date.now() - startTime;
          console.log(`[bg-sync] ✅ Message ${messageId} already exists (delivered via realtime), skipping fetch (${elapsed}ms)`);
          return true; // Return true since message is already available
        }
      } catch (error: any) {
        if (error?.message === 'SQLite existence check timeout') {
          const elapsed = Date.now() - startTime;
          console.warn(`[bg-sync] ⚠️ SQLite existence check timed out after 2s (${elapsed}ms), proceeding with fetch`);
          console.warn(`[bg-sync] ⚠️ This indicates database lock/contention - likely cross-group message`);
          // Continue with fetch - better to fetch duplicate than miss message
        } else {
          throw error;
        }
      }

      // CRITICAL FIX (LOG50): Use cached token directly for REST API call
      // FCM receipt already implies authenticated user context - no need to validate/refresh token
      // getDirectClient() can hang on in-flight session requests during session recovery
      // Using cached token bypasses all session management complexity
      console.log('[bg-sync] 🔄 Getting cached token for direct REST call...');
      const cachedToken = supabasePipeline.getCachedAccessToken();

      if (!cachedToken) {
        console.error('[bg-sync] ❌ No cached token available, aborting FCM fetch');
        return false;
      }

      console.log('[bg-sync] ✅ Cached token found, making direct REST API call...');

      // CRITICAL FIX (LOG50): Make direct REST API call with cached token
      // This bypasses getDirectClient() which can hang on in-flight session requests
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const url = `${supabaseUrl}/rest/v1/messages?select=*,reactions(*),users!messages_user_id_fkey(display_name,avatar_url,created_at)&id=eq.${messageId}`;

      console.log(`[bg-sync] 🔄 Fetching from: ${url.substring(0, 100)}...`);

      // CRITICAL FIX: 10-second timeout for Supabase fetch
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Fetch timeout after 10s')), 10000)
      );

      // Create fetch promise with direct REST API call
      const fetchPromise = (async () => {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${cachedToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`[bg-sync] ✅ Query completed, got ${data?.length || 0} messages`);

        // Supabase returns array for .eq() queries, extract single item
        if (Array.isArray(data) && data.length > 0) {
          return { data: data[0], error: null };
        } else if (Array.isArray(data) && data.length === 0) {
          return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        } else {
          return { data, error: null };
        }
      })();

      // Race between fetch and timeout
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as any;

      if (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[bg-sync] ❌ Error fetching message ${messageId} after ${elapsed}ms:`,
          JSON.stringify({
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            status: error.status,
            statusText: error.statusText,
            name: error.name
          }, null, 2)
        );

        // If message doesn't exist yet (timing issue), retry after delay
        if (error.code === 'PGRST116' || error.message?.includes('no rows')) {
          console.log(`[bg-sync] ⏳ Message ${messageId} not found, retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Retry once with timeout using cached token
          const retryTimeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Retry timeout after 5s')), 5000)
          );

          const retryFetchPromise = (async () => {
            const response = await fetch(url, {
              method: 'GET',
              headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${cachedToken}`,
                'Content-Type': 'application/json',
              },
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Supabase returns array for .eq() queries, extract single item
            if (Array.isArray(data) && data.length > 0) {
              return { data: data[0], error: null };
            } else if (Array.isArray(data) && data.length === 0) {
              return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
            } else {
              return { data, error: null };
            }
          })();

          const { data: retryData, error: retryError } = await Promise.race([
            retryFetchPromise,
            retryTimeoutPromise
          ]) as any;

          if (retryError) {
            const totalElapsed = Date.now() - startTime;
            console.error(`[bg-sync] ❌ Retry failed after ${totalElapsed}ms:`,
              JSON.stringify({
                message: retryError.message,
                code: retryError.code,
                status: retryError.status,
                statusText: retryError.statusText
              }, null, 2)
            );
            return false;
          }

          if (!retryData) {
            console.warn(`[bg-sync] ⚠️ Message ${messageId} still not found after retry`);
            return false;
          }

          // Use retry data
          console.log(`[bg-sync] ✅ Message ${messageId} found on retry`);

          // Store message in SQLite
          await this.storeMessageInSQLite(retryData);

          // Store reactions if any
          if (retryData.reactions && Array.isArray(retryData.reactions)) {
            await this.storeReactions(retryData.reactions);
          }

          const totalElapsed = Date.now() - startTime;
          console.log(`[bg-sync] ✅ Message ${messageId} stored successfully after ${totalElapsed}ms (with retry)`);

          // CRITICAL FIX: Directly load from SQLite and update UI without creating new fetchToken
          // This prevents the "Skipping stale set" issue where fetchMessages() creates a new token
          try {
            const { useChatStore } = await import('@/store/chatStore');
            const isActiveGroup = useChatStore.getState().activeGroup?.id === groupId;
            
            if (isActiveGroup) {
              console.log(`[bg-sync] 🔄 Loading new message from SQLite to update UI (retry path)`);
              
              // Load the newly stored message from SQLite
              const localMessages = await sqliteService.getRecentMessages(groupId, 50);
              
              if (localMessages && localMessages.length > 0) {
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
                    console.error(`Error loading user ${userId}:`, error);
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
                
                // Sort messages by created_at ascending (oldest first) to match normal fetch behavior
                messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                
                // Directly update state without fetchToken check using Zustand's setState
                useChatStore.setState({ messages });
                console.log(`[bg-sync] ✅ UI updated with ${messages.length} messages from SQLite (retry path)`);
                
                // Force scroll to bottom after refresh to show new message
                setTimeout(() => {
                  const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
                  if (viewport) {
                    viewport.scrollTop = viewport.scrollHeight;
                    console.log(`[bg-sync] 📍 Auto-scrolled to bottom to show new message`);
                  }
                }, 50);
              }
            } else {
              console.log(`[bg-sync] 📨 Message for non-active group ${groupId}, dispatching background event`);
              // Dispatch event for dashboard to show badge
              window.dispatchEvent(new CustomEvent('message:background', {
                detail: { groupId, messageId }
              }));
            }
          } catch (error) {
            console.warn('[bg-sync] ⚠️ Failed to refresh chat store:', error);
          }

          // Increment unread count for background group
          try {
            if (typeof (window as any).__incrementUnreadCount === 'function') {
              (window as any).__incrementUnreadCount(groupId);
              console.log(`[bg-sync] 📊 Unread count incremented for group ${groupId}`);
            }
          } catch (error) {
            console.warn('[bg-sync] ⚠️ Failed to increment unread count:', error);
          }

          return true;
        }

        return false;
      }

      if (!data) {
        console.warn(`[bg-sync] ⚠️ Message ${messageId} not found (no data returned)`);
        return false;
      }

      // Store message in SQLite
      await this.storeMessageInSQLite(data);

      // Store reactions if any
      if (data.reactions && Array.isArray(data.reactions)) {
        await this.storeReactions(data.reactions);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[bg-sync] ✅ Message ${messageId} stored successfully in ${elapsed}ms`);

      // CRITICAL FIX: Directly load from SQLite and update UI without creating new fetchToken
      // This prevents the "Skipping stale set" issue where fetchMessages() creates a new token
      try {
        const { useChatStore } = await import('@/store/chatStore');
        const isActiveGroup = useChatStore.getState().activeGroup?.id === groupId;
        
        if (isActiveGroup) {
          console.log(`[bg-sync] 🔄 Loading new message from SQLite to update UI`);
          
          // Load the newly stored message from SQLite
          const localMessages = await sqliteService.getRecentMessages(groupId, 50);
          
          if (localMessages && localMessages.length > 0) {
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
                console.error(`Error loading user ${userId}:`, error);
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
            
            // Sort messages by created_at ascending (oldest first) to match normal fetch behavior
            messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            
            // Directly update state without fetchToken check using Zustand's setState
            useChatStore.setState({ messages });
            console.log(`[bg-sync] ✅ UI updated with ${messages.length} messages from SQLite`);
            
            // Force scroll to bottom after refresh to show new message
            setTimeout(() => {
              const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
              if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
                console.log(`[bg-sync] 📍 Auto-scrolled to bottom to show new message`);
              }
            }, 50);
          }
        } else {
          console.log(`[bg-sync] 📨 Message for non-active group ${groupId}, dispatching background event`);
          // Dispatch event for dashboard to show badge
          window.dispatchEvent(new CustomEvent('message:background', {
            detail: { groupId, messageId }
          }));
        }
      } catch (error) {
        console.warn('[bg-sync] ⚠️ Failed to refresh chat store:', error);
      }

      // Increment unread count for background group
      try {
        if (typeof (window as any).__incrementUnreadCount === 'function') {
          (window as any).__incrementUnreadCount(groupId);
          console.log(`[bg-sync] 📊 Unread count incremented for group ${groupId}`);
        }
      } catch (error) {
        console.warn('[bg-sync] ⚠️ Failed to increment unread count:', error);
      }

      return true;
    } catch (error: any) {
      console.error(`[bg-sync] ❌ Exception in fetchAndStoreMessage for ${messageId}:`, error?.message || error);
      return false;
    } finally {
      this.syncInProgress.delete(key);
    }
  }

  /**
   * Fetch all missed messages for a group since a given timestamp
   * Called on app resume to catch up on messages sent while app was closed
   */
  public async fetchMissedMessages(groupId: string, sinceIso?: string): Promise<number> {
    try {
      console.log(`[bg-sync] Fetching missed messages for group ${groupId} since ${sinceIso || 'beginning'}`);
      
      const isNative = Capacitor.isNativePlatform();
      if (!isNative) {
        return 0;
      }

      const isSqliteReady = await sqliteService.isReady();
      if (!isSqliteReady) {
        console.warn('[bg-sync] SQLite not ready for missed messages fetch');
        return 0;
      }

      // Determine since timestamp
      let since = sinceIso;
      if (!since) {
        // Get last sync timestamp from SQLite
        const lastSync = await sqliteService.getLastSyncTimestamp(groupId);
        if (lastSync > 0) {
          since = new Date(lastSync).toISOString();
        }
      }

      // CRITICAL FIX (LOG50): Use cached token directly for REST API call
      // This is called during fallback sync when session may be broken
      console.log('[bg-sync] 🔄 Getting cached token for missed messages fetch...');
      const cachedToken = supabasePipeline.getCachedAccessToken();

      if (!cachedToken) {
        console.error('[bg-sync] ❌ No cached token available, aborting missed messages fetch');
        return 0;
      }

      console.log('[bg-sync] ✅ Cached token found, making direct REST API call...');

      // Build query URL
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      let url = `${supabaseUrl}/rest/v1/messages?select=*,reactions(*),users!messages_user_id_fkey(display_name,avatar_url,created_at)&group_id=eq.${groupId}&order=created_at.asc&limit=100`;

      if (since) {
        url += `&created_at=gt.${since}`;
      }

      console.log(`[bg-sync] 🔄 Fetching from: ${url.substring(0, 100)}...`);

      // Make direct REST API call
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${cachedToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`[bg-sync] HTTP ${response.status}: ${response.statusText}`);
        return 0;
      }

      const data = await response.json();
      const error = null;

      if (error) {
        console.error(`[bg-sync] Error fetching missed messages:`, error);
        return 0;
      }

      if (!data || data.length === 0) {
        console.log(`[bg-sync] No missed messages for group ${groupId}`);
        return 0;
      }

      // Store all messages in SQLite
      let storedCount = 0;
      for (const message of data) {
        try {
          await this.storeMessageInSQLite(message);
          
          // Store reactions if any
          if (message.reactions && Array.isArray(message.reactions)) {
            await this.storeReactions(message.reactions);
          }
          
          storedCount++;
        } catch (error) {
          console.error(`[bg-sync] Error storing message ${message.id}:`, error);
        }
      }

      // Update last sync timestamp
      await sqliteService.updateLastSyncTimestamp(groupId, Date.now());

      console.log(`[bg-sync] ✅ Stored ${storedCount} missed messages for group ${groupId}`);

      // CRITICAL FIX: Directly load from SQLite and update UI without creating new fetchToken
      if (storedCount > 0) {
        try {
          const { useChatStore } = await import('@/store/chatStore');
          const isActiveGroup = useChatStore.getState().activeGroup?.id === groupId;
          
          if (isActiveGroup) {
            console.log(`[bg-sync] 🔄 Loading ${storedCount} missed messages from SQLite to update UI`);
            
            // Load the newly stored messages from SQLite
            const localMessages = await sqliteService.getRecentMessages(groupId, 50);
            
            if (localMessages && localMessages.length > 0) {
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
                  console.error(`Error loading user ${userId}:`, error);
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
              
              // Sort messages by created_at ascending (oldest first) to match normal fetch behavior
              messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
              
              // Directly update state without fetchToken check using Zustand's setState
              useChatStore.setState({ messages });
              console.log(`[bg-sync] ✅ UI updated with ${messages.length} messages from SQLite`);
              
              // Force scroll to bottom after refresh to show new messages
              setTimeout(() => {
                const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
                if (viewport) {
                  viewport.scrollTop = viewport.scrollHeight;
                  console.log(`[bg-sync] 📍 Auto-scrolled to bottom to show ${storedCount} missed messages`);
                }
              }, 50);
            }
          } else {
            console.log(`[bg-sync] 📨 ${storedCount} missed messages for non-active group ${groupId}`);
          }
        } catch (error) {
          console.warn('[bg-sync] ⚠️ Failed to refresh chat store:', error);
        }

        // Increment unread count for background group
        try {
          if (typeof (window as any).__incrementUnreadCount === 'function') {
            (window as any).__incrementUnreadCount(groupId);
          }
        } catch (error) {
          console.warn('[bg-sync] ⚠️ Failed to increment unread count:', error);
        }
      }

      return storedCount;
    } catch (error) {
      console.error(`[bg-sync] Failed to fetch missed messages for group ${groupId}:`, error);
      return 0;
    }
  }

  /**
   * Fetch missed messages for all groups
   * Called on app resume to sync all groups at once
   */
  public async fetchMissedMessagesForAllGroups(): Promise<{ [groupId: string]: number }> {
    try {
      console.log('[bg-sync] Fetching missed messages for all groups');
      
      const isNative = Capacitor.isNativePlatform();
      if (!isNative) {
        return {};
      }

      const isSqliteReady = await sqliteService.isReady();
      if (!isSqliteReady) {
        console.warn('[bg-sync] SQLite not ready for all groups sync');
        return {};
      }

      // Get all groups from SQLite
      const groups = await sqliteService.getGroups();
      const results: { [groupId: string]: number } = {};

      // Fetch missed messages for each group
      for (const group of groups) {
        const count = await this.fetchMissedMessages(group.id);
        results[group.id] = count;
      }

      const totalCount = Object.values(results).reduce((sum, count) => sum + count, 0);
      console.log(`[bg-sync] ✅ Fetched ${totalCount} total missed messages across ${groups.length} groups`);
      
      return results;
    } catch (error) {
      console.error('[bg-sync] Failed to fetch missed messages for all groups:', error);
      return {};
    }
  }

  /**
   * Store a message in SQLite
   */
  private async storeMessageInSQLite(message: any): Promise<void> {
    await sqliteService.saveMessage({
      id: message.id,
      group_id: message.group_id,
      user_id: message.user_id,
      content: message.content,
      is_ghost: message.is_ghost ? 1 : 0,
      message_type: message.message_type || 'text',
      category: message.category || null,
      parent_id: message.parent_id || null,
      image_url: message.image_url || null,
      created_at: new Date(message.created_at).getTime(),
      topic_id: message.topic_id || null,
    });
  }

  /**
   * Store reactions in SQLite
   */
  private async storeReactions(reactions: any[]): Promise<void> {
    for (const reaction of reactions) {
      try {
        await sqliteService.saveReaction({
          id: reaction.id,
          message_id: reaction.message_id,
          user_id: reaction.user_id,
          emoji: reaction.emoji,
          created_at: new Date(reaction.created_at).getTime(),
        });
      } catch (error) {
        console.error(`[bg-sync] Error storing reaction ${reaction.id}:`, error);
      }
    }
  }

  /**
   * Queue a message for later processing if SQLite is not ready
   */
  private queueMessage(messageId: string, groupId: string): void {
    this.fetchQueue.push({
      messageId,
      groupId,
      timestamp: Date.now(),
    });

    // Start processing queue if not already running
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  /**
   * Process queued messages
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.fetchQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.fetchQueue.length > 0) {
      const item = this.fetchQueue.shift();
      if (!item) break;

      // Skip messages older than 5 minutes
      if (Date.now() - item.timestamp > 5 * 60 * 1000) {
        console.log(`[bg-sync] Skipping stale queued message ${item.messageId}`);
        continue;
      }

      await this.fetchAndStoreMessage(item.messageId, item.groupId);
      
      // Small delay between processing
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessingQueue = false;
  }
}

// Export singleton instance
export const backgroundMessageSync = new BackgroundMessageSyncService();

