import { sqliteService } from '@/lib/sqliteService';
import { messageCache } from '@/lib/messageCache';
import { Message } from '@/store/chatstore_refactored/types';
import { Capacitor } from '@capacitor/core';

class PreloadingService {
  private isPreloading = false;
  private preloadQueue = new Set<string>();

  /**
   * Preload messages for top groups while user is on dashboard
   */
  async preloadTopGroups(groups: Array<{ id: string; name: string }>): Promise<void> {
    if (this.isPreloading) {
      console.log('🚀 Preloader: Already preloading, skipping');
      return;
    }

    // Only preload on native platforms with SQLite
    if (!Capacitor.isNativePlatform()) {
      console.log('🚀 Preloader: Not on native platform, skipping preload');
      return;
    }

    const isSqliteReady = await sqliteService.isReady();
    if (!isSqliteReady) {
      console.log('🚀 Preloader: SQLite not ready, skipping preload');
      return;
    }

    this.isPreloading = true;
    console.log('🚀 Preloader: Starting background preload for dashboard groups');

    try {
      // Get top 3 groups for preloading
      const topGroupIds = messageCache.getTopGroupsForPreloading(groups, 3);
      
      // Preload each group's messages
      for (const groupId of topGroupIds) {
        if (this.preloadQueue.has(groupId)) {
          console.log(`🚀 Preloader: Group ${groupId} already in queue, skipping`);
          continue;
        }

        // Skip if already cached
        if (messageCache.hasCachedMessages(groupId)) {
          console.log(`🚀 Preloader: Group ${groupId} already cached, skipping`);
          continue;
        }

        this.preloadQueue.add(groupId);
        
        // Preload in background without blocking
        this.preloadGroupMessages(groupId).finally(() => {
          this.preloadQueue.delete(groupId);
        });
      }
    } catch (error) {
      console.error('🚀 Preloader: Error during preload:', error);
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Preload messages for a specific group
   */
  private async preloadGroupMessages(groupId: string): Promise<void> {
    try {
      console.log(`🚀 Preloader: Loading messages for group ${groupId}`);
      
      // Get recent messages from SQLite
      const localMessages = await sqliteService.getRecentMessages(groupId, 10);
      
      if (!localMessages || localMessages.length === 0) {
        console.log(`🚀 Preloader: No messages found for group ${groupId}`);
        return;
      }

      // Get unique user IDs for batch loading
      const userIds = [...new Set(localMessages.filter(msg => !msg.is_ghost).map(msg => msg.user_id))];
      const userCache = new Map();

      // Batch load users
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
          console.error(`🚀 Preloader: Error loading user ${userId}:`, error);
        }
      }

      // Get poll data for poll messages
      const pollMessages = localMessages.filter(msg => msg.message_type === 'poll');
      const pollMessageIds = pollMessages.map(msg => msg.id);
      
      let pollsData: any[] = [];
      let pollVotesData: any[] = [];
      if (pollMessageIds.length > 0) {
        try {
          pollsData = await sqliteService.getPolls(pollMessageIds);
          const pollIds = pollsData.map(poll => poll.id);
          if (pollIds.length > 0) {
            pollVotesData = await sqliteService.getPollVotes(pollIds);
          }
        } catch (error) {
          console.error('🚀 Preloader: Error loading poll data:', error);
        }
      }

      // Create poll data map
      const pollDataMap = new Map();
      pollsData.forEach(poll => {
        const pollVotes = pollVotesData.filter(vote => vote.poll_id === poll.id);
        const pollOptions = JSON.parse(poll.options);
        const voteCounts = new Array(pollOptions.length).fill(0);
        
        pollVotes.forEach(vote => {
          if (vote.option_index < voteCounts.length) {
            voteCounts[vote.option_index]++;
          }
        });

        pollDataMap.set(poll.message_id, {
          ...poll,
          options: pollOptions,
          vote_counts: voteCounts,
          total_votes: pollVotes.length,
          user_vote: null, // We don't have user context during preload
          is_closed: new Date(poll.closes_at) < new Date(),
        });
      });

      // Convert to Message format
      const messages: Message[] = localMessages.map((msg) => {
        let author = undefined;
        if (!msg.is_ghost) {
          author = userCache.get(msg.user_id) || {
            display_name: 'Unknown User',
            avatar_url: null
          };
        }

        const pollData = msg.message_type === 'poll' ? pollDataMap.get(msg.id) : undefined;

        return {
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
          author: author,
          reply_count: 0,
          replies: [],
          delivery_status: 'delivered' as const,
          reactions: [],
          poll: pollData
        };
      });

      // Cache the preloaded messages
      messageCache.setCachedMessages(groupId, messages, true);
      
      console.log(`🚀 Preloader: Successfully preloaded ${messages.length} messages for group ${groupId}`);
    } catch (error) {
      console.error(`🚀 Preloader: Error preloading group ${groupId}:`, error);
    }
  }

  /**
   * Check if a group is currently being preloaded
   */
  isGroupPreloading(groupId: string): boolean {
    return this.preloadQueue.has(groupId);
  }

  /**
   * Get current preloading status
   */
  getPreloadingStatus(): { isPreloading: boolean; queueSize: number } {
    return {
      isPreloading: this.isPreloading,
      queueSize: this.preloadQueue.size
    };
  }

  /**
   * Clear preload queue (useful when user navigates away from dashboard)
   */
  clearPreloadQueue(): void {
    this.preloadQueue.clear();
    this.isPreloading = false;
    console.log('🚀 Preloader: Cleared preload queue');
  }
}

// Export singleton instance
export const preloadingService = new PreloadingService();