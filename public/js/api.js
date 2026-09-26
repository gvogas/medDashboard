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
  if (e instanceof ApiError && e.status === 429) {
    for (const value of [e.retryAfter, e.body?.retryAfter]) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
  }
  return 30000;
}

/* Spotify rate-limits the app as a whole, so every call to it goes through one gate:
   one request at a time, at least SPOTIFY_GAP_MS apart, the same GET shared while it
   is in flight, and nothing at all while a 429 has asked us to wait. */
export const SPOTIFY_GAP_MS = 1500;
let spotifyTail = Promise.resolve();
let spotifyLastAt = 0;
let spotifyBlockedUntil = 0;
/** The current tab's retry deadline, also used by the Spotify view. */
export function spotifyRetryAt() { return spotifyBlockedUntil > Date.now() ? spotifyBlockedUntil : 0; }
const spotifyInFlight = new Map();
let sessionRequests = new AbortController();
let accountId = null;
export function bindAccount(id) {
  if (accountId !== id) resetRequests();
  accountId = id;
}

/** Cancel in-flight and queued calls before changing accounts. */
export function resetRequests() {
  sessionRequests.abort();
  sessionRequests = new AbortController();
  spotifyInFlight.clear();
  spotifyTail = Promise.resolve();
}

function spotifyRequest(method, path, body) {
  const signal = sessionRequests.signal;
  const shared = method === 'GET' ? spotifyInFlight.get(path) : null;
  if (shared) return shared;
  const run = spotifyTail.then(async () => {
    signal.throwIfAborted();
    const wait = spotifyBlockedUntil - Date.now();
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      throw new ApiError(429, { error: 'rate_limited', retryAfter: secs }, secs);
    }
    const gap = spotifyLastAt + SPOTIFY_GAP_MS - Date.now();
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    signal.throwIfAborted();
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
    run.finally(() => { if (spotifyInFlight.get(path) === run) spotifyInFlight.delete(path); }).catch(() => {});
  }
  return run;
}

/** Resolves to JSON (or null for 204). Invalid replies never acknowledge a write. */
export function request(method, path, body, headers) {
  /* Account operations and the local connection check remain available during an API cooldown. */
  if (path.startsWith('/api/spotify/') && !['/api/spotify/token', '/api/spotify/status'].includes(path)) return spotifyRequest(method, path, body);
  return send(method, path, body, headers);
}

async function send(method, path, body, extraHeaders = {}) {
  const session = sessionRequests.signal;
  const controller = new AbortController();
  const { signal } = controller;
  const abort = () => controller.abort(session.reason);
  session.addEventListener('abort', abort, { once: true });
  /* A file (a course outline) goes as it is, and reading it with AI can take a while. */
  const file = typeof Blob !== 'undefined' && body instanceof Blob;
  const timer = setTimeout(() => controller.abort(new DOMException('The request timed out. Try again.', 'TimeoutError')), file ? 120_000 : 30_000);
  try {
    session.throwIfAborted();
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { ...(body !== undefined ? { 'content-type': file ? body.type || 'application/octet-stream' : 'application/json' } : {}), ...(accountId && path !== '/api/login' ? { 'x-rounds-user': accountId } : {}), ...extraHeaders },
      body: file ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    signal.throwIfAborted();
    // Reading the body shares the request's deadline, including error responses.
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    signal.throwIfAborted();
    if (!res.ok) throw new ApiError(res.status, data, Number(res.headers.get('retry-after')) || null);
    if (res.status !== 204 && (!data || typeof data !== 'object')) throw invalidResponse();
    return data;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    session.removeEventListener('abort', abort);
  }
}

const match = (revision = 0) => ({ 'if-match': `"${revision}"` });
function invalidResponse() {
  const error = new ApiError(502, { error: 'invalid_response' });
  error.message = 'The server returned an invalid response. Your edits are still saved on this device.';
  return error;
}
const validRecord = (row) => row && typeof row.id === 'string' && row.id.length > 0
  && Number.isSafeInteger(row.revision) && row.revision > 0;
async function record(response, id, previousRevision = 0) {
  const row = await response;
  if (!validRecord(row) || (id != null && row.id !== id) || row.revision <= previousRevision) throw invalidResponse();
  return row;
}
async function empty(response) {
  if (await response !== null) throw invalidResponse();
  return null;
}
async function changes(cursor) {
  const page = await request('GET', `/api/sync?v=2&cursor=${cursor}`);
  if (!page || typeof page.reset !== 'boolean' || typeof page.more !== 'boolean'
    || !Number.isSafeInteger(page.cursor) || page.cursor < 0 || !Array.isArray(page.changes)
    || !page.changes.every((change) => change && ['courses', 'items', 'quotes', 'study_sessions', 'achievements'].includes(change.kind) && validRecord(change.row))) throw invalidResponse();
  if (page.reset
    ? cursor === 0 || page.cursor !== 0 || page.more || page.changes.length > 0
    : page.cursor < cursor || (page.more && page.cursor === cursor)) throw invalidResponse();
  return page;
}

export const api = {
  me: () => record(request('GET', '/api/me'), accountId),
  saveMe: (profile) => record(request('PUT', '/api/me', profile, match(profile.revision)), accountId || profile.id, profile.revision),
  login: (username, password) => record(request('POST', '/api/login', { username, password })),
  signOut: () => empty(request('DELETE', '/api/session')),
  sync: changes,
  get: (kind, id) => record(request('GET', `/api/${kind}/${encodeURIComponent(id)}`), id),
  put: (kind, id, row) => record(request('PUT', `/api/${kind}/${encodeURIComponent(id)}`, row, match(row.revision)), id, row.revision),
  revokeAll: () => empty(request('POST', '/api/session/revoke-all')),
  del: (kind, id, revision = 0) => empty(request('DELETE', `/api/${kind}/${encodeURIComponent(id)}`, undefined, match(revision))),
  calendarFeed: () => request('GET', '/api/calendar'),
  calendarRenew: () => request('POST', '/api/calendar'),
  calendarStop: () => empty(request('DELETE', '/api/calendar')),
  leaderboard: (since) => request('GET', `/api/leaderboard?since=${since}`),
  leaderboardJoin: (joined) => empty(request('PUT', '/api/leaderboard', { joined })),
  readOutline: (file, { name, today, termStart }) => request('POST', '/api/outline?' + new URLSearchParams({ name, today, ...(termStart ? { termStart } : {}) }), file),
  readSchool: (file, { name, today }) => request('POST', '/api/school-calendar?' + new URLSearchParams({ name, today }), file),
  spotifyPlayer: () => request('GET', '/api/spotify/player'),
  spotifyStatus: () => request('GET', '/api/spotify/status'),
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
