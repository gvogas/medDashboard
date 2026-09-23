import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from './helpers.js';
import { encryptToken, freshAccessToken } from '../worker/spotify.js';
import { saveSpotifyTokens, getSpotifyTokens, deleteSpotifyTokens } from '../worker/db.js';

async function connected(name, accessToken = 'tok-playing', refreshToken = 'ref-good', expiresAt = Date.now() + 3600000) {
  const api = await signIn(name);
  const id = 'u-' + name;
  await saveSpotifyTokens(env.DB, id, { accessToken, refreshToken: await encryptToken(env.SESSION_SECRET, refreshToken), expiresAt });
  return { api, id };
}

beforeEach(async () => { await env.DB.prepare("DELETE FROM request_limits WHERE key LIKE 'upstream:%'").run(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Spotify upstream failures', () => {
  it('shares upstream cooldowns between users while leaving token retrieval available', async () => {
    const first = await connected('cooldown-first', 'tok-busy');
    const second = await connected('cooldown-second');
    expect((await first.api('/api/spotify/player')).status).toBe(429);
    const blocked = await second.api('/api/spotify/player');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await (await second.api('/api/spotify/status')).json()).toEqual({ connected: true });
    const unconnected = await signIn('cooldown-unconnected');
    expect(await (await unconnected('/api/spotify/status')).json()).toEqual({ connected: false });
    expect((await second.api('/api/spotify/connect', { redirect: 'manual' })).headers.get('location')).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize\?/);
    expect((await second.api('/api/spotify/token')).status).toBe(200);
    expect((await second.api('/api/spotify', { method: 'DELETE' })).status).toBe(204);
    expect(await (await second.api('/api/spotify/status')).json()).toEqual({ connected: false });
  });

  it('forwards account-service throttling without deleting the connection', async () => {
    const { api, id } = await connected('accounts-busy', 'old', 'rate-limited', 0);
    const res = await api('/api/spotify/token');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('11');
    expect(await getSpotifyTokens(env.DB, id)).not.toBeNull();
  });

  it('does not turn player authorization or malformed responses into an idle player', async () => {
    const forbidden = await connected('player-forbidden', 'tok-noscope');
    const res = await forbidden.api('/api/spotify/player');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'reconnect_needed' });
    const malformed = await connected('player-malformed', 'tok-malformed');
    expect((await malformed.api('/api/spotify/player')).status).toBe(502);
  });

  it.each(['malformed', 'null-body'])('preserves stored credentials on token response %s', async (refreshToken) => {
    const { api, id } = await connected('token-' + refreshToken, 'old', refreshToken, 0);
    expect((await api('/api/spotify/token')).status).toBe(502);
    expect((await getSpotifyTokens(env.DB, id)).access_token).toBe('old');
  });

  it('times out a stalled token request and releases its refresh lease', async () => {
    const { id } = await connected('refresh-timeout', 'old', 'ref-good', 0);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = freshAccessToken(env, id).catch((error) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ status: 502 });
    expect((await getSpotifyTokens(env.DB, id)).access_token).toBe('old');
    expect(await env.DB.prepare('SELECT * FROM spotify_refresh_locks WHERE user_id = ?').bind(id).first()).toBeNull();
  });

  it('cannot resurrect a connection disconnected during a refresh', async () => {
    const { id } = await connected('refresh-disconnect', 'old', 'ref-good', 0);
    let finish;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const pending = freshAccessToken(env, id).catch((error) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await deleteSpotifyTokens(env.DB, id);
    finish(new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })));
    expect(await pending).toMatchObject({ status: 409 });
    expect(await getSpotifyTokens(env.DB, id)).toBeNull();
  });

  it('serializes simultaneous refreshes and reuses the refreshed token', async () => {
    const { id } = await connected('refresh-parallel', 'old', 'ref-good', 0);
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 }));
    }));
    const results = await Promise.all([freshAccessToken(env, id), freshAccessToken(env, id), freshAccessToken(env, id)]);
    expect(results.map((result) => result.token)).toEqual(['fresh', 'fresh', 'fresh']);
    expect(fetch).toHaveBeenCalledOnce();
    const lock = await env.DB.prepare('SELECT * FROM spotify_refresh_locks WHERE user_id = ?').bind(id).first();
    expect(lock).toBeNull();
  });

  it('cannot overwrite a newer connection with a delayed refresh', async () => {
    const { id } = await connected('refresh-reconnect', 'old', 'ref-good', 0);
    let finish;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const pending = freshAccessToken(env, id);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await saveSpotifyTokens(env.DB, id, { refreshToken: await encryptToken(env.SESSION_SECRET, 'new-account'), accessToken: 'new-account', expiresAt: Date.now() + 3600000 });
    finish(new Response(JSON.stringify({ access_token: 'old-account-refreshed', expires_in: 3600 })));
    expect((await pending).token).toBe('new-account');
    expect((await getSpotifyTokens(env.DB, id)).access_token).toBe('new-account');
  });

  it('reports the upstream offset before filtering unavailable playlist entries', async () => {
    const { api } = await connected('page-offset');
    const page = await (await api('/api/spotify/playlists/pl1/tracks')).json();
    expect(page.nextOffset).toBeGreaterThan(page.items.length);
  });
});

describe('OAuth account binding', () => {
  async function attempt(name) {
    const api = await signIn(name);
    const res = await api('/api/spotify/connect', { redirect: 'manual' });
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    return { api, state, cookie: res.headers.get('set-cookie').split(';')[0] };
  }

  it('rejects a callback after the browser switches accounts', async () => {
    const first = await attempt('oauth-first');
    const second = await signIn('oauth-second');
    const res = await second(`/api/spotify/callback?code=good&state=${first.state}`, {
      redirect: 'manual', headers: { cookie: `${second.cookie}; ${first.cookie}` },
    });
    expect(res.headers.get('location')).toContain('#spotify=error');
    expect(await getSpotifyTokens(env.DB, 'u-oauth-second')).toBeNull();
  });

  it('consumes a valid callback once, even if its cookie is replayed', async () => {
    const { api, state, cookie } = await attempt('oauth-once');
    const call = () => api(`/api/spotify/callback?code=good&state=${state}`, {
      redirect: 'manual', headers: { cookie: `${api.cookie}; ${cookie}` },
    });
    expect((await call()).headers.get('location')).toContain('#spotify=connected');
    expect((await call()).headers.get('location')).toContain('#spotify=error');
  });
});
