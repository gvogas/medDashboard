// A fake Spotify for the tests. vitest.config.js routes every outbound fetch from the
// Worker here. accounts.spotify.com answers by the grant; api.spotify.com answers by
// the bearer token, so a test picks Spotify's behaviour by the token it seeds.

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const artists = (...names) => names.map((name) => ({ name }));
const album = (name) => ({
  name,
  images: [
    { url: `https://i.scdn.co/image/${name}-640`, width: 640, height: 640 },
    { url: `https://i.scdn.co/image/${name}-300`, width: 300, height: 300 },
    { url: `https://i.scdn.co/image/${name}-64`, width: 64, height: 64 },
  ],
});

export const PLAYING = {
  is_playing: true,
  progress_ms: 186000,
  device: { name: "George's MacBook" },
  item: {
    name: 'Weightless',
    artists: artists('Marconi Union'),
    album: album('weightless'),
    external_urls: { spotify: 'https://open.spotify.com/track/weightless' },
    duration_ms: 489000,
  },
};

export const PAUSED = {
  ...PLAYING,
  is_playing: false,
  progress_ms: 221000,
  item: { ...PLAYING.item, name: 'Clair de Lune, L. 32', artists: artists('Claude Debussy', 'Lang Lang'), album: album('piano-book'), duration_ms: 312000 },
};

async function token(request) {
  if (!/^Basic /.test(request.headers.get('authorization') || '')) return json({ error: 'invalid_client' }, 401);
  const form = new URLSearchParams(await request.text());
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    if (form.get('code') !== 'good') return json({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400);
    return json({ access_token: 'tok-playing', refresh_token: 'ref-good', token_type: 'Bearer', expires_in: 3600, scope: 'user-read-playback-state user-modify-playback-state' });
  }
  if (grant === 'refresh_token') {
    if (form.get('refresh_token') === 'revoked') return json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400);
    return json({ access_token: 'tok-refreshed', token_type: 'Bearer', expires_in: 3600 });
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

const PLAYLISTS = [
  { id: 'pl1', uri: 'spotify:playlist:pl1', name: 'Study mix', owner: { display_name: 'George' }, images: [{ url: 'https://i.scdn.co/image/pl1', width: 300 }], tracks: { total: 3 } },
  { id: 'pl2', uri: 'spotify:playlist:pl2', name: 'Ward rounds', owner: { display_name: 'Sam' }, images: [], tracks: { total: 0 } },
];

const uri = (item, id) => ({ ...item, uri: `spotify:track:${id}`, id, type: 'track' });
const T1 = uri(PLAYING.item, 't1');
const T2 = uri(PAUSED.item, 't2');

function isControl(method, pathname) {
  return (method === 'PUT' && ['/v1/me/player', '/v1/me/player/play', '/v1/me/player/pause', '/v1/me/player/seek', '/v1/me/player/volume'].includes(pathname))
    || (method === 'POST' && ['/v1/me/player/next', '/v1/me/player/previous', '/v1/me/player/queue'].includes(pathname));
}

async function player(request, url) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (tok === 'tok-expired') return json({ error: { status: 401, message: 'The access token expired' } }, 401);
  if (tok === 'tok-down') return new Response('Service Unavailable', { status: 503 });
  if (tok === 'tok-busy') return json({ error: { status: 429 } }, 429, { 'retry-after': '7' });
  const { method } = request, path = url.pathname, q = url.searchParams;

  if (method === 'GET') {
    if (path === '/v1/me/player') {
      if (tok === 'tok-paused') return json(PAUSED);
      if (tok === 'tok-idle') return new Response(null, { status: 204 });
      return json(PLAYING);   // tok-playing, tok-refreshed, tok-nodevice, tok-free
    }
    if (path === '/v1/me/player/queue') return json({ currently_playing: T1, queue: [T2, T1] });
    if (path === '/v1/search') {
      if (!q.get('q') || !q.get('type')) return json({ error: { status: 400 } }, 400);
      const hit = q.get('q').toLowerCase() === 'weightless';
      return json({
        tracks: { items: hit ? [T1] : [] },
        albums: { items: hit ? [{ id: 'al1', uri: 'spotify:album:al1', name: 'Weightless', artists: artists('Marconi Union'), images: album('weightless').images, total_tracks: 6 }] : [] },
        playlists: { items: hit ? [PLAYLISTS[0], null] : [] },
      });
    }
    if (path === '/v1/me/playlists') {
      const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit') || 20);
      const items = PLAYLISTS.slice(offset, offset + limit);
      return json({ items, total: PLAYLISTS.length, next: offset + limit < PLAYLISTS.length ? 'more' : null });
    }
    if (path === '/v1/me/tracks') return json({ items: [{ track: T2 }], total: 1, next: null });
    const m = path.match(/^\/v1\/playlists\/([^/]+)\/tracks$/);
    if (m) {
      if (m[1] !== 'pl1') return json({ error: { status: 404, message: 'Not found' } }, 404);
      const offset = Number(q.get('offset') || 0);
      if (offset > 0) return json({ items: [{ track: T2 }], total: 3, next: null });
      return json({ items: [{ track: T1 }, { track: null }, { track: { ...T2, type: 'episode' } }, { track: { ...T2, is_local: true } }, { track: T2 }], total: 3, next: 'more' });
    }
    return json({ error: { status: 404, message: 'unknown route' } }, 404);
  }

  if (!isControl(method, path)) return json({ error: { status: 405, message: 'not a control' } }, 405);
  if (tok === 'tok-free') return json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, 403);
  /* The only device Spotify knows by id is `roundsdev`; naming it works even with nothing active. */
  const unknownDevice = () => json({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }, 404);
  if (path === '/v1/me/player') {
    const body = JSON.parse((await request.text()) || '{}');
    if (!Array.isArray(body.device_ids) || body.device_ids.length !== 1 || body.play !== true) return json({ error: { status: 400, message: 'bad transfer body' } }, 400);
    return body.device_ids[0] === 'roundsdev' ? new Response(null, { status: 204 }) : unknownDevice();
  }
  const device = q.get('device_id');
  if (device !== null && device !== 'roundsdev') return unknownDevice();
  if (tok === 'tok-nodevice' && device === null) return unknownDevice();
  if (path === '/v1/me/player/seek' && q.get('position_ms') !== '0') return json({ error: { status: 400 } }, 400);
  if (path === '/v1/me/player/volume') {
    const v = Number(q.get('volume_percent'));
    if (!Number.isInteger(v) || v < 0 || v > 100) return json({ error: { status: 400, message: 'bad volume' } }, 400);
  }
  if (path === '/v1/me/player/queue' && !/^spotify:(track|episode):/.test(q.get('uri') || '')) return json({ error: { status: 400, message: 'bad uri' } }, 400);
  if (path === '/v1/me/player/play') {
    const text = await request.text();
    if (text) {
      const body = JSON.parse(text);
      const ok = (Array.isArray(body.uris) && body.uris.length === 1 && !body.context_uri)
        || (typeof body.context_uri === 'string' && !body.uris && (!body.offset || typeof body.offset.uri === 'string'));
      if (!ok) return json({ error: { status: 400, message: 'bad play body' } }, 400);
    }
  }
  return new Response(null, { status: 204 });
}

export async function spotifyStub(request) {
  const url = new URL(request.url);
  if (url.host === 'accounts.spotify.com' && url.pathname === '/api/token' && request.method === 'POST') return token(request);
  if (url.host === 'api.spotify.com') return player(request, url);
  return new Response('outbound fetch blocked in tests: ' + request.url, { status: 502 });
}
