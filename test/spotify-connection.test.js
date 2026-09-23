import { afterEach, describe, expect, it, vi } from 'vitest';

let spotify;
afterEach(() => { spotify?.stop(); vi.unstubAllGlobals(); });

describe('Spotify connection on startup', () => {
  it.each([true, false])('keeps saved connection=%s accurate while playback is throttled', async (connected) => {
    vi.resetModules();
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener() {} });
    vi.stubGlobal('window', { addEventListener() {} });
    vi.stubGlobal('navigator', { onLine: true });
    const fetcher = vi.fn(async (path) => path === '/api/spotify/status'
      ? new Response(JSON.stringify({ connected }))
      : new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 3600 }), { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    spotify = await import('../public/js/spotify.js');
    spotify.start();
    await vi.waitFor(() => {
      expect(spotify.state.loaded).toBe(true);
      expect(spotify.state.connected).toBe(connected);
      if (connected) expect(spotify.state.stale).toBe(true);
    });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(connected
      ? ['/api/spotify/status', '/api/spotify/player'] : ['/api/spotify/status']);
    const { renderSpotifyView } = await import('../public/js/views/spotify-view.js');
    const html = renderSpotifyView();
    expect(html).toContain(connected ? 'Try again after' : 'href="/api/spotify/connect"');
    expect(html).not.toContain('data-spotify="connect"');
  });
});
