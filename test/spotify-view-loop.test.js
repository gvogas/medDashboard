// Drawing the Spotify view starts its loads; a load's redraw must not draw inside the
// draw and start the next load, or the two ping-pong until the stack overflows.
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('spotify view redraws', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws the home pane without recursing, asking for each list once', async () => {
    const asked = [];
    vi.stubGlobal('fetch', async (path) => {
      asked.push(path);
      const body = path.includes('/me') && !path.includes('/me/') ? { id: 'u', name: 'U' } : { items: [], total: 0, next: null };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.resetModules();
    const { state: player } = await import('../public/js/spotify.js');
    const view = await import('../public/js/views/spotify-view.js');
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
