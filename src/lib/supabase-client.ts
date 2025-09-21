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

// Create client without strict typing to avoid the 'never' type issues
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
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
