import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, signIn, createUser, login } from './helpers.js';
import { encryptToken, decryptToken } from '../worker/spotify.js';
import { handleApi } from '../worker/api.js';
import { nextDelayMs } from '../public/js/spotify.js';

const HOUR = 60 * 60 * 1000;

/** Seed a connection directly, the way the callback would, with the given access token. */
async function connect(userId, accessToken, { refreshToken = 'ref-good', expiresAt = Date.now() + HOUR } = {}) {
  await env.DB
    .prepare('INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, await encryptToken(env.SESSION_SECRET, refreshToken), accessToken, expiresAt, Date.now())
    .run();
}

const tokenRow = (userId) => env.DB.prepare('SELECT * FROM spotify_tokens WHERE user_id = ?').bind(userId).first();
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];

/** Sign in and return both the fetch and the user id. */
async function user(name) {
  const api = await signIn(name);
  return { api, id: 'u-' + name };
}

describe('GET /api/spotify/connect', () => {
  it('needs a session', async () => {
    expect((await SELF.fetch(`${BASE}/api/spotify/connect`)).status).toBe(401);
  });

  it('sends the browser to Spotify with the right scopes, client id, redirect and a state that matches its cookie', async () => {
    const { api } = await user('connector');
    const res = await api('/api/spotify/connect', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.origin + to.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(to.searchParams.get('response_type')).toBe('code');
    expect(to.searchParams.get('client_id')).toBe('test-client-id');
    expect(to.searchParams.get('scope')).toBe('user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read streaming user-read-email user-read-private');
    expect(to.searchParams.get('redirect_uri')).toBe(`${BASE}/api/spotify/callback`);
    const state = to.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain(`rounds_spotify_state=${state}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it('is 503 when the app is not configured', async () => {
    await createUser('unconfigured');
    const cookie = cookieOf(await login('unconfigured'));
    // Call the handler directly with the Spotify vars blanked out.
    const url = new URL(`${BASE}/api/spotify/connect`);
    const bare = { ...env, SPOTIFY_CLIENT_ID: '', SPOTIFY_CLIENT_SECRET: '' };
    const res = await handleApi(new Request(url, { headers: { cookie } }), bare, url);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'spotify_not_configured' });
  });
});

describe('GET /api/spotify/callback', () => {
  async function start(name) {
    const { api, id } = await user(name);
    const res = await api('/api/spotify/connect', { redirect: 'manual' });
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    const stateCookie = `${api.cookie}; ${cookieOf(res)}`;   // session and state together
    return { api, id, state, stateCookie };
  }

  it('stores an encrypted refresh token on a good code, clears the state cookie and lands on #spotify=connected', async () => {
    const { api, id, state, stateCookie } = await start('cb-good');
    const res = await api(`/api/spotify/callback?code=good&state=${state}`, { redirect: 'manual', headers: { cookie: stateCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=connected`);
    expect(res.headers.get('set-cookie')).toMatch(/rounds_spotify_state=;.*Max-Age=0/);
    const row = await tokenRow(id);
    expect(row.access_token).toBe('tok-playing');
    expect(row.refresh_token).not.toBe('ref-good');
    expect(await decryptToken(env.SESSION_SECRET, row.refresh_token)).toBe('ref-good');
    expect(await decryptToken('another-secret', row.refresh_token)).toBeNull();
    expect(row.expires_at).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
  });

  it('refuses a state that does not match the cookie, or no cookie at all', async () => {
    const { api, id, state, stateCookie } = await start('cb-state');
    let res = await api(`/api/spotify/callback?code=good&state=${state}`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
    res = await api(`/api/spotify/callback?code=good&state=0000`, { redirect: 'manual', headers: { cookie: stateCookie } });
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
    expect(await tokenRow(id)).toBeNull();
  });

  it('handles Spotify saying no, and a bad code, without storing anything', async () => {
    const { api, id, state, stateCookie } = await start('cb-denied');
    let res = await api(`/api/spotify/callback?error=access_denied&state=${state}`, { redirect: 'manual', headers: { cookie: stateCookie } });
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
    res = await api(`/api/spotify/callback?code=bad&state=${state}`, { redirect: 'manual', headers: { cookie: stateCookie } });
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
    expect(await tokenRow(id)).toBeNull();
  });

  it('redirects to the error hash without a session', async () => {
    const res = await SELF.fetch(`${BASE}/api/spotify/callback?code=good&state=x`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
  });
});

describe('GET /api/spotify/player', () => {
  it('is not connected without a row', async () => {
    const { api } = await user('p-none');
    const res = await api('/api/spotify/player');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });

  it('maps a playing state to the compact shape', async () => {
    const { api, id } = await user('p-playing');
    await connect(id, 'tok-playing');
    expect(await (await api('/api/spotify/player')).json()).toEqual({
      connected: true,
      playing: true,
      device: "George's MacBook",
      deviceId: null,
      volume: null,
      supportsVolume: true,
      track: {
        uri: null,
        title: 'Weightless',
        artists: 'Marconi Union',
        album: 'weightless',
        art: 'https://i.scdn.co/image/weightless-300',
        url: 'https://open.spotify.com/track/weightless',
        durationMs: 489000,
        progressMs: 186000,
      },
    });
  });

  it('maps paused and idle', async () => {
    const { api, id } = await user('p-paused');
    await connect(id, 'tok-paused');
    const paused = await (await api('/api/spotify/player')).json();
    expect(paused.playing).toBe(false);
    expect(paused.track.title).toBe('Clair de Lune, L. 32');
    expect(paused.track.artists).toBe('Claude Debussy, Lang Lang');

    const idle = await user('p-idle');
    await connect(idle.id, 'tok-idle');
    expect(await (await idle.api('/api/spotify/player')).json()).toEqual({ connected: true, playing: false, track: null, device: null, deviceId: null, volume: null, supportsVolume: false });
  });

  it('refreshes an access token that is about to expire and stores the new one', async () => {
    const { api, id } = await user('p-stale');
    await connect(id, 'tok-playing', { expiresAt: Date.now() + 10 * 1000 });
    const body = await (await api('/api/spotify/player')).json();
    expect(body.connected).toBe(true);
    const row = await tokenRow(id);
    expect(row.access_token).toBe('tok-refreshed');
    expect(row.expires_at).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    expect(await decryptToken(env.SESSION_SECRET, row.refresh_token)).toBe('ref-good');
  });

  it('refreshes once more when Spotify still says 401, then retries', async () => {
    const { api, id } = await user('p-expired');
    await connect(id, 'tok-expired');
    const body = await (await api('/api/spotify/player')).json();
    expect(body.playing).toBe(true);
    expect((await tokenRow(id)).access_token).toBe('tok-refreshed');
  });

  it('drops the row when the refresh token was revoked', async () => {
    const { api, id } = await user('p-revoked');
    await connect(id, 'tok-expired', { refreshToken: 'revoked' });
    expect(await (await api('/api/spotify/player')).json()).toEqual({ connected: false });
    expect(await tokenRow(id)).toBeNull();
  });

  it('drops the row when the secret has changed since the token was stored', async () => {
    const { api, id } = await user('p-rotated');
    await env.DB
      .prepare('INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, await encryptToken('the-old-secret', 'ref-good'), 'tok-playing', Date.now() - 1, Date.now())
      .run();
    expect(await (await api('/api/spotify/player')).json()).toEqual({ connected: false });
    expect(await tokenRow(id)).toBeNull();
  });

  it('passes Spotify being down and rate-limiting through as 502 and 429', async () => {
    const down = await user('p-down');
    await connect(down.id, 'tok-down');
    const res = await down.api('/api/spotify/player');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'spotify_unavailable' });

    const busy = await user('p-busy');
    await connect(busy.id, 'tok-busy');
    const limited = await busy.api('/api/spotify/player');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('7');
    expect(await limited.json()).toEqual({ error: 'rate_limited', retryAfter: 7 });
  });
});

describe('POST /api/spotify/player/:action', () => {
  it('sends each of the five actions to the right endpoint', async () => {
    const { api, id } = await user('c-ok');
    await connect(id, 'tok-playing');
    for (const action of ['play', 'pause', 'next', 'previous', 'restart']) {
      const res = await api(`/api/spotify/player/${action}`, { method: 'POST' });
      expect(res.status, action).toBe(204);
    }
  });

  it('explains no device, no Premium and no connection', async () => {
    const nodevice = await user('c-nodevice');
    await connect(nodevice.id, 'tok-nodevice');
    let res = await nodevice.api('/api/spotify/player/play', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_device' });

    const free = await user('c-free');
    await connect(free.id, 'tok-free');
    res = await free.api('/api/spotify/player/next', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'premium_required' });

    const none = await user('c-none');
    res = await none.api('/api/spotify/player/pause', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_connected' });
  });

  it('rejects an unknown action and a cross-site post', async () => {
    const { api, id } = await user('c-bad');
    await connect(id, 'tok-playing');
    expect((await api('/api/spotify/player/shuffle', { method: 'POST' })).status).toBe(404);
    const res = await api('/api/spotify/player/play', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});

describe('the Rounds device', () => {
  const postJson = (api, path, body, headers = {}) =>
    api(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('hands the page a token, never cached, and 409 without a connection', async () => {
    const none = await user('t-none');
    expect((await none.api('/api/spotify/token')).status).toBe(409);
    const { api, id } = await user('t-ok');
    await connect(id, 'tok-playing');
    const res = await api('/api/spotify/token');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.token).toBe('tok-playing');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refreshes an expiring token before handing it over', async () => {
    const { api, id } = await user('t-stale');
    await connect(id, 'tok-playing', { expiresAt: Date.now() + 1000 });
    const body = await (await api('/api/spotify/token')).json();
    expect(body.token).toBe('tok-refreshed');
    expect(body.expiresAt).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
  });

  it('moves playback to a device', async () => {
    const { api, id } = await user('x-ok');
    await connect(id, 'tok-playing');
    const post = (deviceId, headers) => postJson(api, '/api/spotify/transfer', { deviceId }, headers);
    expect((await post('dev-rounds')).status).toBe(400);          /* dashes are not a device id */
    expect((await post(undefined)).status).toBe(400);
    const unknown = await post('devrounds');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'no_device' });
    expect((await post('roundsdev')).status).toBe(204);
    expect((await post('roundsdev', { origin: 'https://evil.example' })).status).toBe(403);
    const free = await user('x-free');
    await connect(free.id, 'tok-free');
    expect((await postJson(free.api, '/api/spotify/transfer', { deviceId: 'roundsdev' })).status).toBe(403);
  });

  it('plays and controls on a named device when asked', async () => {
    const { api, id } = await user('x-dev');
    await connect(id, 'tok-nodevice');
    const playOn = (deviceId) => postJson(api, '/api/spotify/play', { uri: 'spotify:track:t1', deviceId });
    expect((await playOn(undefined)).status).toBe(404);
    expect((await playOn('roundsdev')).status).toBe(204);
    expect((await playOn('bad id')).status).toBe(400);
    expect((await api('/api/spotify/player/play', { method: 'POST' })).status).toBe(404);
    expect((await api('/api/spotify/player/play?deviceId=roundsdev', { method: 'POST' })).status).toBe(204);
    expect((await api('/api/spotify/player/restart?deviceId=roundsdev', { method: 'POST' })).status).toBe(204);
    expect((await api('/api/spotify/player/play?deviceId=bad-id', { method: 'POST' })).status).toBe(400);
  });
});

describe('isolation and disconnect', () => {
  it("never uses one user's connection for another", async () => {
    const alice = await user('iso-alice');
    const bob = await user('iso-bob');
    await connect(alice.id, 'tok-playing');
    expect(await (await bob.api('/api/spotify/player')).json()).toEqual({ connected: false });
    expect((await bob.api('/api/spotify/player/play', { method: 'POST' })).status).toBe(409);
    expect((await bob.api('/api/spotify', { method: 'DELETE' })).status).toBe(204);
    expect((await alice.api('/api/spotify/player')).status).toBe(200);
    expect((await alice.api('/api/spotify/player')).ok).toBe(true);
    expect(await tokenRow(alice.id)).not.toBeNull();
  });

  it('DELETE /api/spotify removes the row, and is 204 again afterwards', async () => {
    const { api, id } = await user('d-gone');
    await connect(id, 'tok-playing');
    expect((await api('/api/spotify', { method: 'DELETE' })).status).toBe(204);
    expect(await tokenRow(id)).toBeNull();
    expect((await api('/api/spotify', { method: 'DELETE' })).status).toBe(204);
    expect(await (await api('/api/spotify/player')).json()).toEqual({ connected: false });
  });
});

describe('the Spotify view', () => {
  it('searches tracks, albums and playlists', async () => {
    const { api, id } = await user('v-search');
    await connect(id, 'tok-playing');
    const res = await api('/api/spotify/search?q=Weightless');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.tracks).toHaveLength(1);
    expect(b.tracks[0]).toMatchObject({ uri: 'spotify:track:t1', title: 'Weightless', artists: 'Marconi Union', art: 'https://i.scdn.co/image/weightless-64', durationMs: 489000 });
    expect(b.albums[0]).toEqual({ uri: 'spotify:album:al1', id: 'al1', name: 'Weightless', artists: 'Marconi Union', art: 'https://i.scdn.co/image/weightless-64', count: 6 });
    expect(b.playlists).toEqual([{ uri: 'spotify:playlist:pl1', id: 'pl1', name: 'Study mix', owner: 'George', art: 'https://i.scdn.co/image/pl1', count: 3 }]);
    expect(await (await api('/api/spotify/search?q=nothing')).json()).toEqual({ tracks: [], albums: [], playlists: [] });
    expect((await api('/api/spotify/search?q=')).status).toBe(400);
    expect((await api('/api/spotify/search')).status).toBe(400);
  });

  it('lists playlists a page at a time', async () => {
    const { api, id } = await user('v-lists');
    await connect(id, 'tok-playing');
    const all = await (await api('/api/spotify/playlists')).json();
    expect(all.items.map((p) => p.name)).toEqual(['Study mix', 'Ward rounds']);
    expect(all).toMatchObject({ total: 2, next: false, offset: 0 });
    expect(all.items[1]).toEqual({ uri: 'spotify:playlist:pl2', id: 'pl2', name: 'Ward rounds', owner: 'Sam', art: null, count: 0 });
    const page2 = await (await api('/api/spotify/playlists?offset=1')).json();
    expect(page2.items.map((p) => p.name)).toEqual(['Ward rounds']);
    expect((await api('/api/spotify/playlists?offset=x')).status).toBe(400);
  });

  it("gives a playlist's tracks, skipping local files and episodes, plus Liked Songs", async () => {
    const { api, id } = await user('v-tracks');
    await connect(id, 'tok-playing');
    const first = await (await api('/api/spotify/playlists/pl1/tracks')).json();
    expect(first.items.map((t) => t.uri)).toEqual(['spotify:track:t1', 'spotify:track:t2']);
    expect(first).toMatchObject({ total: 3, next: true, offset: 0 });
    const more = await (await api('/api/spotify/playlists/pl1/tracks?offset=50')).json();
    expect(more.items.map((t) => t.uri)).toEqual(['spotify:track:t2']);
    expect(more.next).toBe(false);
    const liked = await (await api('/api/spotify/playlists/liked/tracks')).json();
    expect(liked.items[0].title).toBe('Clair de Lune, L. 32');
    expect((await api('/api/spotify/playlists/nope/tracks')).status).toBe(404);
    expect((await api('/api/spotify/playlists/bad%20id/tracks')).status).toBe(404);
  });

  it('shows the queue', async () => {
    const { api, id } = await user('v-queue');
    await connect(id, 'tok-playing');
    const b = await (await api('/api/spotify/queue')).json();
    expect(b.current.uri).toBe('spotify:track:t1');
    expect(b.queue.map((t) => t.uri)).toEqual(['spotify:track:t2', 'spotify:track:t1']);
  });

  it('adds to the queue, plays a track, a track in context, a context, and sets the volume', async () => {
    const { api, id } = await user('v-cmds');
    await connect(id, 'tok-playing');
    expect((await api('/api/spotify/queue', { method: 'POST', body: { uri: 'spotify:track:t2' } })).status).toBe(204);
    expect((await api('/api/spotify/play', { method: 'POST', body: { uri: 'spotify:track:t2' } })).status).toBe(204);
    expect((await api('/api/spotify/play', { method: 'POST', body: { uri: 'spotify:track:t2', contextUri: 'spotify:playlist:pl1' } })).status).toBe(204);
    expect((await api('/api/spotify/play', { method: 'POST', body: { contextUri: 'spotify:album:al1' } })).status).toBe(204);
    expect((await api('/api/spotify/volume', { method: 'PUT', body: { percent: 40 } })).status).toBe(204);
    expect((await api('/api/spotify/volume', { method: 'PUT', body: { percent: 0 } })).status).toBe(204);
  });

  it('refuses bad uris and volumes before asking Spotify', async () => {
    const { api, id } = await user('v-bad');
    await connect(id, 'tok-playing');
    const bad = async (path, method, body, field) => {
      const res = await api(path, { method, body });
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid', field });
    };
    await bad('/api/spotify/queue', 'POST', { uri: 'spotify:album:al1' }, 'uri');
    await bad('/api/spotify/queue', 'POST', { uri: 'https://evil' }, 'uri');
    await bad('/api/spotify/play', 'POST', {}, 'uri');
    await bad('/api/spotify/play', 'POST', { uri: 'spotify:playlist:pl1' }, 'uri');
    await bad('/api/spotify/play', 'POST', { contextUri: 'spotify:track:t1' }, 'contextUri');
    await bad('/api/spotify/volume', 'PUT', { percent: 101 }, 'percent');
    await bad('/api/spotify/volume', 'PUT', { percent: 1.5 }, 'percent');
    await bad('/api/spotify/volume', 'PUT', { percent: '50' }, 'percent');
  });

  it('explains no device on the view commands too, and needs a connection', async () => {
    const nodevice = await user('v-nodevice');
    await connect(nodevice.id, 'tok-nodevice');
    let res = await nodevice.api('/api/spotify/play', { method: 'POST', body: { uri: 'spotify:track:t1' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_device' });
    res = await nodevice.api('/api/spotify/volume', { method: 'PUT', body: { percent: 10 } });
    expect(res.status).toBe(404);
    const none = await user('v-none');
    expect((await none.api('/api/spotify/playlists')).status).toBe(409);
    expect((await none.api('/api/spotify/queue', { method: 'POST', body: { uri: 'spotify:track:t1' } })).status).toBe(409);
  });
});

describe('the poller', () => {
  it('polls fast while playing, slowly when idle, and stops when not connected', () => {
    expect(nextDelayMs({ connected: true, playing: true })).toBe(5000);
    expect(nextDelayMs({ connected: true, playing: false })).toBe(20000);
    expect(nextDelayMs({ connected: false })).toBeNull();
  });
});
