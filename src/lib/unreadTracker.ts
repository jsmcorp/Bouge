import { supabasePipeline } from './supabasePipeline';

/**
 * Simple Unread Tracker - Clean Implementation
 * 
 * Just wraps Supabase RPC calls, no caching, no timers, no complexity
 */
class UnreadTrackerService {
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

      const { data, error } = await client.rpc('get_all_unread_counts', {
        p_user_id: user.id,
      });

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
    try {
      console.log('[unread] 🔵 markGroupAsRead CALLED:', {
        groupId,
        lastMessageId,
        timestamp: new Date().toISOString(),
      });
      
      console.log('[unread] 📡 Getting Supabase client...');
      const client = await supabasePipeline.getDirectClient();
      console.log('[unread] ✅ Got Supabase client');
      
      const { data: { user } } = await client.auth.getUser();
      
      if (!user) {
        console.warn('[unread] ❌ No user, cannot mark as read');
        return false;
      }

      console.log('[unread] ✅ Got user:', user.id);
      console.log('[unread] 📡 Calling Supabase RPC mark_group_as_read with params:', {
        p_group_id: groupId,
        p_user_id: user.id,
        p_last_message_id: lastMessageId,
      });

      const { error } = await client.rpc('mark_group_as_read', {
        p_group_id: groupId,
        p_user_id: user.id,
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
