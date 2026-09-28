import path from 'node:path';
import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { spotifyStub } from './test/spotify-stub.js';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  // The schema before the move to a fresh database, for testing the copy out of it.
  const legacy = await readD1Migrations(path.join(import.meta.dirname, 'test/fixtures/legacy-migrations'));
  return {
    test: {
      // Limit startup and password-hashing contention on busy developer machines.
      maxWorkers: Math.min(4, availableParallelism()),
      projects: [
        // The API, the database and the logic modules, in the Workers runtime.
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              // Never reach Cloudflare from tests: the AI binding is remote-only, so outline
              // reading is tested with a fake passed to worker/outline.js directly.
              remoteBindings: false,
              miniflare: {
                // Two more empty databases: an old-schema source and a fresh target for the copy.
                d1Databases: { MIGRATION_DB: 'rounds-migration-tests', MOVE_DB: 'rounds-move-tests' },
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  LEGACY_MIGRATIONS: legacy,
                  SESSION_SECRET: 'test-secret-not-for-production',
                  SPOTIFY_TOKEN_KEYS: JSON.stringify({ current: 'v1', keys: { v1: 'test-spotify-encryption-key-at-least-32-characters' } }),
                  SPOTIFY_CLIENT_ID: 'test-client-id',
                  SPOTIFY_CLIENT_SECRET: 'test-client-secret',
                },
                // The only outbound calls are to Spotify, answered by the fake in
                // test/spotify-stub.js; anything else gets a 502, so tests never touch the network.
                outboundService: spotifyStub,
              },
            }),
          ],
          test: {
            name: 'workers',
            include: ['test/**/*.test.js'],
            // Each file starts a Workers runtime and migrates isolated D1 storage.
            // Sign-in runs 100,000 PBKDF2 rounds; tests that sign in several users can pass 5 s under load.
            testTimeout: 20_000,
            setupFiles: ['./test/apply-migrations.js'],
          },
        },
        // React components, in a simulated browser.
        {
          plugins: [react()],
          resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
          test: {
            name: 'dom',
            include: ['src/**/*.test.{ts,tsx}'],
            environment: 'jsdom',
            setupFiles: ['./src/test-setup.ts'],
            // The first test in a file waits for React and Framer Motion to load, and the run
            // tests play whole flows on a clock that ticks four times a second: twenty minutes of
            // it takes about as many seconds on a busy machine.
            testTimeout: 60_000,
          },
        },
      ],
    },
  };
});
