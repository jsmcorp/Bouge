import { supabasePipeline } from './supabasePipeline';

/**
 * Simple Unread Tracker - Clean Implementation
 * 
 * Just wraps Supabase RPC calls, no caching, no timers, no complexity
 */
class UnreadTrackerService {
  /**
   * Get unread counts for all groups from Supabase (fast version using cached session)
   * This bypasses auth.getUser() and session refresh by using cached token directly
   */
  public async getAllUnreadCountsFast(): Promise<Map<string, number>> {
    try {
      console.log('[unread] 🚀 Fast fetch: Getting cached session and token...');
      const session = await supabasePipeline.getCachedSession();
      const token = supabasePipeline.getCachedAccessToken();
      
      if (!session?.user || !token) {
        console.log('[unread] ⚠️ No cached session or token, returning empty counts');
        return new Map();
      }

      console.log('[unread] ✅ Got cached user:', session.user.id);
      console.log('[unread] ✅ Got cached token:', token.substring(0, 20) + '...');
      console.log('[unread] 🔄 Making direct RPC call with cached token (bypasses session refresh)...');

      // Make direct fetch call with cached token - bypasses Supabase client auth
      // Note: get_all_unread_counts now uses auth.uid() internally, no params needed
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_all_unread_counts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        console.error('[unread] ❌ RPC HTTP error:', response.status, response.statusText);
        return new Map();
      }

      const data = await response.json();

      const counts = new Map<string, number>();
      if (data && Array.isArray(data)) {
        for (const row of data) {
          counts.set(row.group_id, row.unread_count || 0);
        }
      }

      console.log('[unread] ✅ Fetched counts:', Array.from(counts.entries()));
      return counts;
    } catch (error: any) {
      console.error('[unread] ❌ Failed to get counts:', error);
      return new Map();
    }
  }

  /**
   * Get unread counts for all groups from Supabase
   */
  public async getAllUnreadCounts(): Promise<Map<string, number>> {
    try {
      // Get current user from cached session (no auth calls that can hang)
      const session = await supabasePipeline.getCachedSession();
      
      if (!session?.user) {
        console.log('[unread] No user, returning empty counts');
        return new Map();
      }
      const userId = session.user.id;

      console.log('[unread] Fetching counts from Supabase for user:', userId);
      
      // Get client for queries
      const client = await supabasePipeline.getDirectClient();

      // Note: get_all_unread_counts now uses auth.uid() internally, no params needed
      const { data, error } = await client.rpc('get_all_unread_counts');

      if (error) {
        console.error('[unread] RPC error:', error);
        return new Map();
      }

      const counts = new Map<string, number>();
      if (data && Array.isArray(data)) {
        for (const row of data) {
          counts.set(row.group_id, row.unread_count || 0);
        }
      }

      console.log('[unread] Fetched counts:', Array.from(counts.entries()));
      return counts;
    } catch (error) {
      console.error('[unread] Failed to get counts:', error);
      return new Map();
    }
  }

  /**
   * Sync local read status to Supabase
   * Call this on app start or network reconnect to sync any pending changes
   */
  public async syncLocalToSupabase(): Promise<void> {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) {
        return; // Only for native
      }

      const { sqliteService } = await import('./sqliteService');
      const isReady = await sqliteService.isReady();
      if (!isReady) {
        return;
      }

      console.log('[unread] 🔄 Syncing local read status to Supabase...');

      const session = await supabasePipeline.getCachedSession();
      if (!session?.user) {
        console.log('[unread] ⚠️ No session for sync');
        return;
      }

      const client = await supabasePipeline.getDirectClient();
      
      // Get all local group_members with read status
      const { sqliteService: sqlite } = await import('./sqliteService');
      const localMembers = await sqlite.getAllLocalReadStatus(session.user.id);
      
      console.log(`[unread] 📊 Found ${localMembers.length} local read statuses to sync`);

      // Sync each one to Supabase
      for (const member of localMembers) {
        try {
          await client
            .from('group_members')
            .update({
              last_read_at: new Date(member.last_read_at).toISOString(),
              last_read_message_id: member.last_read_message_id,
            })
            .eq('group_id', member.group_id)
            .eq('user_id', session.user.id);
          
          console.log(`[unread] ✅ Synced group ${member.group_id.slice(0, 8)}`);
        } catch (error) {
          console.error(`[unread] ❌ Failed to sync group ${member.group_id.slice(0, 8)}:`, error);
        }
      }

      console.log('[unread] ✅ Sync complete');
    } catch (error) {
      console.error('[unread] ❌ Sync failed:', error);
    }
  }

  /**
   * Mark a group as read up to a specific message
   * @param groupId - The group ID
   * @param lastMessageId - The ID of the last message to mark as read
   * @param messageTimestamp - Optional: The timestamp of the message (if not provided, uses current time)
   */
  public async markGroupAsRead(groupId: string, lastMessageId: string, messageTimestamp?: number): Promise<boolean> {
    // SAFETY CHECK: Fail fast if ID is missing
    // This aligns with our SQL fix to prevent accidental "null" calls wiping out counts
    if (!groupId || !lastMessageId) {
      console.warn('[unread] ⚠️ markGroupAsRead called with missing params, aborting:', { 
        groupId, 
        lastMessageId 
      });
      return false;
    }

    try {
      console.log('[unread] 🔵 markGroupAsRead CALLED:', {
        groupId,
        lastMessageId,
        messageTimestamp: messageTimestamp ? new Date(messageTimestamp).toISOString() : 'using current time',
        timestamp: new Date().toISOString(),
      });
      console.log('[unread] 📋 Message ID type:', typeof lastMessageId, 'length:', lastMessageId?.length);
      
      // Use cached session instead of auth.getUser() to avoid hanging during session refresh
      console.log('[unread] 📡 Getting cached session...');
      const session = await supabasePipeline.getCachedSession();
      
      if (!session?.user) {
        console.warn('[unread] ❌ No cached session, cannot mark as read');
        return false;
      }

      console.log('[unread] ✅ Got cached user:', session.user.id);
      
      console.log('[unread] 📡 Getting Supabase client...');
      const client = await supabasePipeline.getDirectClient();
      console.log('[unread] ✅ Got Supabase client');
      
      // LOCAL-FIRST: Update local SQLite IMMEDIATELY (no Supabase checks first!)
      console.log('[unread] ⚡ LOCAL-FIRST: Updating SQLite immediately...');
      
      // Use provided timestamp or current time as fallback
      const lastReadTime = messageTimestamp || Date.now();
      console.log('[unread] 📅 Using timestamp:', new Date(lastReadTime).toISOString());
      
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
          const { sqliteService } = await import('./sqliteService');
          const isReady = await sqliteService.isReady();
          if (isReady) {
            await sqliteService.updateLocalLastReadAt(
              groupId,
              session.user.id,
              lastReadTime,
              lastMessageId
            );
            console.log('[unread] ✅ LOCAL: Updated SQLite read status instantly');
          } else {
            console.warn('[unread] ⚠️ SQLite not ready, skipping local update');
          }
        }
      } catch (error) {
        console.error('[unread] ❌ Failed to update local SQLite:', error);
        // Continue anyway - we'll try Supabase
      }
      
      // BACKGROUND: Sync to Supabase (non-blocking, happens after local update)
      console.log('[unread] 🌐 BACKGROUND: Syncing to Supabase...');
      
      // Don't await - let it happen in background
      // First get the message timestamp, then update
      client
        .from('messages')
        .select('created_at')
        .eq('id', lastMessageId)
        .single()
        .then(({ data: messageData, error: messageError }: { data: any; error: any }) => {
          if (messageError || !messageData) {
            console.error('[unread] ❌ BACKGROUND: Failed to get message timestamp:', messageError);
            return;
          }
          
          // Now update Supabase with the correct timestamp
          return client
            .from('group_members')
            .update({
              last_read_at: messageData.created_at,
              last_read_message_id: lastMessageId,
            })
            .eq('group_id', groupId)
            .eq('user_id', session.user.id)
            .select();
        })
        .then((result: any) => {
          if (!result) return; // Error already logged
          
          const { data: updateData, error: updateError } = result;
          if (updateError) {
            console.error('[unread] ❌ BACKGROUND: Supabase sync failed:', updateError.message);
            return;
          }
          
          if (!updateData || updateData.length === 0) {
            console.error('[unread] ❌ BACKGROUND: No rows updated - RLS policy issue');
            return;
          }
          
          console.log('[unread] ✅ BACKGROUND: Synced to Supabase:', updateData[0].last_read_at);
        })
        .catch((error: any) => {
          console.error('[unread] ❌ BACKGROUND: Supabase sync exception:', error);
        });
      
      // Return immediately - local update is done
      console.log('[unread] ✅ Returning immediately (local update complete)');
      return true;
    } catch (error: any) {
      console.error('[unread] ❌ Exception in markGroupAsRead:', error);
      return false;
    }
  }
}

// Export singleton instance
export const unreadTracker = new UnreadTrackerService();
