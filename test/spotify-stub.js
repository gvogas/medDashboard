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
  shuffle_state: true,
  repeat_state: 'context',
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
    if (form.get('refresh_token') === 'rate-limited') return json({ error: 'slow_down' }, 429, { 'retry-after': '11' });
    if (form.get('refresh_token') === 'malformed') return json({ token_type: 'Bearer' });
    if (form.get('refresh_token') === 'null-body') return json(null);
    if (form.get('refresh_token') === 'revoked') return json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400);
    return json({ access_token: 'tok-refreshed', token_type: 'Bearer', expires_in: 3600 });
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

// Since February 2026 a playlist's count is under `items`, not `tracks`.
const PLAYLISTS = [
  { id: 'pl1', uri: 'spotify:playlist:pl1', name: 'Study mix', owner: { id: 'george', display_name: 'George' }, images: [{ url: 'https://i.scdn.co/image/pl1', width: 300 }], items: { total: 3 } },
  { id: 'pl2', uri: 'spotify:playlist:pl2', name: 'Ward rounds', owner: { id: 'sam', display_name: 'Sam' }, collaborative: true, images: [], items: { total: 0 } },
  // Enough more that the list needs a second page.
  ...[3, 4, 5, 6].map((n) => ({ id: `pl${n}`, uri: `spotify:playlist:pl${n}`, name: `Mix ${n}`, owner: { id: 'george', display_name: 'George' }, images: [], items: { total: 1 } })),
  // Someone else's: Spotify leaves `items` out, so how long it is is not known.
  { id: 'pl7', uri: 'spotify:playlist:pl7', name: 'Mix 7', owner: { id: 'sam', display_name: 'Sam' }, images: [] },
];

const uri = (item, id) => ({ ...item, uri: `spotify:track:${id}`, id, type: 'track' });
const T1 = uri(PLAYING.item, 't1');
const T2 = uri(PAUSED.item, 't2');

