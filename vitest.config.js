import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { spotifyStub } from './test/spotify-stub.js';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // A separate empty database exercises upgrades from an existing schema.
          d1Databases: { MIGRATION_DB: 'rounds-migration-tests' },
          bindings: {
            TEST_MIGRATIONS: migrations,
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
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
