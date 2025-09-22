// Note: The actual Supabase client is now managed exclusively by supabasePipeline.ts
// This file only exports types and feature flags for consistency across the app

// Re-export Database type from the generated types file
export type { Database, Json } from './database.types';

// Feature flag for new simplified realtime connection logic
export const FEATURES = {
  SIMPLIFIED_REALTIME: import.meta.env.VITE_SIMPLIFIED_REALTIME !== 'false', // Default enabled
} as const;
