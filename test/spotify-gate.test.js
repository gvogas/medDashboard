// The browser's gate in front of /api/spotify: spaced out, shared, and silent after a 429.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let calls;
function stubFetch(answer = (path) => new Response(JSON.stringify(path === '/api/me' ? { id: 'u1', revision: 1 } : {}))) {
  calls = [];
  vi.stubGlobal('fetch', async (path) => { calls.push({ path, at: Date.now() }); return answer(path); });
}

async function freshApi() {
  vi.resetModules();
  return import('../public/js/api.js');
}

describe('spotify request gate', () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('sends one Spotify request at a time, at least SPOTIFY_GAP_MS apart', async () => {
    const { api, SPOTIFY_GAP_MS } = await freshApi();
    await Promise.all([api.spotifyPlayer(), api.spotifyQueue(), api.spotifyPlaylists(0)]);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(SPOTIFY_GAP_MS - 20);
  }, 10000);

  it('shares one GET among callers while it is in flight', async () => {
    const { api } = await freshApi();
    await Promise.all([api.spotifyPlayer(), api.spotifyPlayer(), api.spotifyPlayer()]);
    expect(calls).toHaveLength(1);
  });

  it('after a 429 sends nothing more to Spotify until Retry-After has passed', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 60 }), { status: 429, headers: { 'retry-after': '60' } }));
    const { api, ApiError } = await freshApi();
    await expect(api.spotifyPlayer()).rejects.toBeInstanceOf(ApiError);
    const blocked = await api.spotifyQueue().catch((e) => e);
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfter).toBeGreaterThan(55);
    expect(calls).toHaveLength(1);
  });

  it('leaves the rest of the API and the SDK token alone', async () => {
    const { api } = await freshApi();
    const t0 = Date.now();
    await Promise.all([api.spotifyToken(), api.spotifyToken(), api.me()]);
    expect(calls).toHaveLength(3);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('can check and disconnect a saved connection during the browser cooldown', async () => {
    stubFetch((path) => path === '/api/spotify/player'
      ? new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 3600 }), { status: 429 })
      : new Response(JSON.stringify({ connected: true })));
    const { api } = await freshApi();
    await expect(api.spotifyPlayer()).rejects.toMatchObject({ status: 429 });
    expect(await api.spotifyStatus()).toEqual({ connected: true });
    await api.spotifyDisconnect();
    expect(calls.map((call) => call.path)).toEqual(['/api/spotify/player', '/api/spotify/status', '/api/spotify']);
  });

  it('cancels queued requests before another account can inherit them', async () => {
    let finish;
    stubFetch(() => new Promise((resolve) => { finish = resolve; }));
    const { api, resetRequests } = await freshApi();
    const first = api.spotifyPlayer().catch((error) => error);
    const queued = api.spotifyControl('next').catch((error) => error);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    resetRequests();
    finish(new Response('{}'));
    expect((await first).name).toBe('AbortError');
    expect((await queued).name).toBe('AbortError');
    expect(calls).toHaveLength(1);
  });
});
