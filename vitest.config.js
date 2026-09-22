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
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: 'test-secret-not-for-production',
            SPOTIFY_CLIENT_ID: 'test-client',
            SPOTIFY_CLIENT_SECRET: 'test-secret',
          },
          // The only outbound calls are to Spotify, answered by a fake; anything else is refused.
          outboundService: spotifyStub,
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
