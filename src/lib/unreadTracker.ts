import { supabasePipeline } from './supabasePipeline';
import { sqliteService } from './sqliteService';
import { Capacitor } from '@capacitor/core';

/**
 * Unread Message Tracker Service
 * 
 * Tracks unread messages per user per group, enabling:
 * - Unread message counts on group list
 * - "Unread messages" separator line (WhatsApp-style)
 * - Auto-scroll to first unread message
 * - Mark messages as read when viewing
 */
class UnreadTrackerService {
  private unreadCounts: Map<string, number> = new Map();
  private firstUnreadMessageIds: Map<string, string | null> = new Map();
  private updateCallbacks: Array<(groupId: string, count: number) => void> = [];

  /**
   * Mark a group as read up to a specific message
   */
  public async markGroupAsRead(groupId: string, lastMessageId?: string): Promise<void> {
    try {
      console.log(`[unread] Marking group ${groupId} as read, lastMessageId=${lastMessageId || 'latest'}`);
      
      // Update Supabase
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      
      if (!user) {
        console.warn('[unread] No user found, cannot mark as read');
        return;
      }

      // Call Supabase function to mark as read
      const { error } = await client.rpc('mark_group_as_read', {
        p_group_id: groupId,
        p_user_id: user.id,
        p_last_message_id: lastMessageId || null,
      });

      if (error) {
        console.error('[unread] Error marking group as read in Supabase:', error);
      }

      // Update local SQLite
      const isNative = Capacitor.isNativePlatform();
      if (isNative) {
        const isSqliteReady = await sqliteService.isReady();
        if (isSqliteReady) {
          await this.updateLocalLastRead(groupId, user.id, lastMessageId);
        }
      }

      // Clear cached unread count
      this.unreadCounts.set(groupId, 0);
      this.firstUnreadMessageIds.delete(groupId);

      // Notify listeners
      this.notifyUpdate(groupId, 0);

      console.log(`[unread] ✅ Group ${groupId} marked as read`);
    } catch (error) {
      console.error('[unread] Failed to mark group as read:', error);
    }
  }

  /**
   * Get unread count for a specific group
   */
  public async getUnreadCount(groupId: string): Promise<number> {
    try {
      // Check cache first
      if (this.unreadCounts.has(groupId)) {
        return this.unreadCounts.get(groupId)!;
      }

      // Try local SQLite first for instant response
      const isNative = Capacitor.isNativePlatform();
      if (isNative) {
        const isSqliteReady = await sqliteService.isReady();
        if (isSqliteReady) {
          const localCount = await this.getLocalUnreadCount(groupId);
          this.unreadCounts.set(groupId, localCount);
          return localCount;
        }
      }

      // Fallback to Supabase
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      
      if (!user) {
        return 0;
      }

      const { data, error } = await client.rpc('get_unread_count', {
        p_group_id: groupId,
        p_user_id: user.id,
      });

      if (error) {
        console.error('[unread] Error getting unread count:', error);
        return 0;
      }

      const count = data || 0;
      this.unreadCounts.set(groupId, count);
      return count;
    } catch (error) {
      console.error('[unread] Failed to get unread count:', error);
      return 0;
    }
  }

  /**
   * Get unread counts for all groups
   */
  public async getAllUnreadCounts(): Promise<Map<string, number>> {
    try {
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      
      if (!user) {
        return new Map();
      }

      const { data, error } = await client.rpc('get_all_unread_counts', {
        p_user_id: user.id,
      });

      if (error) {
        console.error('[unread] Error getting all unread counts:', error);
        return new Map();
      }

      const counts = new Map<string, number>();
      if (data && Array.isArray(data)) {
        for (const row of data) {
          counts.set(row.group_id, row.unread_count || 0);
          this.unreadCounts.set(row.group_id, row.unread_count || 0);
        }
      }

      return counts;
    } catch (error) {
      console.error('[unread] Failed to get all unread counts:', error);
      return new Map();
    }
  }

  /**
   * Get the ID of the first unread message in a group
   */
  public async getFirstUnreadMessageId(groupId: string): Promise<string | null> {
    try {
      // Check cache first
      if (this.firstUnreadMessageIds.has(groupId)) {
        return this.firstUnreadMessageIds.get(groupId)!;
      }

      // Try local SQLite first
      const isNative = Capacitor.isNativePlatform();
      if (isNative) {
        const isSqliteReady = await sqliteService.isReady();
        if (isSqliteReady) {
          const localFirstUnread = await this.getLocalFirstUnreadMessageId(groupId);
          this.firstUnreadMessageIds.set(groupId, localFirstUnread);
          return localFirstUnread;
        }
      }

      // Fallback to Supabase
      const client = await supabasePipeline.getDirectClient();
      const { data: { user } } = await client.auth.getUser();
      
      if (!user) {
        return null;
      }

      const { data, error } = await client.rpc('get_first_unread_message_id', {
        p_group_id: groupId,
        p_user_id: user.id,
      });

      if (error) {
        console.error('[unread] Error getting first unread message ID:', error);
        return null;
      }

      const messageId = data || null;
      this.firstUnreadMessageIds.set(groupId, messageId);
      return messageId;
    } catch (error) {
      console.error('[unread] Failed to get first unread message ID:', error);
      return null;
    }
  }

