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

    // Check if we have a valid cached entry
    const cachedEntry = this.cache.get(cacheKey);
    if (cachedEntry && (now - cachedEntry.timestamp) < this.CACHE_DURATION) {
      console.log('🎭 Returning cached pseudonym for', cacheKey);
      return cachedEntry.pseudonym;
    }

    // Deduplicate concurrent fetches for the same key
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const fetchPromise = (async () => {
      try {
        console.log('🎭 Fetching pseudonym from Supabase for', cacheKey);

        const { data, error } = await supabasePipeline.rpc<string>('upsert_pseudonym', {
          q_group_id: groupId,
          q_user_id: userId
        });

        if (error) {
          console.error('❌ Error fetching pseudonym:', error);
          return 'Anonymous Ghost';
        }

        const pseudonym = data as string;
        this.cache.set(cacheKey, { pseudonym, timestamp: now });
        console.log('✅ Cached new pseudonym:', pseudonym, 'for', cacheKey);
        return pseudonym;
      } catch (error) {
        console.error('💥 Unexpected error fetching pseudonym:', error);
        return 'Anonymous Ghost';
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();

    this.inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
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