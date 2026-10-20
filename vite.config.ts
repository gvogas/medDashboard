// Rounds — Vite builds the front end; the Cloudflare plugin runs the Worker (API, D1,
// AI, secrets from .dev.vars) inside the dev server, so one process serves everything.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// `npm run dev:fake-ai` (mode fake-ai) runs the Worker with a stand-in for Workers AI, which is
// remote-only and needs a Cloudflare login: test/fake-ai.js says how it answers, and FAKE_AI
// (quota, garbage, fail) makes it answer badly.
const workerFor = (mode: string) => mode === 'fake-ai'
  ? cloudflare({ remoteBindings: false, config: (c) => ({ main: './test/fake-ai-worker.js', ai: undefined, vars: { ...c.vars, FAKE_AI: process.env.FAKE_AI || 'ok' } }) })
  : cloudflare();

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), workerFor(mode)],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Bundle these for the dev server up front. Found one by one as pages load, each find
  // re-bundles mid-load, the page gets two copies of React, and it stays blank.
  optimizeDeps: {
    include: [
      'react', 'react-dom/client', 'react/jsx-dev-runtime', 'framer-motion',
      'clsx', 'tailwind-merge',
    ],
  },
  // http://127.0.0.1:8787 is the redirect URI registered with Spotify. If the port is
  // taken, fail rather than move to another one.
  server: { host: '127.0.0.1', port: 8787, strictPort: true },
  // pdf.js (1.6 MB, its own chunk) loads only when a PDF is read. React and Motion get
  // chunks of their own: they change far less often than the app, so a deploy leaves
  // them in the browser's cache (/assets/* is immutable, public/_headers).
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1700,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
          ],
        },
      },
    },
  },
}));
