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
   * CRITICAL: This function has a 8-second timeout to prevent hanging.
   * If it fails or times out, the caller should trigger fallback sync.
   *
   * @returns true if message was successfully fetched and stored, false otherwise
   */
  public async fetchAndStoreMessage(messageId: string, groupId: string): Promise<boolean> {
    // Prevent duplicate fetches
    const key = `${groupId}:${messageId}`;
    if (this.syncInProgress.has(key)) {
      console.log(`[bg-sync] Already fetching message ${messageId}, skipping duplicate`);
      return false;
    }

    this.syncInProgress.add(key);

    try {
      console.log(`[bg-sync] 🚀 Starting fetch for message ${messageId} in group ${groupId}`);
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

      // Fetch message from Supabase with timeout
      // CRITICAL FIX: Use getDirectClient() for FCM-triggered fetches
      // FCM receipt already implies authenticated user context - no need to validate/refresh token
      // This avoids unnecessary auth checks, token refreshes, and outbox triggers
      const client = await supabasePipeline.getDirectClient();

      // Create timeout promise (8 seconds)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Fetch timeout after 8s')), 8000)
      );

      // Create fetch promise
      const fetchPromise = client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('id', messageId)
        .single();

      // Race between fetch and timeout
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as any;

      if (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[bg-sync] ❌ Error fetching message ${messageId} after ${elapsed}ms:`, {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });

        // If message doesn't exist yet (timing issue), retry after delay
        if (error.code === 'PGRST116' || error.message?.includes('no rows')) {
          console.log(`[bg-sync] ⏳ Message ${messageId} not found, retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Retry once with timeout
          const retryTimeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Retry timeout after 5s')), 5000)
          );

          const retryFetchPromise = client
            .from('messages')
            .select(`
              *,
              reactions(*),
              users!messages_user_id_fkey(display_name, avatar_url, created_at)
            `)
            .eq('id', messageId)
            .single();

          const { data: retryData, error: retryError } = await Promise.race([
            retryFetchPromise,
            retryTimeoutPromise
          ]) as any;

          if (retryError) {
            const totalElapsed = Date.now() - startTime;
            console.error(`[bg-sync] ❌ Retry failed after ${totalElapsed}ms:`, {
              message: retryError.message,
              code: retryError.code
            });
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

          // Trigger unread tracker callbacks
          try {
            const { unreadTracker } = await import('./unreadTracker');
            await unreadTracker.triggerCallbacks(groupId);
            console.log(`[bg-sync] 📊 Unread count updated for group ${groupId}`);
          } catch (error) {
            console.warn('[bg-sync] ⚠️ Failed to trigger unread tracker callbacks:', error);
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

      // Trigger unread tracker callbacks to update dashboard badges
      try {
        const { unreadTracker } = await import('./unreadTracker');
        await unreadTracker.triggerCallbacks(groupId);
        console.log(`[bg-sync] 📊 Unread count updated for group ${groupId}`);
      } catch (error) {
        console.warn('[bg-sync] ⚠️ Failed to trigger unread tracker callbacks:', error);
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

      // Fetch messages from Supabase
      const client = await supabasePipeline.getDirectClient();
      const query = client
        .from('messages')
        .select(`
          *,
          reactions(*),
          users!messages_user_id_fkey(display_name, avatar_url, created_at)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: true })
        .limit(100); // Fetch up to 100 missed messages

      const { data, error } = since 
        ? await query.gt('created_at', since)
        : await query;

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

