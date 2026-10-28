import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', ws: true },
      // Only used by the platform health check in production, but proxying it
      // means `curl localhost:5173/health` works locally too instead of
      // quietly returning the SPA's index.html.
      '/health': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true },
    },
  },
});
