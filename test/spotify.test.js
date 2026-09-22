import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../worker/index.js';
import { BASE, createUser, login } from './helpers.js';
import { encryptToken, decryptToken } from '../worker/spotify.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from '../worker/db.js';

let n = 0;

/** A fresh user and their session cookie. */
async function session() {
  const username = `sp${++n}`;
  const userId = await createUser(username);
  const res = await login(username);
  return { userId, cookie: res.headers.get('set-cookie').split(';')[0] };
}

/** A request that does not follow redirects, so a test can read them. */
function get(path, cookie, init = {}) {
  return SELF.fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  });
}

/** Store a token row directly, the way the callback would. */
async function seed(userId, { access = 'tok-playing', refresh = 'refresh-good', expiresAt = Date.now() + 3600_000 } = {}) {
  await saveSpotifyTokens(env.DB, userId, { refreshToken: await encryptToken(env, refresh), accessToken: access, expiresAt });
}

describe('token encryption', () => {
  it('round-trips and never contains the plaintext', async () => {
    const stored = await encryptToken(env, 'refresh-good');
    expect(stored).not.toContain('refresh-good');
    expect(await decryptToken(env, stored)).toBe('refresh-good');
  });

  it('encrypts the same token differently each time', async () => {
    expect(await encryptToken(env, 'x')).not.toBe(await encryptToken(env, 'x'));
  });

  it('cannot be read under another SESSION_SECRET', async () => {
    const stored = await encryptToken(env, 'x');
    await expect(decryptToken({ ...env, SESSION_SECRET: 'rotated' }, stored)).rejects.toThrow();
  });
});

describe('token rows', () => {
  it('save, read and delete are scoped to the user', async () => {
    const a = await createUser('rowa'), b = await createUser('rowb');
    await saveSpotifyTokens(env.DB, a, { refreshToken: 'enc', accessToken: 'acc', expiresAt: 5 });
    expect(await getSpotifyTokens(env.DB, a)).toEqual({ refreshToken: 'enc', accessToken: 'acc', expiresAt: 5 });
    expect(await getSpotifyTokens(env.DB, b)).toBeNull();
    await saveSpotifyTokens(env.DB, a, { refreshToken: 'enc2', accessToken: 'acc2', expiresAt: 6 });
    expect((await getSpotifyTokens(env.DB, a)).accessToken).toBe('acc2');
    await deleteSpotifyTokens(env.DB, b);
    expect(await getSpotifyTokens(env.DB, a)).not.toBeNull();
    await deleteSpotifyTokens(env.DB, a);
    expect(await getSpotifyTokens(env.DB, a)).toBeNull();
  });
});
