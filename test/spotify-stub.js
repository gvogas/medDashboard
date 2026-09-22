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

const CONTROLS = {
  'PUT /v1/me/player/play': true,
  'PUT /v1/me/player/pause': true,
  'POST /v1/me/player/next': true,
  'POST /v1/me/player/previous': true,
  'PUT /v1/me/player/seek?position_ms=0': true,
};

function player(request, url) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (tok === 'tok-expired') return json({ error: { status: 401, message: 'The access token expired' } }, 401);
  if (tok === 'tok-down') return new Response('Service Unavailable', { status: 503 });
  if (tok === 'tok-busy') return json({ error: { status: 429 } }, 429, { 'retry-after': '7' });

  if (url.pathname === '/v1/me/player') {
    if (request.method !== 'GET') return json({ error: { status: 405 } }, 405);
    if (tok === 'tok-paused') return json(PAUSED);
    if (tok === 'tok-idle') return new Response(null, { status: 204 });
    return json(PLAYING);   // tok-playing, tok-refreshed, tok-nodevice, tok-free
  }

  if (!CONTROLS[`${request.method} ${url.pathname}${url.search}`]) return json({ error: { status: 405, message: 'not a control' } }, 405);
  if (tok === 'tok-nodevice') return json({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }, 404);
  if (tok === 'tok-free') return json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, 403);
  return new Response(null, { status: 204 });
}

export async function spotifyStub(request) {
  const url = new URL(request.url);
  if (url.host === 'accounts.spotify.com' && url.pathname === '/api/token' && request.method === 'POST') return token(request);
  if (url.host === 'api.spotify.com') return player(request, url);
  return new Response('outbound fetch blocked in tests: ' + request.url, { status: 502 });
}
