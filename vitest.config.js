import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// A stand-in for Google's signing key. The Worker's outbound request for Google's
// JWKS is answered with this public key; tests sign tokens with the private one.
async function fakeGoogleKeys() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pub = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    jwks: JSON.stringify({ keys: [{ kty: pub.kty, n: pub.n, e: pub.e, kid: 'k1', alg: 'RS256', use: 'sig' }] }),
    privateJwk: JSON.stringify(priv),
  };
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  const google = await fakeGoogleKeys();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_GOOGLE_PRIVATE_JWK: google.privateJwk,
            // Test-only settings. Production never sets DEV_LOGIN.
            DEV_LOGIN: '1',
            SESSION_SECRET: 'test-secret-not-for-production',
            GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
          },
          // Every outbound fetch from the Worker lands here: Google's certs are served,
          // anything else is refused, so tests never touch the network.
          outboundService(request) {
            const url = new URL(request.url);
            if (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v3/certs') {
              return new Response(google.jwks, { headers: { 'content-type': 'application/json' } });
            }
            return new Response('outbound fetch blocked in tests: ' + request.url, { status: 502 });
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
