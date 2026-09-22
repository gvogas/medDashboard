import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

// Tokens minted here are signed with the private half of the key whose public half
// vitest.config.js serves as Google's JWKS, so the Worker's verification is real.
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
let privateKey;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function mint(claims, { kid = 'k1', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890', email: 'george@example.com',
    email_verified: true, name: 'George', iat: now, exp: now + 3600, ...claims,
  };
  const head = enc({ alg, kid, typ: 'JWT' }), body = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

beforeAll(async () => {
  privateKey = await crypto.subtle.importKey(
    'jwk', JSON.parse(env.TEST_GOOGLE_PRIVATE_JWK), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
});

const post = (credential, url = 'http://localhost/api/session') =>
  SELF.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });

describe('POST /api/session (Google)', () => {
  it('accepts a token signed by Google for our client id and starts a session', async () => {
    const res = await post(await mint({}));
    expect(res.status).toBe(200);
    const profile = await res.json();
    expect(profile.email).toBe('george@example.com');
    expect(profile.displayName).toBe('George');
    expect(res.headers.get('set-cookie')).toMatch(/^rounds_session=.*HttpOnly/);
  });

  it('rejects a token for a different client id', async () => {
    const res = await post(await mint({ aud: 'someone-else.apps.googleusercontent.com' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'bad_token' });
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await post(await mint({ exp: now - 10 }))).status).toBe(401);
  });

  it('rejects a token from another issuer', async () => {
    expect((await post(await mint({ iss: 'https://evil.example' }))).status).toBe(401);
  });

  it('rejects an unverified email', async () => {
    expect((await post(await mint({ email_verified: false }))).status).toBe(401);
  });

  it('rejects a token signed with an unknown key', async () => {
    expect((await post(await mint({}, { kid: 'nope' }))).status).toBe(401);
  });

  it('rejects a tampered payload', async () => {
    const token = await mint({});
    const [h, p, s] = token.split('.');
    const claims = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    const forged = `${h}.${enc({ ...claims, email: 'mallory@example.com' })}.${s}`;
    expect((await post(forged)).status).toBe(401);
  });

  it('rejects garbage', async () => {
    expect((await post('not-a-jwt')).status).toBe(401);
    expect((await post('')).status).toBe(400);
  });
});
