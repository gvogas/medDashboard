// A fake Spotify for the tests. The Worker's outbound fetches land here (see
// vitest.config.js). Behaviour is chosen by the bearer token or the posted code, so a
// test picks its case by what it seeds. Any other host is refused: tests never touch
// the network.

const BASIC = 'Basic ' + btoa('test-client:test-secret');

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const track = (playing) => ({
  is_playing: playing,
  progress_ms: 42000,
  currently_playing_type: 'track',
  device: { name: 'Laptop', is_active: true },
  item: {
    name: 'Everlong',
    duration_ms: 250000,
    artists: [{ name: 'Foo Fighters' }],
    album: {
      name: 'The Colour and the Shape',
      images: [
        { url: 'https://i.scdn.co/image/640', width: 640, height: 640 },
        { url: 'https://i.scdn.co/image/300', width: 300, height: 300 },
        { url: 'https://i.scdn.co/image/64', width: 64, height: 64 },
      ],
    },
    external_urls: { spotify: 'https://open.spotify.com/track/abc' },
  },
});

// A control sent with the wrong method or path gets a 405, so a mismapping fails.
const CONTROLS = new Set([
  'PUT /v1/me/player/play', 'PUT /v1/me/player/pause', 'POST /v1/me/player/next',
  'POST /v1/me/player/previous', 'PUT /v1/me/player/seek',
]);

async function accounts(request, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/token') return new Response('not found', { status: 404 });
  if (request.headers.get('authorization') !== BASIC) return json({ error: 'invalid_client' }, 401);
  const form = new URLSearchParams(await request.text());
  if (form.get('grant_type') === 'authorization_code') {
    if (form.get('code') !== 'good') return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: 'tok-playing', refresh_token: 'refresh-good', expires_in: 3600, token_type: 'Bearer' });
  }
  if (form.get('grant_type') === 'refresh_token') {
    if (form.get('refresh_token') === 'revoked') return json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400);
    return json({ access_token: 'tok-refreshed', expires_in: 3600, token_type: 'Bearer' });
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

function webApi(request, url) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (token === 'tok-expired') return json({ error: { status: 401, message: 'The access token expired' } }, 401);
  if (token === 'tok-down') return new Response('unavailable', { status: 503 });
  if (token === 'tok-limited') return new Response(null, { status: 429, headers: { 'retry-after': '7' } });
  if (request.method === 'GET' && url.pathname === '/v1/me/player') {
    if (token === 'tok-idle') return new Response(null, { status: 204 });
    return json(track(token !== 'tok-paused'));
  }
  const route = `${request.method} ${url.pathname}`;
  if (!CONTROLS.has(route)) return new Response('wrong method or path: ' + route, { status: 405 });
  if (url.pathname.endsWith('/seek') && url.searchParams.get('position_ms') !== '0') return new Response('bad seek', { status: 400 });
  if (token === 'tok-nodevice') return json({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }, 404);
  if (token === 'tok-free') return json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, 403);
  return new Response(null, { status: 204 });
}

export async function spotifyStub(request) {
  const url = new URL(request.url);
  if (url.host === 'accounts.spotify.com') return accounts(request, url);
  if (url.host === 'api.spotify.com') return webApi(request, url);
  return new Response('outbound fetch blocked in tests: ' + request.url, { status: 502 });
}
