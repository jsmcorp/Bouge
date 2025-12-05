/**
 * Topic Cache Manager
 * 
 * Manages caching strategy for topics:
 * - Limits cached pages to last 5 pages (100 topics)
 * - Invalidates cache on real-time updates
 * - Tracks cache metadata
 * 
 * Task 14.1: Implement caching strategy
 */

import { sqliteService } from '@/lib/sqliteService';
import { Capacitor } from '@capacitor/core';

const MAX_CACHED_PAGES = 5;
const TOPICS_PER_PAGE = 20;
const MAX_CACHED_TOPICS = MAX_CACHED_PAGES * TOPICS_PER_PAGE; // 100 topics

export interface CacheMetadata {
  groupId: string;
  lastFetchTime: number;
  cachedPages: number;
  totalCachedTopics: number;
}

class TopicCacheManager {
  private cacheMetadata: Map<string, CacheMetadata> = new Map();

  /**
   * Check if cache needs cleanup for a group
   */
  async shouldCleanupCache(groupId: string): Promise<boolean> {
    const metadata = this.cacheMetadata.get(groupId);
    if (!metadata) return false;

    return metadata.totalCachedTopics > MAX_CACHED_TOPICS;
  }

  /**
   * Cleanup old cached topics, keeping only the most recent MAX_CACHED_TOPICS
   */
  async cleanupOldCache(groupId: string): Promise<void> {
    const isNative = Capacitor.isNativePlatform();
    if (!isNative) return;

    const isSqliteReady = await sqliteService.isReady();
    if (!isSqliteReady) return;

    try {
      console.log(`🧹 Cleaning up old cached topics for group ${groupId}`);

      // Get all cached topics for this group, sorted by created_at DESC
      const allCached = await sqliteService.getTopicsFromCache(
        groupId,
        1000, // Get all
        0
      );

      if (allCached.length <= MAX_CACHED_TOPICS) {
        console.log(`✅ Cache size OK: ${allCached.length}/${MAX_CACHED_TOPICS} topics`);
        return;
      }

      // Keep only the most recent MAX_CACHED_TOPICS
      const topicsToKeep = allCached.slice(0, MAX_CACHED_TOPICS);
      const topicsToDelete = allCached.slice(MAX_CACHED_TOPICS);

      console.log(`🗑️ Deleting ${topicsToDelete.length} old cached topics`);

      // Delete old topics from cache
      for (const topic of topicsToDelete) {
        await sqliteService.deleteTopicFromCache(topic.id);
      }

      // Update metadata
      this.cacheMetadata.set(groupId, {
        groupId,
        lastFetchTime: Date.now(),
        cachedPages: MAX_CACHED_PAGES,
        totalCachedTopics: topicsToKeep.length
      });

      console.log(`✅ Cache cleanup complete: ${topicsToKeep.length} topics remaining`);
    } catch (error) {
      console.error('Error cleaning up cache:', error);
    }
  }

  /**
   * Update cache metadata after fetch
   */
  updateCacheMetadata(groupId: string, newTopicsCount: number): void {
    const existing = this.cacheMetadata.get(groupId);
    const totalCached = (existing?.totalCachedTopics || 0) + newTopicsCount;

    this.cacheMetadata.set(groupId, {
      groupId,
      lastFetchTime: Date.now(),
      cachedPages: Math.ceil(totalCached / TOPICS_PER_PAGE),
      totalCachedTopics: totalCached
    });
  }

  /**
   * Invalidate cache for a group (e.g., after real-time update)
   */
  invalidateCache(groupId: string): void {
    console.log(`🔄 Invalidating cache for group ${groupId}`);
    this.cacheMetadata.delete(groupId);
  }

  /**
   * Get cache metadata for a group
   */
  getCacheMetadata(groupId: string): CacheMetadata | undefined {
    return this.cacheMetadata.get(groupId);
  }

  /**
   * Clear all cache metadata
   */
  clearAllMetadata(): void {
    this.cacheMetadata.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalGroups: number;
    totalCachedTopics: number;
    averageTopicsPerGroup: number;
  } {
    const groups = Array.from(this.cacheMetadata.values());
    const totalCachedTopics = groups.reduce((sum, g) => sum + g.totalCachedTopics, 0);

    return {
      totalGroups: groups.length,
      totalCachedTopics,
      averageTopicsPerGroup: groups.length > 0 ? totalCachedTopics / groups.length : 0
    };
  }
}

// Singleton instance
export const topicCacheManager = new TopicCacheManager();
