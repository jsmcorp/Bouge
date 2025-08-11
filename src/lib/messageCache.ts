import { Message } from '@/store/chatstore_refactored/types';

interface CachedMessages {
  messages: Message[];
  timestamp: number;
  lastAccessed: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  preloads: number;
}

class MessageCacheManager {
  private cache = new Map<string, CachedMessages>();
  private readonly CACHE_EXPIRY = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_CACHE_SIZE = 10; // Maximum number of chats to cache
  private readonly RECENT_MESSAGES_COUNT = 10;
  private stats: CacheStats = { hits: 0, misses: 0, preloads: 0 };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanupInterval();
    console.log('📦 MessageCache: Initialized with 15min expiry, max 10 chats');
  }

  /**
   * Get cached messages for a group (instant access)
   */
  getCachedMessages(groupId: string): Message[] | null {
    const cached = this.cache.get(groupId);
    
    if (!cached) {
      this.stats.misses++;
      console.log(`📦 MessageCache: MISS for group ${groupId}`);
      return null;
    }

    // Check if cache is expired
    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_EXPIRY) {
      this.cache.delete(groupId);
      this.stats.misses++;
      console.log(`📦 MessageCache: EXPIRED for group ${groupId}`);
      return null;
    }

    // Update last accessed time
    cached.lastAccessed = now;
    this.stats.hits++;
    console.log(`📦 MessageCache: HIT for group ${groupId} (${cached.messages.length} messages)`);
    
    return cached.messages;
  }

  /**
   * Store messages in cache
   */
  setCachedMessages(groupId: string, messages: Message[], isPreload = false): void {
    const now = Date.now();
    
    // Only cache the most recent messages to save memory
    const recentMessages = [...messages]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, this.RECENT_MESSAGES_COUNT);

    this.cache.set(groupId, {
      messages: recentMessages,
      timestamp: now,
      lastAccessed: now
    });

    if (isPreload) {
      this.stats.preloads++;
      console.log(`📦 MessageCache: PRELOADED ${recentMessages.length} messages for group ${groupId}`);
    } else {
      console.log(`📦 MessageCache: CACHED ${recentMessages.length} messages for group ${groupId}`);
    }

    // Enforce cache size limit
    this.enforceMaxCacheSize();
  }

  /**
   * Check if messages are cached for a group
   */
  hasCachedMessages(groupId: string): boolean {
    const cached = this.cache.get(groupId);
    if (!cached) return false;

    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_EXPIRY) {
      this.cache.delete(groupId);
      return false;
    }

    return true;
  }

  /**
   * Remove specific group from cache
   */
  invalidateCache(groupId: string): void {
    if (this.cache.delete(groupId)) {
      console.log(`📦 MessageCache: INVALIDATED cache for group ${groupId}`);
    }
  }

  /**
   * Clear all cached messages
   */
  clearCache(): void {
    this.cache.clear();
    console.log('📦 MessageCache: CLEARED all cached messages');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { cacheSize: number } {
    return {
      ...this.stats,
      cacheSize: this.cache.size
    };
  }

  /**
   * Get top groups for preloading (most recently accessed)
   */
  getTopGroupsForPreloading(allGroups: Array<{ id: string; name: string }>, limit = 3): string[] {
    // Get groups sorted by last access time
    const groupsWithAccess = Array.from(this.cache.entries())
      .map(([groupId, cached]) => ({
        groupId,
        lastAccessed: cached.lastAccessed
      }))
      .sort((a, b) => b.lastAccessed - a.lastAccessed);

    // If we have cached groups, prioritize them
    const cachedGroupIds = groupsWithAccess.slice(0, limit).map(g => g.groupId);
    
    // Fill remaining slots with first groups from the list
    const remainingSlots = limit - cachedGroupIds.length;
    if (remainingSlots > 0) {
      const uncachedGroups = allGroups
        .filter(group => !cachedGroupIds.includes(group.id))
        .slice(0, remainingSlots)
        .map(group => group.id);
      
      cachedGroupIds.push(...uncachedGroups);
    }

    console.log(`📦 MessageCache: Top ${limit} groups for preloading:`, cachedGroupIds);
    return cachedGroupIds;
  }

  /**
   * Enforce maximum cache size by removing least recently accessed items
   */
  private enforceMaxCacheSize(): void {
    if (this.cache.size <= this.MAX_CACHE_SIZE) return;

    // Sort by last accessed time (oldest first)
    const sortedEntries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    // Remove oldest entries
    const toRemove = this.cache.size - this.MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      const [groupId] = sortedEntries[i];
      this.cache.delete(groupId);
      console.log(`📦 MessageCache: EVICTED group ${groupId} (LRU)`);
    }
  }

  /**
   * Start periodic cleanup of expired cache entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Remove expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [groupId, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.CACHE_EXPIRY) {
        this.cache.delete(groupId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`📦 MessageCache: CLEANUP removed ${removedCount} expired entries`);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearCache();
    console.log('📦 MessageCache: DESTROYED');
  }
}

// Export singleton instance
export const messageCache = new MessageCacheManager();