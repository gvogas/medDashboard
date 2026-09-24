import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, signIn } from './helpers.js';

const protectedRoutes = [
  ['GET', '/api/me'], ['PUT', '/api/me'], ['GET', '/api/sync'],
  ['POST', '/api/session/revoke-all'],
  ...['courses', 'items', 'quotes'].flatMap((kind) => ['GET', 'PUT', 'DELETE'].map((method) => [method, `/api/${kind}/id`])),
  ...['connect', 'player', 'token', 'devices', 'me', 'recent', 'search', 'albums/id/tracks', 'artists/id/albums', 'playlists', 'playlists/id/tracks', 'queue'].map((path) => ['GET', `/api/spotify/${path}`]),
  ...['play', 'pause', 'next', 'previous', 'restart'].map((action) => ['POST', `/api/spotify/player/${action}`]),
  ...['transfer', 'queue', 'play'].map((path) => ['POST', `/api/spotify/${path}`]),
  ...['shuffle', 'repeat', 'volume'].map((path) => ['PUT', `/api/spotify/${path}`]),
  ['DELETE', '/api/spotify'],
];

describe('endpoint contract', () => {
  it.each(protectedRoutes)('%s %s requires authentication and cannot be cached', async (method, path) => {
    const res = await SELF.fetch(BASE + path, { method, redirect: 'manual' });
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('every known path rejects unsupported methods and advertises supported methods', async () => {
    const paths = new Set([...protectedRoutes.map(([, path]) => path), '/api/login', '/api/session', '/api/spotify/callback']);
    for (const path of paths) {
      const res = await SELF.fetch(BASE + path, { method: 'OPTIONS' });
      expect(res.status, path).toBe(405);
      expect(res.headers.get('allow'), path).toBeTruthy();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('blocks cross-origin requests to every write endpoint', async () => {
    for (const [method, path] of [...protectedRoutes, ['POST', '/api/login'], ['DELETE', '/api/session']].filter(([method]) => method !== 'GET')) {
      const res = await SELF.fetch(BASE + path, { method, headers: { origin: 'https://evil.example' } });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('keeps API roots and unknown routes out of the SPA fallback', async () => {
    for (const path of ['/api', '/api/', '/api/unknown']) {
      const res = await SELF.fetch(BASE + path);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('decodes row IDs once, preserving encoded identifiers across reads and writes', async () => {
    const api = await signIn();
    const path = '/api/quotes/' + encodeURIComponent('notes #1');
    const saved = await api(path, { method: 'PUT', body: { text: 'Study' } });
    expect(saved.status).toBe(200);
    expect((await saved.json()).id).toBe('notes #1');
    expect((await api(path)).status).toBe(200);
    expect((await api(path, { method: 'DELETE' })).status).toBe(204);
    expect((await api('/api/quotes/%ZZ')).status).toBe(400);
    expect((await api('/api/quotes/%00', { method: 'PUT', body: { text: 'Study' } })).status).toBe(400);
  });

  it('rejects unsafe sync cursors without reaching D1 with Infinity', async () => {
    const api = await signIn();
    for (const cursor of ['9'.repeat(400), '9007199254740992', '-1', '1.5']) {
      const res = await api('/api/sync?v=2&cursor=' + cursor);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid', field: 'cursor' });
    }
  });

  it('rejects arrays masquerading as Spotify URI strings', async () => {
    const api = await signIn();
    for (const [path, body] of [
      ['queue', { uri: ['spotify:track:t1'] }],
      ['play', { uri: ['spotify:track:t1'] }],
      ['play', { contextUri: ['spotify:album:al1'] }],
      ['play', { uris: [['spotify:track:t1']] }],
    ]) {
      expect((await api('/api/spotify/' + path, { method: 'POST', body })).status).toBe(400);
    }
    expect((await api('/api/spotify/search?q=study&offset=nope')).status).toBe(400);
  });

  it('rejects NUL text before SQLite can treat it as an empty string', async () => {
    const api = await signIn();
    const res = await api('/api/quotes/nul', { method: 'PUT', body: { text: '\0hidden' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'text' });
  });
});
