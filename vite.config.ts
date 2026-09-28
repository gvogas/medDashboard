// Rounds — Vite builds the front end; the Cloudflare plugin runs the Worker (API, D1,
// AI, secrets from .dev.vars) inside the dev server, so one process serves everything.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Bundle these for the dev server up front. Found one by one as pages load, each find
  // re-bundles mid-load, the page gets two copies of React, and it stays blank.
  optimizeDeps: {
    include: [
      'react', 'react-dom/client', 'react/jsx-dev-runtime', 'framer-motion',
      'clsx', 'tailwind-merge', 'class-variance-authority', '@radix-ui/react-slot',
    ],
  },
  // http://127.0.0.1:8787 is the redirect URI registered with Spotify. If the port is
  // taken, fail rather than move to another one.
  server: { host: '127.0.0.1', port: 8787, strictPort: true },
  // pdf.js (1.6 MB, its own chunk) loads only when a PDF is read.
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 1700 },
});
