// The only file that knows the API's URLs. Same-origin, cookie session.

import type { Row } from './db.ts';
import { UNREAD_CAP } from './shared.ts';
import type { Cursor, Page, ServerProfile } from './store.ts';
import type { ActivityRow, Inbox, JoinCode, Space, SpaceDetails, SpaceInvite, SpaceSummary } from './types.ts';

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
/** A v3 page (spec §6): changes across your own scope and your spaces', a cursor per scope. */
export interface PageV3 extends Page { cursors: Record<string, Cursor>; scopes: Space[]; more: boolean; reset: string[]; revoked: string[]; unread?: number }
const SCOPE = /^(u:[^,]+|[cp]:[a-z0-9]{12})$/;
/* a v3 page's kinds; marks and space prefs only ever in your own scope (checked below) */
const KINDS = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'marks', 'space_prefs'];
const scopeList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string' && SCOPE.test(s));
/* A cursor's sequence: a plain one, or a resync's `r<seq>.<floor>`; NaN when malformed. */
const RESYNC = /^r(\d{1,16})\.\d{1,16}$/;
function cursorSeq(c: unknown): number {
  const n = typeof c === 'number' ? c : typeof c === 'string' && RESYNC.test(c) ? Number(RESYNC.exec(c)![1]) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
}
async function changesV3(cursors: Record<string, Cursor>, sv: number): Promise<PageV3> {
  const list = Object.entries(cursors).map(([scope, seq]) => `${scope}:${seq}`).join(',');
  const page = await request('GET', `/api/sync?v=3&cursors=${encodeURIComponent(list)}&sv=${sv}`);
  const valid = !!page && typeof page.more === 'boolean' && scopeList(page.reset) && scopeList(page.revoked)
    && !!page.cursors && typeof page.cursors === 'object'
    && Object.entries(page.cursors).every(([s, n]) => SCOPE.test(s) && !Number.isNaN(cursorSeq(n)))
    && Array.isArray(page.scopes) && page.scopes.every((s: Space | null) => !!s && typeof s.id === 'string' && SCOPE.test(s.scope) && Number.isSafeInteger(s.revision))
    && Array.isArray(page.changes) && page.changes.every((c: { scope?: unknown; kind?: unknown; row?: Row } | null) =>
      !!c && typeof c.scope === 'string' && SCOPE.test(c.scope) && KINDS.includes(c.kind as string)
      && (c.scope.startsWith('u:') || c.kind === 'courses' || c.kind === 'items') && validRecord(c.row));
  if (!valid) throw invalidResponse();
  /* the inbox's count (spec §12): one unreadable value must not fail a whole sync page */
  if (!(Number.isSafeInteger(page.unread) && page.unread >= 0 && page.unread <= UNREAD_CAP)) delete page.unread;
  /* a cursor never moves back, except to 0 for a scope that reset */
  for (const [scope, cursor] of Object.entries(page.cursors as Record<string, Cursor>)) {
    if (cursorSeq(cursor) < (cursorSeq(cursors[scope] ?? 0) || 0) && !page.reset.includes(scope)) throw invalidResponse();
  }
  return page;
}
/* A shared row's URL: the space id is the scope without its 'c:' or 'p:'. */
const sharedPath = (scope: string, kind: string, id: string) => `/api/spaces/${scope.slice(2)}/${kind}/${encodeURIComponent(id)}`;
/* A personal row's URL. A mark's id is '<space id>:<item id>', and its route /api/marks/<space>/<item> (spec §14). */
function rowPath(kind: string, id: string): string {
  if (kind !== 'marks') return `/api/${kind}/${encodeURIComponent(id)}`;
  const at = id.indexOf(':');
  return `/api/marks/${id.slice(0, at)}/${encodeURIComponent(id.slice(at + 1))}`;
}

/* The class routes answer a space as {space}: its id is the Worker's and its scope matches its kind. */
async function spaceOf(response: Promise<unknown>): Promise<SpaceSummary> {
  const space = (await response as { space?: SpaceSummary } | null)?.space;
  if (!space || typeof space.id !== 'string' || !/^[a-z0-9]{12}$/.test(space.id) || space.scope !== `${space.kind === 'project' ? 'p' : 'c'}:${space.id}`) throw invalidResponse();
  return space;
}

