import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// NetForge dev server. Proxies REST + WS to the FastAPI backend so the
// browser talks to a single origin (avoids CORS in dev, keeps prod parity).
const BACKEND = process.env.VITE_BACKEND_ORIGIN ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5180,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Manual chunks keep the heavy canvas/query libs out of the shell bundle so
    // first paint of the window-manager is fast and stays under the RAM budget.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          flow: ['@xyflow/react'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
