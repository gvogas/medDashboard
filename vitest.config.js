import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

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
          },
          // The Worker makes no outbound requests; refuse any, so tests never touch the network.
          outboundService: (request) => new Response('outbound fetch blocked in tests: ' + request.url, { status: 502 }),
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
