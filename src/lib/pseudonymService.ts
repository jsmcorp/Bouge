import { supabasePipeline } from './supabasePipeline';

interface PseudonymCacheEntry {
  pseudonym: string;
  timestamp: number;
}

class PseudonymService {
  private cache: Map<string, PseudonymCacheEntry> = new Map();
  private inFlight: Map<string, Promise<string>> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

  /**
   * Get a pseudonym for a user in a specific group
   * @param groupId - The group ID
   * @param userId - The user ID
   * @returns Promise<string> - The pseudonym
   */
  async getPseudonym(groupId: string, userId: string): Promise<string> {
    const cacheKey = `${groupId}:${userId}`;
    const now = Date.now();

    // Fast path: serve cached pseudonym if fresh
    const cachedEntry = this.cache.get(cacheKey);
    if (cachedEntry && (now - cachedEntry.timestamp) < this.CACHE_DURATION) {
      if (import.meta.env.DEV) console.log('🎭 Returning cached pseudonym (fresh) for', cacheKey);
      return cachedEntry.pseudonym;
    }

    // If cached but stale, return it immediately (stale-while-revalidate) and refresh in background
    if (cachedEntry) {
      if (import.meta.env.DEV) console.log('🎭 Returning cached pseudonym (stale) for', cacheKey, 'and refreshing in background');
      // Kick off background refresh if not already in-flight
      if (!this.inFlight.has(cacheKey)) {
        this.inFlight.set(cacheKey, this.fetchAndCache(groupId, userId));
      }
      return cachedEntry.pseudonym;
    }

    // No cache: try to fetch, but never return a worse label on failure
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const fetchPromise = this.fetchAndCache(groupId, userId).catch(() => 'Veiled Cipher');
    this.inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  private async fetchAndCache(groupId: string, userId: string): Promise<string> {
    const cacheKey = `${groupId}:${userId}`;
    const now = Date.now();
    try {
      if (import.meta.env.DEV) console.log('🎭 Fetching pseudonym from Supabase for', cacheKey);
      const { data, error } = await supabasePipeline.rpc<string>('upsert_pseudonym', {
        q_group_id: groupId,
        q_user_id: userId,
      });
      if (error) {
        if (import.meta.env.DEV) console.error('❌ Error fetching pseudonym:', error);
        // Do not overwrite existing cache on error
        const existing = this.cache.get(cacheKey);
        return existing?.pseudonym || 'Veiled Cipher';
      }
      const pseudonym = data as string;
      this.cache.set(cacheKey, { pseudonym, timestamp: now });
      if (import.meta.env.DEV) console.log('✅ Cached new pseudonym:', pseudonym, 'for', cacheKey);
      return pseudonym;
    } catch (error) {
      if (import.meta.env.DEV) console.error('💥 Unexpected error fetching pseudonym:', error);
      const existing = this.cache.get(cacheKey);
      return existing?.pseudonym || 'Veiled Cipher';
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /**
   * Clear the cache (useful for testing or manual cache invalidation)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🧹 Pseudonym cache cleared');
  }

  /**
   * Get cache statistics (useful for debugging)
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; pseudonym: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      pseudonym: entry.pseudonym,
      age: now - entry.timestamp
    }));

    return {
      size: this.cache.size,
      entries
    };
  }
}

// Export a singleton instance
export const pseudonymService = new PseudonymService();