function isControl(method, pathname) {
  return (method === 'PUT' && ['/v1/me/player', '/v1/me/player/play', '/v1/me/player/pause', '/v1/me/player/seek', '/v1/me/player/volume', '/v1/me/player/shuffle', '/v1/me/player/repeat'].includes(pathname))
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
      if (tok === 'tok-noscope') return json({ error: { status: 403, message: 'Insufficient client scope' } }, 403);
      if (tok === 'tok-malformed') return new Response('invalid json');
      if (tok === 'tok-paused') return json(PAUSED);
      if (tok === 'tok-idle') return new Response(null, { status: 204 });
      return json(PLAYING);   // tok-playing, tok-refreshed, tok-nodevice, tok-free
    }
    if (path === '/v1/me/player/queue') return json({ currently_playing: T1, queue: [T2, T1] });
    if (path === '/v1/me/player/devices') {
      return json({ devices: [
        { id: 'roundsdev', name: 'Rounds', type: 'Computer', is_active: false, is_restricted: false },
        { id: 'phone1', name: "George's iPhone", type: 'Smartphone', is_active: true, is_restricted: false },
        { id: null, name: 'Ghost', type: 'Speaker' },
      ] });
    }
    if (path === '/v1/me') return json({ id: 'george', display_name: 'George' });
    if (path === '/v1/me/player/recently-played') {
      if (tok === 'tok-noscope') return json({ error: { status: 403, message: 'Insufficient client scope' } }, 403);
      return json({ items: [{ track: T2 }, { track: T1 }, { track: T2 }, { track: null }] });
    }
    if (path === '/v1/search') {
      const limit = Number(q.get('limit'));
      if (!q.get('q') || !q.get('type') || !(limit >= 1 && limit <= 10)) return json({ error: { status: 400, message: 'Invalid limit' } }, 400);
      const hit = q.get('q').toLowerCase() === 'weightless', types = q.get('type').split(','), offset = Number(q.get('offset') || 0);
      const kind = (t, items, next = null) => (types.includes(t) ? { [t + 's']: { items: hit ? items : [], next: hit ? next : null } } : {});
      return json({
        ...kind('track', offset ? [T2] : [T1], offset ? null : 'more'),
        ...kind('artist', [{ id: 'ar1', uri: 'spotify:artist:ar1', name: 'Marconi Union', images: album('mu').images }]),
        ...kind('album', [{ id: 'al1', uri: 'spotify:album:al1', name: 'Weightless', artists: artists('Marconi Union'), images: album('weightless').images, total_tracks: 6 }]),
        ...kind('playlist', [PLAYLISTS[0], null]),
      });
    }
    const al = path.match(/^\/v1\/albums\/([^/]+)\/tracks$/);
    if (al) {
      if (al[1] !== 'al1') return json({ error: { status: 404, message: 'Not found' } }, 404);
      const { album: _, ...bare } = T1;   /* Spotify leaves the album off an album's tracks */
      return json({ items: [bare, { ...bare, is_local: true }], total: 1, next: null });
    }
    const ar = path.match(/^\/v1\/artists\/([^/]+)\/albums$/);
    if (ar) {
      if (ar[1] !== 'ar1') return json({ error: { status: 404, message: 'Not found' } }, 404);
      if (Number(q.get('limit')) > 10) return json({ error: { status: 400, message: 'Invalid limit' } }, 400);
      return json({ items: [{ id: 'al1', uri: 'spotify:album:al1', name: 'Weightless', artists: artists('Marconi Union'), images: [], total_tracks: 6 }], total: 1, next: null });
    }
    if (path === '/v1/me/playlists') {
      const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit') || 20);
      const items = PLAYLISTS.slice(offset, offset + limit);
      return json({ items, total: PLAYLISTS.length, next: offset + limit < PLAYLISTS.length ? 'more' : null });
    }
    if (path === '/v1/me/tracks') {
      // A token granted before user-library-read was asked for.
      if (tok === 'tok-noscope') return json({ error: { status: 403, message: 'Insufficient client scope' } }, 403);
      return json({ items: [{ track: T2 }], total: 1, next: null });
    }
    // February 2026: /playlists/{id}/tracks is gone; /items answers, each entry's track
    // under `item` (`track` is kept, deprecated), and in development mode only for
    // playlists the user owns or collaborates on.
    const m = path.match(/^\/v1\/playlists\/([^/]+)\/items$/);
    if (m) {
      if (m[1] === 'plx') return json({ error: { status: 403, message: 'Forbidden' } }, 403);
      if (m[1] !== 'pl1') return json({ error: { status: 404, message: 'Not found' } }, 404);
      const offset = Number(q.get('offset') || 0);
      if (offset > 0) return json({ items: [{ item: T2, is_local: false }], total: 3, next: null });
      return json({
        items: [
          { item: T1, is_local: false }, { item: null, is_local: false }, { item: { ...T2, type: 'episode' }, is_local: false },
          { item: { ...T2 }, is_local: true }, { item: T2, is_local: false },
        ],
        total: 3, next: 'more',
      });
    }
    return json({ error: { status: 404, message: 'unknown route' } }, 404);
  }

  if (!isControl(method, path)) return json({ error: { status: 405, message: 'not a control' } }, 405);
  if (tok === 'tok-free') return json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, 403);
  // Premium, but the command makes no sense right now (pausing what is already paused).
  if (tok === 'tok-restricted') return json({ error: { status: 403, message: 'Player command failed: Restriction violated', reason: 'UNKNOWN' } }, 403);
  /* Commands know one device by id, `roundsdev`, which works even with nothing active; transfer also knows `phone1`. */
  const unknownDevice = () => json({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }, 404);
  if (path === '/v1/me/player') {
    const body = JSON.parse((await request.text()) || '{}');
    if (!Array.isArray(body.device_ids) || body.device_ids.length !== 1 || typeof body.play !== 'boolean') return json({ error: { status: 400, message: 'bad transfer body' } }, 400);
    return ['roundsdev', 'phone1'].includes(body.device_ids[0]) ? new Response(null, { status: 204 }) : unknownDevice();
  }
  const device = q.get('device_id');
  if (device !== null && device !== 'roundsdev') return unknownDevice();
  if (tok === 'tok-nodevice' && device === null) return unknownDevice();
  if (path === '/v1/me/player/seek' && q.get('position_ms') !== '0') return json({ error: { status: 400 } }, 400);
  if (path === '/v1/me/player/shuffle' && !['true', 'false'].includes(q.get('state'))) return json({ error: { status: 400 } }, 400);
  if (path === '/v1/me/player/repeat' && !['off', 'context', 'track'].includes(q.get('state'))) return json({ error: { status: 400 } }, 400);
  if (path === '/v1/me/player/volume') {
    const v = Number(q.get('volume_percent'));
    if (!Number.isInteger(v) || v < 0 || v > 100) return json({ error: { status: 400, message: 'bad volume' } }, 400);
  }
  if (path === '/v1/me/player/queue' && !/^spotify:(track|episode):/.test(q.get('uri') || '')) return json({ error: { status: 400, message: 'bad uri' } }, 400);
  if (path === '/v1/me/player/play') {
    const text = await request.text();
    if (text) {
      const body = JSON.parse(text);
      const ok = (Array.isArray(body.uris) && body.uris.length >= 1 && !body.context_uri && (!body.offset || body.uris.includes(body.offset.uri)))
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
