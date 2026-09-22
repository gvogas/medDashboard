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

/** Resolves to the parsed JSON (or null for 204). Throws ApiError on 4xx/5xx, TypeError offline. */
export async function request(method, path, body) {
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
  spotifyTransfer: (deviceId) => request('POST', '/api/spotify/transfer', { deviceId }),
  spotifyDisconnect: () => request('DELETE', '/api/spotify'),
  spotifySearch: (q) => request('GET', `/api/spotify/search?q=${encodeURIComponent(q)}`),
  spotifyPlaylists: (offset = 0) => request('GET', `/api/spotify/playlists?offset=${offset}`),
  spotifyPlaylistTracks: (id, offset = 0) => request('GET', `/api/spotify/playlists/${encodeURIComponent(id)}/tracks?offset=${offset}`),
  spotifyQueue: () => request('GET', '/api/spotify/queue'),
  spotifyQueueAdd: (uri) => request('POST', '/api/spotify/queue', { uri }),
  spotifyPlay: (what) => request('POST', '/api/spotify/play', what),
  spotifyVolume: (percent) => request('PUT', '/api/spotify/volume', { percent }),
};
