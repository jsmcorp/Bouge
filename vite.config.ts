import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // ONLY use web shim for actual web builds (dev server)
      // For native builds (npm run build), DO NOT alias - use the real native plugin
      ...(process.env.NODE_ENV === 'development' && !process.env.CAPACITOR_PLATFORM ? {
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