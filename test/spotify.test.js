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

describe('connect', () => {
  it('needs a session', async () => {
    expect((await get('/api/spotify/connect')).status).toBe(401);
  });

  it('sends you to Spotify with a state that matches the cookie', async () => {
    const { cookie } = await session();
    const res = await get('/api/spotify/connect', cookie);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.origin + to.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(to.searchParams.get('client_id')).toBe('test-client');
    expect(to.searchParams.get('response_type')).toBe('code');
    expect(to.searchParams.get('redirect_uri')).toBe(`${BASE}/api/spotify/callback`);
    expect(to.searchParams.get('scope')).toBe('user-read-playback-state user-modify-playback-state');
    const state = to.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    const set = res.headers.get('set-cookie');
    expect(set).toContain(`rounds_spotify_state=${state};`);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Max-Age=600/);
  });

  it('is 503 when Spotify is not configured', async () => {
    const { cookie } = await session();
    const res = await worker.fetch(new Request(`${BASE}/api/spotify/connect`, { headers: { cookie } }), { ...env, SPOTIFY_CLIENT_SECRET: '' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'spotify_not_configured' });
  });
});

describe('callback', () => {
  const callback = (query, cookie) => get(`/api/spotify/callback?${query}`, cookie);

  it('stores encrypted tokens for a good code and goes back to the app', async () => {
    const { userId, cookie } = await session();
    const res = await callback('code=good&state=s1', `${cookie}; rounds_spotify_state=s1`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=connected`);
    expect(res.headers.get('set-cookie')).toMatch(/rounds_spotify_state=;.*Max-Age=0/);
    const row = await getSpotifyTokens(env.DB, userId);
    expect(row.accessToken).toBe('tok-playing');
    expect(row.refreshToken).not.toBe('refresh-good');
    expect(await decryptToken(env, row.refreshToken)).toBe('refresh-good');
    expect(row.expiresAt).toBeGreaterThan(Date.now());
  });

  for (const [name, query, stateCookie] of [
    ['a state that does not match', 'code=good&state=s1', 'rounds_spotify_state=s2'],
    ['no state cookie', 'code=good&state=s1', ''],
    ['no state in the query', 'code=good', 'rounds_spotify_state=s1'],
    ['Spotify saying no', 'error=access_denied&state=s1', 'rounds_spotify_state=s1'],
    ['a code Spotify refuses', 'code=bad&state=s1', 'rounds_spotify_state=s1'],
  ]) {
    it(`goes back with an error and stores nothing for ${name}`, async () => {
      const { userId, cookie } = await session();
      const res = await callback(query, stateCookie ? `${cookie}; ${stateCookie}` : cookie);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
      expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
    });
  }

  it('goes back with an error without a session', async () => {
    const res = await callback('code=good&state=s1', 'rounds_spotify_state=s1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
  });
});

async function player(cookie) {
  const res = await get('/api/spotify/player', cookie);
  return { status: res.status, headers: res.headers, body: await res.json() };
}

const EVERLONG = {
  title: 'Everlong',
  artists: 'Foo Fighters',
  album: 'The Colour and the Shape',
  art: 'https://i.scdn.co/image/300',
  url: 'https://open.spotify.com/track/abc',
  durationMs: 250000,
  progressMs: 42000,
};

describe('player', () => {
  it('is not connected without a row', async () => {
    const { cookie } = await session();
    expect(await player(cookie)).toMatchObject({ status: 200, body: { connected: false } });
  });

  it('maps a playing track', async () => {
    const { userId, cookie } = await session();
    await seed(userId);
    expect((await player(cookie)).body).toEqual({ connected: true, playing: true, device: 'Laptop', track: EVERLONG });
  });

  it('maps a paused track', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-paused' });
    expect((await player(cookie)).body).toEqual({ connected: true, playing: false, device: 'Laptop', track: EVERLONG });
  });

  it('is idle when Spotify has nothing playing', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-idle' });
    expect((await player(cookie)).body).toEqual({ connected: true, playing: false, track: null, device: null });
  });

  it('refreshes an access token about to expire, and stores the new one', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired', expiresAt: Date.now() + 30_000 });
    expect((await player(cookie)).body.track).toEqual(EVERLONG);
    const row = await getSpotifyTokens(env.DB, userId);
    expect(row.accessToken).toBe('tok-refreshed');
    expect(await decryptToken(env, row.refreshToken)).toBe('refresh-good');
  });

  it('refreshes once when Spotify turns the token down', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired' });
    expect((await player(cookie)).body.track).toEqual(EVERLONG);
    expect((await getSpotifyTokens(env.DB, userId)).accessToken).toBe('tok-refreshed');
  });

  it('forgets a revoked connection', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired', refresh: 'revoked', expiresAt: 0 });
    expect((await player(cookie)).body).toEqual({ connected: false });
    expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
  });

  it('says Spotify is unavailable when it is down', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-down' });
    expect(await player(cookie)).toMatchObject({ status: 502, body: { error: 'spotify_unavailable' } });
  });

  it('passes a rate limit through', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-limited' });
    const res = await player(cookie);
    expect(res).toMatchObject({ status: 429, body: { error: 'rate_limited', retryAfter: 7 } });
    expect(res.headers.get('retry-after')).toBe('7');
  });
});

const control = (action, cookie) => get(`/api/spotify/player/${action}`, cookie, { method: 'POST' });

describe('controls', () => {
  for (const action of ['play', 'pause', 'next', 'previous', 'restart']) {
    it(`${action} reaches Spotify`, async () => {
      const { userId, cookie } = await session();
      await seed(userId);
      expect((await control(action, cookie)).status).toBe(204);
    });
  }

  it('explains a missing device', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-nodevice' });
    const res = await control('play', cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_device' });
  });

  it('explains that controls need Premium', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-free' });
    const res = await control('next', cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'premium_required' });
  });

  it('is 409 with no connection', async () => {
    const { cookie } = await session();
    const res = await control('play', cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_connected' });
  });

  it('is 409 and forgets a revoked connection', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired', refresh: 'revoked', expiresAt: 0 });
    expect((await control('pause', cookie)).status).toBe(409);
    expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
  });

  it('is 404 for an action it does not know', async () => {
    const { userId, cookie } = await session();
    await seed(userId);
    const res = await control('shuffle', cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('isolation', () => {
  it("never uses one user's Spotify for another", async () => {
    const a = await session(), b = await session();
    await seed(a.userId);
    expect((await player(b.cookie)).body).toEqual({ connected: false });
    expect((await control('pause', b.cookie)).status).toBe(409);
  });
});

describe('disconnect', () => {
  it('deletes the row, and a second call is still fine', async () => {
    const { userId, cookie } = await session();
    await seed(userId);
    expect((await get('/api/spotify', cookie, { method: 'DELETE' })).status).toBe(204);
    expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
    expect((await get('/api/spotify', cookie, { method: 'DELETE' })).status).toBe(204);
  });
});
