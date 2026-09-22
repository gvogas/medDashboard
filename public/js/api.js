// The only file that knows the API's URLs. Same-origin, cookie session.

export class ApiError extends Error {
  constructor(status, body, retryAfter = null) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;     /* seconds, from a 429 */
  }
}

/** How long to leave a failed request before trying it again by itself: what a rate
    limit asked for, else 30 s. */
export function retryDelayMs(e) {
  const asked = e instanceof ApiError && e.status === 429 ? Number(e.body?.retryAfter) : 0;
  return (asked > 0 ? asked : 30) * 1000;
}

/* Spotify rate-limits the app as a whole, so every call to it goes through one gate:
   one request at a time, at least SPOTIFY_GAP_MS apart, the same GET shared while it
   is in flight, and nothing at all while a 429 has asked us to wait. */
export const SPOTIFY_GAP_MS = 1500;
let spotifyTail = Promise.resolve();
let spotifyLastAt = 0;
let spotifyBlockedUntil = 0;
const spotifyInFlight = new Map();

function spotifyRequest(method, path, body) {
  const shared = method === 'GET' ? spotifyInFlight.get(path) : null;
  if (shared) return shared;
  const run = spotifyTail.then(async () => {
    const wait = spotifyBlockedUntil - Date.now();
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      throw new ApiError(429, { error: 'rate_limited', retryAfter: secs }, secs);
    }
    const gap = spotifyLastAt + SPOTIFY_GAP_MS - Date.now();
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    spotifyLastAt = Date.now();
    try {
      return await send(method, path, body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) spotifyBlockedUntil = Date.now() + retryDelayMs(e);
      throw e;
    }
  });
  spotifyTail = run.catch(() => {});
  if (method === 'GET') {
    spotifyInFlight.set(path, run);
    run.finally(() => spotifyInFlight.delete(path)).catch(() => {});
  }
  return run;
}

/** Resolves to the parsed JSON (or null for 204). Throws ApiError on 4xx/5xx, TypeError offline. */
export function request(method, path, body) {
  /* the token comes from Spotify's accounts service, not its API: the Web Playback SDK must always get one */
  if (path.startsWith('/api/spotify') && path !== '/api/spotify/token') return spotifyRequest(method, path, body);
  return send(method, path, body);
}

async function send(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data, Number(res.headers.get('retry-after')) || null);
  return data;
}

export const api = {
  me: () => request('GET', '/api/me'),
  saveMe: (profile) => request('PUT', '/api/me', profile),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  signOut: () => request('DELETE', '/api/session'),
  sync: (since) => request('GET', `/api/sync?since=${since}`),
  get: (kind, id) => request('GET', `/api/${kind}/${encodeURIComponent(id)}`),
  put: (kind, id, row) => request('PUT', `/api/${kind}/${encodeURIComponent(id)}`, row),
  revokeAll: () => request('POST', '/api/session/revoke-all'),
  del: (kind, id) => request('DELETE', `/api/${kind}/${encodeURIComponent(id)}`),
  spotifyPlayer: () => request('GET', '/api/spotify/player'),
  spotifyControl: (action, deviceId) => request('POST', `/api/spotify/player/${action}` + (deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '')),
  spotifyToken: () => request('GET', '/api/spotify/token'),
  spotifyTransfer: (deviceId, play = true) => request('POST', '/api/spotify/transfer', { deviceId, play }),
  spotifyDevices: () => request('GET', '/api/spotify/devices'),
  spotifyShuffle: (state) => request('PUT', '/api/spotify/shuffle', { state }),
  spotifyRepeat: (state) => request('PUT', '/api/spotify/repeat', { state }),
  spotifyMe: () => request('GET', '/api/spotify/me'),
  spotifyRecent: () => request('GET', '/api/spotify/recent'),
  spotifyAlbumTracks: (id, offset = 0) => request('GET', `/api/spotify/albums/${encodeURIComponent(id)}/tracks?offset=${offset}`),
  spotifyArtistAlbums: (id, offset = 0) => request('GET', `/api/spotify/artists/${encodeURIComponent(id)}/albums?offset=${offset}`),
  spotifyDisconnect: () => request('DELETE', '/api/spotify'),
  spotifySearch: (q, type = null, offset = 0) => request('GET', `/api/spotify/search?q=${encodeURIComponent(q)}` + (type ? `&type=${type}&offset=${offset}` : '')),
  spotifyPlaylists: (offset = 0) => request('GET', `/api/spotify/playlists?offset=${offset}`),
  spotifyPlaylistTracks: (id, offset = 0) => request('GET', `/api/spotify/playlists/${encodeURIComponent(id)}/tracks?offset=${offset}`),
  spotifyQueue: () => request('GET', '/api/spotify/queue'),
  spotifyQueueAdd: (uri) => request('POST', '/api/spotify/queue', { uri }),
  spotifyPlay: (what) => request('POST', '/api/spotify/play', what),
  spotifyVolume: (percent) => request('PUT', '/api/spotify/volume', { percent }),
};
