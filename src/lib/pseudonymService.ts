import { supabasePipeline } from './supabasePipeline';
import { sqliteService } from './sqliteService';
import { Capacitor } from '@capacitor/core';

interface PseudonymCacheEntry {
  pseudonym: string;
  timestamp: number;
}

// Adjectives and nouns for local pseudonym generation
const ADJECTIVES = [
  'Swift', 'Silent', 'Mystic', 'Brave', 'Clever', 'Gentle', 'Fierce', 'Wise',
  'Bold', 'Quick', 'Calm', 'Sharp', 'Bright', 'Dark', 'Light', 'Wild',
  'Free', 'Pure', 'Strong', 'Soft', 'Fast', 'Slow', 'Deep', 'High',
  'Ancient', 'Modern', 'Hidden', 'Open', 'Secret', 'Clear', 'Misty', 'Sunny',
  'Stormy', 'Peaceful', 'Restless', 'Steady', 'Wandering', 'Still', 'Moving', 'Dancing'
];

const NOUNS = [
  'Wolf', 'Eagle', 'Tiger', 'Bear', 'Fox', 'Owl', 'Hawk', 'Lion',
  'Deer', 'Rabbit', 'Cat', 'Dog', 'Horse', 'Dragon', 'Phoenix', 'Raven',
  'Falcon', 'Panther', 'Leopard', 'Jaguar', 'Lynx', 'Puma', 'Cheetah', 'Cougar',
  'Shadow', 'Flame', 'Storm', 'Wind', 'Rain', 'Snow', 'Ice', 'Fire',
  'Star', 'Moon', 'Sun', 'Sky', 'Ocean', 'River', 'Mountain', 'Forest',
  'Valley', 'Desert', 'Island', 'Cave', 'Bridge', 'Tower', 'Castle', 'Garden'
];

class PseudonymService {
  private cache: Map<string, PseudonymCacheEntry> = new Map();
  private inFlight: Map<string, Promise<string>> = new Map();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private readonly RPC_TIMEOUT = 3000; // 3 seconds timeout for RPC calls

  /**
   * Generate a random pseudonym locally
   */
  private generateLocalPseudonym(): string {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${adjective} ${noun}`;
  }

  /**
   * Get a pseudonym for a user in a specific group
   * @param groupId - The group ID
   * @param userId - The user ID
   * @returns Promise<string> - The pseudonym
   */
  async getPseudonym(groupId: string, userId: string): Promise<string> {
    const cacheKey = `${groupId}:${userId}`;
    const now = Date.now();

    // Fast path: serve cached pseudonym if fresh (within 24 hours)
    const cachedEntry = this.cache.get(cacheKey);
    if (cachedEntry && (now - cachedEntry.timestamp) < this.CACHE_DURATION) {
      if (import.meta.env.DEV) console.log('🎭 Returning cached pseudonym (fresh) for', cacheKey);
      return cachedEntry.pseudonym;
    }

    // Try to get from local SQLite first (for offline support)
    if (Capacitor.isNativePlatform()) {
      try {
        const localPseudonyms = await sqliteService.getUserPseudonyms(groupId);
        const localEntry = localPseudonyms.find(p => p.user_id === userId);

        if (localEntry) {
          const age = now - localEntry.created_at;
          // If less than 24 hours old, use it
          if (age < this.CACHE_DURATION) {
            if (import.meta.env.DEV) console.log('🎭 Returning pseudonym from SQLite for', cacheKey);
            this.cache.set(cacheKey, { pseudonym: localEntry.pseudonym, timestamp: localEntry.created_at });
            return localEntry.pseudonym;
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) console.warn('⚠️ Failed to get pseudonym from SQLite:', error);
      }
    }

    // If cached but stale, return it immediately and refresh in background
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

    const fetchPromise = this.fetchAndCache(groupId, userId);
    this.inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  private async fetchAndCache(groupId: string, userId: string): Promise<string> {
    const cacheKey = `${groupId}:${userId}`;
    const now = Date.now();

    try {
      if (import.meta.env.DEV) console.log('🎭 Fetching pseudonym from Supabase for', cacheKey);

      // Race between RPC call and timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Pseudonym RPC timeout')), this.RPC_TIMEOUT);
      });

      const rpcPromise = supabasePipeline.rpc<string>('upsert_pseudonym', {
        q_group_id: groupId,
        q_user_id: userId,
      });

      const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as { data: string | null; error: any };

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('No pseudonym returned from RPC');
      }

      const pseudonym = data as string;

      // Cache in memory
      this.cache.set(cacheKey, { pseudonym, timestamp: now });

      // Save to local SQLite for offline access
      if (Capacitor.isNativePlatform()) {
        try {
          await sqliteService.saveUserPseudonym({
            group_id: groupId,
            user_id: userId,
            pseudonym,
            created_at: now
          });
          if (import.meta.env.DEV) console.log('💾 Saved pseudonym to SQLite:', pseudonym);
        } catch (sqliteError) {
          if (import.meta.env.DEV) console.warn('⚠️ Failed to save pseudonym to SQLite:', sqliteError);
        }
      }

      if (import.meta.env.DEV) console.log('✅ Cached new pseudonym:', pseudonym, 'for', cacheKey);
      return pseudonym;

    } catch (error) {
      if (import.meta.env.DEV) console.error('💥 Error fetching pseudonym, generating locally:', error);

      // Generate a local pseudonym as fallback
      const localPseudonym = this.generateLocalPseudonym();

      // Cache it
      this.cache.set(cacheKey, { pseudonym: localPseudonym, timestamp: now });

      // Try to save locally
      if (Capacitor.isNativePlatform()) {
        try {
          await sqliteService.saveUserPseudonym({
            group_id: groupId,
            user_id: userId,
            pseudonym: localPseudonym,
            created_at: now
          });
          if (import.meta.env.DEV) console.log('💾 Saved locally-generated pseudonym to SQLite:', localPseudonym);
        } catch (sqliteError) {
          if (import.meta.env.DEV) console.warn('⚠️ Failed to save local pseudonym to SQLite:', sqliteError);
        }
      }

      // Try to sync to Supabase in background (fire and forget)
      this.syncPseudonymToSupabase(groupId, userId, localPseudonym).catch(() => {
        // Ignore errors in background sync
      });

      return localPseudonym;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /**
   * Sync a locally-generated pseudonym to Supabase in the background
   */
  private async syncPseudonymToSupabase(groupId: string, userId: string, pseudonym: string): Promise<void> {
    try {
      // This is a fire-and-forget operation, so we don't wait for it
      await supabasePipeline.rpc('upsert_pseudonym', {
        q_group_id: groupId,
        q_user_id: userId,
        q_pseudonym: pseudonym,
      });
    } catch (error) {
      // Silently fail - the local pseudonym is already being used
      if (import.meta.env.DEV) console.warn('⚠️ Background sync of pseudonym failed:', error);
    }
  }

  /**
   * Preload pseudonyms for a group (useful for optimization)
   */
  async preloadPseudonymsForGroup(groupId: string, userIds: string[]): Promise<void> {
    const promises = userIds.map(userId =>
      this.getPseudonym(groupId, userId).catch(() => {
        // Ignore individual failures
      })
    );
    await Promise.allSettled(promises);
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