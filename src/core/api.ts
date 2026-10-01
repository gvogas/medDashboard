// The only file that knows the API's URLs. Same-origin, cookie session.

import type { Row } from './db.ts';
import type { Page, ServerProfile } from './store.ts';

/** An error's body as the Worker sends it: its code, and for some the server's copy or a wait. */
export interface ErrorBody { error?: string; retryAfter?: unknown; current?: Row | null; [field: string]: unknown }

export class ApiError extends Error {
  status: number;
  body: ErrorBody | null;
  retryAfter: number | null;
  constructor(status: number, body: ErrorBody | null, retryAfter: number | null = null) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;     /* seconds, from a 429 */
  }
}

/** How long to leave a failed request before trying it again by itself: what a rate
    limit asked for, else 30 s. */
export function retryDelayMs(e: unknown): number {
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
/** The current tab's retry deadline, also used by the Music page. */
export function spotifyRetryAt(): number { return spotifyBlockedUntil > Date.now() ? spotifyBlockedUntil : 0; }
const spotifyInFlight = new Map<string, ReturnType<typeof send>>();
let sessionRequests = new AbortController();
let accountId: string | null = null;
export function bindAccount(id: string | null): void {
  if (accountId !== id) resetRequests();
  accountId = id;
}

/** Cancel in-flight and queued calls before changing accounts. */
export function resetRequests(): void {
  sessionRequests.abort();
  sessionRequests = new AbortController();
  spotifyInFlight.clear();
  spotifyTail = Promise.resolve();
}

function spotifyRequest(method: string, path: string, body?: unknown) {
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
export function request(method: string, path: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal) {
  /* Account operations and the local connection check remain available during an API cooldown. */
  if (path.startsWith('/api/spotify/') && !['/api/spotify/token', '/api/spotify/status'].includes(path)) return spotifyRequest(method, path, body);
  return send(method, path, body, headers, signal);
}

/* The answer is JSON as the Worker sends it (typed `any`, as Response.json() is): each
   caller says what it expects, and the record and sync answers are checked here. */
async function send(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}, outer?: AbortSignal) {
  const session = sessionRequests.signal;
  const controller = new AbortController();
  const { signal } = controller;
  const abort = () => controller.abort(session.reason);
  /* the caller's own signal: Cancel on the reading card */
  const stop = () => controller.abort(outer!.reason);
  session.addEventListener('abort', abort, { once: true });
  outer?.addEventListener('abort', stop, { once: true });
  /* A file (a course outline) goes as it is, and reading it with AI can take a while. */
  const file = typeof Blob !== 'undefined' && body instanceof Blob;
  const timer = setTimeout(() => controller.abort(new DOMException('The request timed out. Try again.', 'TimeoutError')), file ? 120_000 : 30_000);
  try {
    session.throwIfAborted();
    outer?.throwIfAborted();
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
    outer?.removeEventListener('abort', stop);
  }
}

const match = (revision: number | undefined = 0) => ({ 'if-match': `"${revision}"` });
function invalidResponse() {
  const error = new ApiError(502, { error: 'invalid_response' });
  error.message = 'The server returned an invalid response. Your edits are still saved on this device.';
  return error;
}
const validRecord = (row: Row | null | undefined): row is Row => !!row && typeof row.id === 'string' && row.id.length > 0
  && Number.isSafeInteger(row.revision) && row.revision! > 0;
async function record<T = Row>(response: Promise<unknown>, id?: string | null, previousRevision: number | undefined = 0): Promise<T> {
  const row = await response as Row | null;
  if (!validRecord(row) || (id != null && row.id !== id) || row.revision! <= previousRevision) throw invalidResponse();
  return row as T;
}
async function empty(response: Promise<unknown>): Promise<null> {
  if (await response !== null) throw invalidResponse();
  return null;
}
async function changes(cursor: number): Promise<Page & { reset: boolean; more: boolean }> {
  const page = await request('GET', `/api/sync?v=2&cursor=${cursor}`);
  if (!page || typeof page.reset !== 'boolean' || typeof page.more !== 'boolean'
    || !Number.isSafeInteger(page.cursor) || page.cursor < 0 || !Array.isArray(page.changes)
    || !page.changes.every((change: { kind: string; row: Row } | null) => change && ['courses', 'items', 'quotes', 'study_sessions', 'achievements'].includes(change.kind) && validRecord(change.row))) throw invalidResponse();
  if (page.reset
    ? cursor === 0 || page.cursor !== 0 || page.more || page.changes.length > 0
    : page.cursor < cursor || (page.more && page.cursor === cursor)) throw invalidResponse();
  return page;
}

export const api = {
  me: () => record<ServerProfile & Row>(request('GET', '/api/me'), accountId),
  saveMe: (profile: Record<string, unknown> & { id?: string; revision?: number }) => record<ServerProfile & Row>(request('PUT', '/api/me', profile, match(profile.revision)), accountId || profile.id, profile.revision),
  login: (username: string, password: string) => record<ServerProfile & Row>(request('POST', '/api/login', { username, password })),
  signOut: () => empty(request('DELETE', '/api/session')),
  sync: changes,
  get: (kind: string, id: string) => record(request('GET', `/api/${kind}/${encodeURIComponent(id)}`), id),
  put: (kind: string, id: string, row: { revision?: number; [field: string]: unknown }) => record(request('PUT', `/api/${kind}/${encodeURIComponent(id)}`, row, match(row.revision)), id, row.revision),
  revokeAll: () => empty(request('POST', '/api/session/revoke-all')),
  del: (kind: string, id: string, revision = 0) => empty(request('DELETE', `/api/${kind}/${encodeURIComponent(id)}`, undefined, match(revision))),
  calendarFeed: () => request('GET', '/api/calendar'),
  calendarRenew: () => request('POST', '/api/calendar'),
  calendarStop: () => empty(request('DELETE', '/api/calendar')),
  leaderboard: (since: string | number) => request('GET', `/api/leaderboard?since=${since}`),
  leaderboardJoin: (joined: boolean) => empty(request('PUT', '/api/leaderboard', { joined })),
  readOutline: (file: Blob, { name, today, termStart }: { name: string; today: string; termStart?: string }, signal?: AbortSignal) =>
    request('POST', '/api/outline?' + new URLSearchParams({ name, today, ...(termStart ? { termStart } : {}) }), file, undefined, signal),
  readSchool: (file: Blob, { name, today }: { name: string; today: string }, signal?: AbortSignal) =>
    request('POST', '/api/school-calendar?' + new URLSearchParams({ name, today }), file, undefined, signal),
  readSchedule: (file: Blob, { name, today }: { name: string; today: string }, signal?: AbortSignal) =>
    request('POST', '/api/ai/schedule?' + new URLSearchParams({ name, today }), file, undefined, signal),
  aiReads: (): Promise<{ left: number; limit: number }> => request('GET', '/api/ai/reads'),
  spotifyPlayer: () => request('GET', '/api/spotify/player'),
  spotifyStatus: () => request('GET', '/api/spotify/status'),
  spotifyControl: (action: string, deviceId?: string | null) => request('POST', `/api/spotify/player/${action}` + (deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '')),
  spotifyToken: () => request('GET', '/api/spotify/token'),
  spotifyTransfer: (deviceId: string | null, play = true) => request('POST', '/api/spotify/transfer', { deviceId, play }),
  spotifyDevices: () => request('GET', '/api/spotify/devices'),
  spotifyShuffle: (state: boolean) => request('PUT', '/api/spotify/shuffle', { state }),
  spotifyRepeat: (state: string) => request('PUT', '/api/spotify/repeat', { state }),
  spotifyMe: () => request('GET', '/api/spotify/me'),
  spotifyRecent: () => request('GET', '/api/spotify/recent'),
  spotifyAlbumTracks: (id: string, offset = 0) => request('GET', `/api/spotify/albums/${encodeURIComponent(id)}/tracks?offset=${offset}`),
  spotifyArtistAlbums: (id: string, offset = 0) => request('GET', `/api/spotify/artists/${encodeURIComponent(id)}/albums?offset=${offset}`),
  spotifyDisconnect: () => request('DELETE', '/api/spotify'),
  spotifySearch: (q: string, type: string | null = null, offset: number | null = 0) => request('GET', `/api/spotify/search?q=${encodeURIComponent(q)}` + (type ? `&type=${type}&offset=${offset}` : '')),
  spotifyPlaylists: (offset = 0) => request('GET', `/api/spotify/playlists?offset=${offset}`),
  spotifyPlaylistTracks: (id: string, offset = 0) => request('GET', `/api/spotify/playlists/${encodeURIComponent(id)}/tracks?offset=${offset}`),
  spotifyQueue: () => request('GET', '/api/spotify/queue'),
  spotifyQueueAdd: (uri: string) => request('POST', '/api/spotify/queue', { uri }),
  spotifyPlay: (what: Record<string, unknown>) => request('POST', '/api/spotify/play', what),
  spotifyVolume: (percent: number | null) => request('PUT', '/api/spotify/volume', { percent }),
};
