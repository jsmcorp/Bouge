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
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      
      if (!user) {
        console.log('[unread] No user, returning empty counts');
        return new Map();
      }

      console.log('[unread] Fetching counts from Supabase for user:', user.id);

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
   * Mark a group as read up to a specific message
   */
  public async markGroupAsRead(groupId: string, lastMessageId: string): Promise<boolean> {
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
        timestamp: new Date().toISOString(),
      });
      
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
      
      console.log('[unread] 📡 Calling Supabase RPC mark_group_as_read with params:', {
        p_group_id: groupId,
        p_user_id: session.user.id,
        p_last_message_id: lastMessageId,
      });

      const { error } = await client.rpc('mark_group_as_read', {
        p_group_id: groupId,
        p_user_id: session.user.id,
        p_last_message_id: lastMessageId,
      });

      console.log('[unread] 📡 RPC call completed');

      if (error) {
        console.error('[unread] ❌ Mark as read RPC error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        return false;
      }

      console.log('[unread] ✅ Supabase RPC mark_group_as_read succeeded');
      console.log('[unread] 💾 Persisted read status to Supabase for group:', groupId);
      return true;
    } catch (error) {
      console.error('[unread] ❌ Exception in markGroupAsRead:', error);
      return false;
    }
  }
}

// Export singleton instance
export const unreadTracker = new UnreadTrackerService();
