// Rounds — Vite builds the front end; the Cloudflare plugin runs the Worker (API, D1,
// AI, secrets from .dev.vars) inside the dev server, so one process serves everything.
// `--mode ios` (npm run build:ios) builds the iPhone/Mac app's copy instead: no Worker, into
// dist-ios/, talking to the live API with a token (src/core/native.ts, docs/IOS.md).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ mode }) => {
  const ios = mode === 'ios';
  if (ios) {
    process.env.VITE_NATIVE = '1';
    process.env.VITE_APP_VERSION ||= JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  }
  return {
    plugins: [react(), tailwindcss(), ...(ios ? [] : [cloudflare()])],
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
      ...(ios ? { outDir: 'dist-ios', emptyOutDir: true } : {}),
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
  };
});