  /**
   * Subscribe to unread count updates
   */
  public onUnreadCountUpdate(callback: (groupId: string, count: number) => void): () => void {
    this.updateCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) {
        this.updateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Clear cached unread data for a group
   */
  public clearCache(groupId?: string): void {
    if (groupId) {
      this.unreadCounts.delete(groupId);
      this.firstUnreadMessageIds.delete(groupId);
    } else {
      this.unreadCounts.clear();
      this.firstUnreadMessageIds.clear();
    }
  }

  /**
   * Manually trigger callbacks for a group
   * Used when FCM notification arrives and message is stored locally
   * This updates dashboard badges in real-time
   */
  public async triggerCallbacks(groupId: string): Promise<void> {
    try {
      // Clear cache to force fresh count
      this.clearCache(groupId);

      // Get fresh unread count
      const count = await this.getUnreadCount(groupId);

      // Notify all listeners
      this.notifyUpdate(groupId, count);

      console.log(`[unread] Triggered callbacks for group ${groupId}, count=${count}`);
    } catch (error) {
      console.error('[unread] Error triggering callbacks:', error);
    }
  }

  /**
   * Get local unread count from SQLite
   */
  private async getLocalUnreadCount(groupId: string): Promise<number> {
    try {
      const db = sqliteService['dbManager'].getConnection();
      const { data: { user } } = await (await supabasePipeline.getDirectClient()).auth.getUser();

      if (!user) return 0;

      // Get last_read_at for this user in this group
      const memberResult = await db.query(
        'SELECT last_read_at, joined_at FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, user.id]
      );

      if (!memberResult.values || memberResult.values.length === 0) {
        return 0; // User not a member
      }

      const lastReadAt = memberResult.values[0].last_read_at || 0;
      const joinedAt = memberResult.values[0].joined_at || 0;

      // If last_read_at is 0 (never read), use joined_at as the baseline
      // This ensures only messages AFTER joining are counted as unread
      const baselineTime = lastReadAt > 0 ? lastReadAt : joinedAt;

      // Count messages created after baseline, excluding user's own messages
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM messages WHERE group_id = ? AND user_id != ? AND created_at > ?',
        [groupId, user.id, baselineTime]
      );

      return countResult.values?.[0]?.count || 0;
    } catch (error) {
      console.error('[unread] Error getting local unread count:', error);
      return 0;
    }
  }

  /**
   * Get first unread message ID from local SQLite
   */
  private async getLocalFirstUnreadMessageId(groupId: string): Promise<string | null> {
    try {
      const db = sqliteService['dbManager'].getConnection();
      const { data: { user } } = await (await supabasePipeline.getDirectClient()).auth.getUser();

      if (!user) return null;

      // Get last_read_at and joined_at
      const memberResult = await db.query(
        'SELECT last_read_at, joined_at FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, user.id]
      );

      if (!memberResult.values || memberResult.values.length === 0) {
        return null; // User not a member
      }

      const lastReadAt = memberResult.values[0].last_read_at || 0;
      const joinedAt = memberResult.values[0].joined_at || 0;

      // If last_read_at is 0 (never read), use joined_at as the baseline
      const baselineTime = lastReadAt > 0 ? lastReadAt : joinedAt;

      // Get first message after baseline, excluding user's own messages
      const messageResult = await db.query(
        'SELECT id FROM messages WHERE group_id = ? AND user_id != ? AND created_at > ? ORDER BY created_at ASC LIMIT 1',
        [groupId, user.id, baselineTime]
      );

      return messageResult.values?.[0]?.id || null;
    } catch (error) {
      console.error('[unread] Error getting local first unread message ID:', error);
      return null;
    }
  }

  /**
   * Update local last_read_at in SQLite
   */
  private async updateLocalLastRead(groupId: string, userId: string, lastMessageId?: string): Promise<void> {
    try {
      const db = sqliteService['dbManager'].getConnection();
      
      await db.run(
        `UPDATE group_members 
         SET last_read_at = ?, last_read_message_id = ? 
         WHERE group_id = ? AND user_id = ?`,
        [Date.now(), lastMessageId || null, groupId, userId]
      );
    } catch (error) {
      console.error('[unread] Error updating local last_read:', error);
    }
  }

  /**
   * Notify all listeners of unread count update
   */
  private notifyUpdate(groupId: string, count: number): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback(groupId, count);
      } catch (error) {
        console.error('[unread] Error in update callback:', error);
      }
    }
  }
}

// Export singleton instance
export const unreadTracker = new UnreadTrackerService();

