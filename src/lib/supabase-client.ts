/**
 * Temporary Supabase client wrapper to handle type issues
 * This bypasses the strict typing while maintaining functionality
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Custom synchronous storage adapter with logging
const customStorageAdapter = {
  getItem: (key: string) => {
    const start = performance.now();
    try {
      const value = window.localStorage.getItem(key);
      const duration = performance.now() - start;
      console.log(`[storage-adapter] ✅ getItem("${key}") -> ${value ? `${value.substring(0, 50)}...` : 'null'} (${duration.toFixed(2)}ms)`);
      return value;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`[storage-adapter] ❌ getItem("${key}") failed after ${duration.toFixed(2)}ms:`, error);
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    const start = performance.now();
    try {
      window.localStorage.setItem(key, value);
      const duration = performance.now() - start;
      console.log(`[storage-adapter] ✅ setItem("${key}", ${value.substring(0, 50)}...) (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`[storage-adapter] ❌ setItem("${key}") failed after ${duration.toFixed(2)}ms:`, error);
    }
  },
  removeItem: (key: string) => {
    const start = performance.now();
    try {
      window.localStorage.removeItem(key);
      const duration = performance.now() - start;
      console.log(`[storage-adapter] ✅ removeItem("${key}") (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`[storage-adapter] ❌ removeItem("${key}") failed after ${duration.toFixed(2)}ms:`, error);
    }
  },
};

console.log('[storage-adapter] 🔧 Custom synchronous storage adapter initialized for supabase-client.ts');

// Create client without strict typing to avoid the 'never' type issues
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,  // ✅ Use custom synchronous storage adapter
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    worker: true, // Enable Web Worker heartbeats
  },
});

// Type-safe wrapper functions
export const supabaseQuery = {
  from: (table: string) => (supabaseClient as any).from(table),
  auth: supabaseClient.auth,
  channel: (name: string, config?: any) => supabaseClient.channel(name, config),
  removeChannel: (channel: any) => supabaseClient.removeChannel(channel),
};