/* A read's query: only the values given, in the order given. */
const query = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString()
type ReadQuery = { name: string; today: string; termStart?: string; terms?: string; codes?: string }

export const api = {
  me: () => record<ServerProfile & Row>(request('GET', '/api/me'), accountId),
  saveMe: (profile: Record<string, unknown> & { id?: string; revision?: number }) => record<ServerProfile & Row>(request('PUT', '/api/me', profile, match(profile.revision)), accountId || profile.id, profile.revision),
  login: (username: string, password: string) => record<ServerProfile & Row>(request('POST', '/api/login', { username, password })),
  signOut: () => empty(request('DELETE', '/api/session')),
  sync: changes,
  syncV3: changesV3,
  /* a class's or a project's course or item; `changed` is {field: value before} (spec §6 Push) */
  shared: {
    get: (scope: string, kind: string, id: string) => record(request('GET', sharedPath(scope, kind, id)), id),
    put: (scope: string, kind: string, id: string, row: { revision?: number; [field: string]: unknown }, changed?: Record<string, unknown>) =>
      record(request('PUT', sharedPath(scope, kind, id), changed ? { ...row, changed } : row, match(row.revision)), id, row.revision),
    del: (scope: string, kind: string, id: string, revision = 0) => empty(request('DELETE', sharedPath(scope, kind, id), undefined, match(revision))),
  },
  /* shared classes; `sid` is a space id */
  spaces: {
    create: (body: { kind: 'class'; course?: Record<string, unknown>; convertCourseId?: string; items?: string[] }) => spaceOf(request('POST', '/api/spaces', body)),
    get: (sid: string): Promise<SpaceDetails> => request('GET', `/api/spaces/${sid}`),
    invite: (sid: string, username: string, role?: string): Promise<SpaceInvite> => request('POST', `/api/spaces/${sid}/invites`, role ? { username, role } : { username }),
    revokeInvite: (sid: string, userId: string) => empty(request('DELETE', `/api/spaces/${sid}/invites/${encodeURIComponent(userId)}`)),
    setRole: (sid: string, userId: string, role: string) => request('PUT', `/api/spaces/${sid}/members/${encodeURIComponent(userId)}`, { role }),
    transfer: (sid: string, userId: string) => empty(request('POST', `/api/spaces/${sid}/transfer`, { userId })),
    makeCode: (sid: string): Promise<JoinCode> => request('POST', `/api/spaces/${sid}/code`),
    dropCode: (sid: string) => empty(request('DELETE', `/api/spaces/${sid}/code`)),
    /* merge a course of yours into the class (spec §13): pairs are [your item's id, the class's item's id] */
    absorb: (sid: string, body: { courseId: string; pairs: [string, string][]; fromCourse: boolean }): Promise<{ paired: number; filed: number }> =>
      request('POST', `/api/spaces/${sid}/absorb`, body),
    /* Stage 5 (spec §13): leaving, removing, archiving, deleting; Keep as mine; sharing one item */
    leave: (sid: string, keepCopy: boolean) => empty(request('POST', `/api/spaces/${sid}/leave`, { keepCopy })),
    remove: (sid: string, userId: string) => empty(request('DELETE', `/api/spaces/${sid}/members/${encodeURIComponent(userId)}`)),
    archive: (sid: string, archived: boolean) => empty(request('POST', `/api/spaces/${sid}/archive`, { archived })),
    del: (sid: string, keepCopy: boolean) => empty(request('DELETE', `/api/spaces/${sid}`, { keepCopy })),
    keep: (sid: string, itemId: string) => empty(request('POST', `/api/spaces/${sid}/items/${encodeURIComponent(itemId)}/keep`)),
    share: (sid: string, items: string[]): Promise<{ shared: number }> => request('POST', `/api/spaces/${sid}/absorb`, { items }),
    /* the owner shares their school calendar with the class again (spec §8) */
    school: (sid: string): Promise<{ schoolCalendar: unknown | null }> => request('POST', `/api/spaces/${sid}/school`),
    /* Stage 7 (spec §12): a page of the space's Activity tab, below `before` */
    activity: (sid: string, before?: number): Promise<{ items: ActivityRow[]; more: boolean }> =>
      request('GET', `/api/spaces/${sid}/activity` + (before ? `?before=${before}` : '')),
  },
  /* your invites and what others did that concerns you (spec §12) */
  inbox: {
    get: (): Promise<Inbox> => request('GET', '/api/inbox'),
    seen: (seq: number) => empty(request('PUT', '/api/inbox/seen', { seq })),
  },
  invites: {
    accept: (sid: string) => spaceOf(request('POST', `/api/invites/${sid}/accept`)),
    decline: (sid: string) => empty(request('POST', `/api/invites/${sid}/decline`)),
  },
  join: (code: string) => spaceOf(request('POST', '/api/join', { code })),
  get: (kind: string, id: string) => record(request('GET', rowPath(kind, id)), id),
  /* `changed` for a mark only: {field: value before}, merged field by field (spec §6 Push) */
  put: (kind: string, id: string, row: { revision?: number; [field: string]: unknown }, changed?: Record<string, unknown>) =>
    record(request('PUT', rowPath(kind, id), changed ? { ...row, changed } : row, match(row.revision)), id, row.revision),
  revokeAll: () => empty(request('POST', '/api/session/revoke-all')),
  del: (kind: string, id: string, revision = 0) => empty(request('DELETE', rowPath(kind, id), undefined, match(revision))),
  calendarFeed: () => request('GET', '/api/calendar'),
  calendarRenew: () => request('POST', '/api/calendar'),
  calendarStop: () => empty(request('DELETE', '/api/calendar')),
  leaderboard: (since: string | number) => request('GET', `/api/leaderboard?since=${since}`),
  leaderboardJoin: (joined: boolean) => empty(request('PUT', '/api/leaderboard', { joined })),
  readOutline: (file: Blob, q: ReadQuery, signal?: AbortSignal) => request('POST', '/api/outline?' + query(q), file, undefined, signal),
  readSchool: (file: Blob, q: ReadQuery, signal?: AbortSignal) => request('POST', '/api/school-calendar?' + query(q), file, undefined, signal),
  readSchedule: (file: Blob, q: ReadQuery, signal?: AbortSignal) => request('POST', '/api/ai/schedule?' + query(q), file, undefined, signal),
  aiReads: (): Promise<{ left: number; limit: number }> => request('GET', '/api/ai/reads'),
  /* the Admin page; every call is refused (403) to anyone who is not an admin */
  admin: {
    accounts: () => request('GET', '/api/admin/accounts'),
    create: (body: { username: string; displayName: string; password: string; admin: boolean }) => request('POST', '/api/admin/accounts', body),
    resetPassword: (id: string, password: string) => empty(request('POST', `/api/admin/accounts/${encodeURIComponent(id)}/password`, { password })),
    revoke: (id: string) => empty(request('POST', `/api/admin/accounts/${encodeURIComponent(id)}/revoke`)),
    setAdmin: (id: string, admin: boolean) => empty(request('PUT', `/api/admin/accounts/${encodeURIComponent(id)}/admin`, { admin })),
    remove: (id: string, confirm: string) => empty(request('DELETE', `/api/admin/accounts/${encodeURIComponent(id)}`, { confirm })),
    unlock: (key: string) => empty(request('DELETE', `/api/admin/locks/${encodeURIComponent(key)}`)),
    errors: () => request('GET', '/api/admin/errors'),
    audit: () => request('GET', '/api/admin/audit'),
    traffic: () => request('GET', '/api/admin/traffic'),
    health: () => request('GET', '/api/admin/health'),
    announcement: () => request('GET', '/api/admin/announcement'),
    announce: (text: string, until: number) => request('PUT', '/api/admin/announcement', { text, until }),
    unannounce: () => empty(request('DELETE', '/api/admin/announcement')),
    maintenance: () => request('GET', '/api/admin/maintenance'),
    setMaintenance: (features: string[], message: string) => request('PUT', '/api/admin/maintenance', { features, message }),
  },
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
