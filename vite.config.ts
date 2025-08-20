import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub Firebase messaging plugin on web builds to avoid bundling web adapter
      ...(process.env.BUILD_TARGET === 'web' || !process.env.CAPACITOR_PLATFORM ? {
        '@capacitor-firebase/messaging': path.resolve(__dirname, './src/shims/capacitor-firebase-messaging.ts'),
      } : {}),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: process.env.VITE_SUPABASE_URL ? {
      '/api': {
        target: `${process.env.VITE_SUPABASE_URL}/functions/v1`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    } : undefined,
  },
});