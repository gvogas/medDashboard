// Drawing the Spotify view starts its loads; a load's redraw must not draw inside the
// draw and start the next load, or the two ping-pong until the stack overflows.
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('spotify view redraws', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('keeps the retry deadline visible and cached tracks intact throughout a long cooldown', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const fetcher = vi.fn(async (path) => path.includes('/playlists/pl1/tracks')
      ? new Response(JSON.stringify({ items: [], total: 0, next: null }))
      : new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 41233 }), {
        status: 429, headers: { 'retry-after': '41233' },
      }));
    vi.stubGlobal('fetch', fetcher);
    const { api, spotifyRetryAt } = await import('../src/legacy/js/api.js');
    const { state: player } = await import('../src/legacy/js/spotify.js');
    const view = await import('../src/legacy/js/views/spotify-view.js');
    Object.assign(player, { loaded: true, connected: true });

    view.openPlaylist('pl1', 'Study mix');
    await api.spotifyPlaylistTracks('pl1'); // share the view's in-flight load
    const blocked = api.spotifyQueue().catch((error) => error);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await blocked).status).toBe(429);
    const deadline = spotifyRetryAt();
    expect(deadline).toBeGreaterThan(Date.now());
    view.refresh('list');
    expect(view.renderSpotifyView()).toContain('Nothing in here yet.');

    view.openPlaylist('missing', 'Unavailable mix');
    await vi.advanceTimersByTimeAsync(6001); // the ordinary error toast has expired
    const html = view.renderSpotifyView();
    expect(html).toContain('Try again after');
    expect(html).toContain('Waiting for the Spotify request limit to reset.');
    expect(html).not.toContain('Asking Spotify');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(spotifyRetryAt()).toBe(deadline);
    vi.setSystemTime(deadline + 1);
    expect(spotifyRetryAt()).toBe(0);
  });

  it('draws the home pane without recursing, asking for each list once', async () => {
    const asked = [];
    vi.stubGlobal('fetch', async (path) => {
      asked.push(path);
      const body = path.includes('/me') && !path.includes('/me/') ? { id: 'u', name: 'U' } : { items: [], total: 0, next: null };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.resetModules();
    const { state: player } = await import('../src/legacy/js/spotify.js');
    const view = await import('../src/legacy/js/views/spotify-view.js');
    Object.assign(player, { loaded: true, connected: true });

    let draws = 0;
    view.onChange(() => { draws++; view.renderSpotifyView(); });
    expect(() => view.renderSpotifyView()).not.toThrow();
    await vi.waitFor(() => expect(asked.filter((p) => p.includes('/me')).length).toBe(1), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 200));

    const count = (part) => asked.filter((p) => p.startsWith(part)).length;
    expect(count('/api/spotify/playlists')).toBe(1);
    expect(count('/api/spotify/recent')).toBe(1);
    expect(draws).toBeLessThan(20);
  }, 15000);
});
