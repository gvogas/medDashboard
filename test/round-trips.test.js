// D1 round trips per request. Each one is a network hop from the Worker to the
// database, so the steady paths (every signed-in request, the player poll, a save)
// should spend as few as they can.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { API_LIMIT } from '../worker/limits.js';
import { requireSession } from '../worker/auth.js';
import { handleApi } from '../worker/api.js';
import { upsertRow, deleteRow } from '../worker/db.js';
import { encryptToken } from '../worker/spotify.js';
import { createRoom, getRoom, joinRoom, roomClock } from '../worker/rooms.js';
import { BASE, createUser, signIn } from './helpers.js';

const RAW = Symbol('statement');

/** env.DB, logging each call that goes to the database: a statement run or a batch. */
function counted(db) {
  const log = [];
  const wrap = (stmt, sql) => ({
    [RAW]: stmt,
    bind: (...args) => wrap(stmt.bind(...args), sql),
    first: (...args) => { log.push(sql); return stmt.first(...args); },
    run: () => { log.push(sql); return stmt.run(); },
    all: () => { log.push(sql); return stmt.all(); },
    raw: (...args) => { log.push(sql); return stmt.raw(...args); },
  });
  return {
    log,
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: (stmts) => { log.push('batch'); return db.batch(stmts.map((s) => s[RAW] ?? s)); },
  };
}

function countedEnv() {
  const DB = counted(env.DB);
  return { ...env, DB, log: DB.log };
}

const request = (api, path, init = {}) =>
  new Request(BASE + path, { ...init, headers: { cookie: api.cookie, 'content-type': 'application/json', ...(init.headers || {}) } });

beforeEach(async () => { await env.DB.prepare("DELETE FROM request_limits WHERE key LIKE 'upstream:%'").run(); });

/** A rate-limiting binding that records each key it counts and refuses those in `full`. */
function limiter(full = []) {
  const keys = [];
  return { keys, limit: async ({ key }) => { keys.push(key); return { success: !full.includes(key) }; } };
}

describe('a signed-in request', () => {
  it('checks the session in one round trip and writes nothing: Cloudflare counts it', async () => {
    const api = await signIn('trip-session');
    const e = { ...countedEnv(), API_LIMITER: limiter(), SPOTIFY_LIMITER: limiter() };
    expect((await requireSession(request(api, '/api/me'), e)).userId).toBe('u-trip-session');
    await requireSession(request(api, '/api/spotify/devices'), e);
    expect(e.log).toEqual(['SELECT pw_gen FROM users WHERE id = ?', 'SELECT pw_gen FROM users WHERE id = ?']);
    expect(e.API_LIMITER.keys).toEqual(['u-trip-session', 'u-trip-session']);
    expect(e.SPOTIFY_LIMITER.keys).toEqual(['u-trip-session']);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM request_limits WHERE key LIKE ?').bind('%:u-trip-session').first()).n).toBe(0);
  });

  it('spends no request budget on a signed-out cookie', async () => {
    const api = await signIn('trip-revoked');
    const e = { ...env, API_LIMITER: limiter(), SPOTIFY_LIMITER: limiter() };
    await env.DB.prepare('UPDATE users SET pw_gen = pw_gen + 1 WHERE id = ?').bind('u-trip-revoked').run();
    await expect(requireSession(request(api, '/api/spotify/devices'), e)).rejects.toMatchObject({ status: 401, body: { error: 'unauthenticated' } });
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind('u-trip-revoked').run();
    await expect(requireSession(request(api, '/api/me'), e)).rejects.toMatchObject({ status: 401 });
    expect(e.API_LIMITER.keys).toEqual([]);
    expect(e.SPOTIFY_LIMITER.keys).toEqual([]);
  });

  it('refuses over the limit for a minute, and counts Spotify only when the API admitted it', async () => {
    const api = await signIn('trip-limit');
    const e = { ...env, API_LIMITER: limiter(['u-trip-limit']), SPOTIFY_LIMITER: limiter() };
    const err = await requireSession(request(api, '/api/spotify/devices'), e).catch((x) => x);
    expect(err).toMatchObject({ status: 429, body: { error: 'rate_limited', retryAfter: 60 } });
    expect(err.headers['retry-after']).toBe('60');
    expect(e.SPOTIFY_LIMITER.keys).toEqual([]);
  });
});

describe('without the rate-limiting bindings', () => {
  /* the windows are D1 rows, claimed with the session check in one batch */
  const d1Env = () => { const { API_LIMITER, SPOTIFY_LIMITER, ...rest } = countedEnv(); return rest; };

  it('checks the session and claims the windows in one round trip', async () => {
    const api = await signIn('trip-d1');
    const e = d1Env();
    expect((await requireSession(request(api, '/api/me'), e)).userId).toBe('u-trip-d1');
    expect(e.log).toEqual(['batch']);
    await requireSession(request(api, '/api/spotify/devices'), d1Env());
    const hits = await env.DB.prepare('SELECT key, hits FROM request_limits WHERE key LIKE ? ORDER BY key').bind('%:u-trip-d1').all();
    expect(hits.results).toEqual([{ key: 'api:u-trip-d1', hits: 2 }, { key: 'spotify:u-trip-d1', hits: 1 }]);
  });

  it('refuses over the limit with the time left in the window', async () => {
    const api = await signIn('trip-d1-limit');
    await env.DB.prepare('INSERT OR REPLACE INTO request_limits (key, hits, reset_at) VALUES (?, ?, ?)').bind('api:u-trip-d1-limit', API_LIMIT, Date.now() + 30_000).run();
    const err = await requireSession(request(api, '/api/me'), d1Env()).catch((x) => x);
    expect(err).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(err.body.retryAfter).toBeGreaterThanOrEqual(29);
    expect(err.body.retryAfter).toBeLessThanOrEqual(30);
  });
});

describe('the player poll', () => {
  async function connected(name, expiresAt) {
    const api = await signIn(name);
    await env.DB.prepare('INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('u-' + name, await encryptToken(env.SESSION_SECRET, 'ref-good'), 'tok-playing', expiresAt, Date.now()).run();
    return api;
  }

  it('reads the token row once', async () => {
    const api = await connected('trip-player', Date.now() + 3_600_000);
    const e = countedEnv();
    const res = await handleApi(request(api, '/api/spotify/player'), e, new URL(BASE + '/api/spotify/player'));
    expect((await res.json()).connected).toBe(true);
    // The session; the token row and the upstream cooldown together.
    expect(e.log).toEqual(['SELECT pw_gen FROM users WHERE id = ?', 'batch']);
  });

  it('does not read the row back after a refresh', async () => {
    const api = await connected('trip-refresh', Date.now() + 1000);
    const e = countedEnv();
    const res = await handleApi(request(api, '/api/spotify/player'), e, new URL(BASE + '/api/spotify/player'));
    expect((await res.json()).connected).toBe(true);
    expect(e.log.filter((sql) => /^SELECT refresh_token/.test(sql))).toHaveLength(1);   // under the lease; the first read is batched
  });

  it('is still not connected without a row', async () => {
    const api = await signIn('trip-none');
    const e = countedEnv();
    const res = await handleApi(request(api, '/api/spotify/player'), e, new URL(BASE + '/api/spotify/player'));
    expect(await res.json()).toEqual({ connected: false });
    expect(e.log).toHaveLength(2);
  });
});

describe('saving and deleting rows', () => {
  const item = { type: 'task', title: 'Read', courseId: 'c1', date: '2026-10-01', start: '', end: '', where: '', status: 'todo', grade: null, weight: null, notes: '', checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: '', completedAt: null };
  const course = { code: 'C1', name: 'Course', color: '#E4749B', instructor: '', term: '', archived: false, meetings: [] };

  it('saves an item with a course in one statement', async () => {
    const api = await signIn('trip-put');
    await api('/api/courses/c1', { method: 'PUT', body: course });
    const e = countedEnv();
    const res = await handleApi(request(api, '/api/items/i1', { method: 'PUT', headers: { 'if-match': '"0"' }, body: JSON.stringify(item) }), e, new URL(BASE + '/api/items/i1'));
    expect(res.status).toBe(200);
    expect(e.log).toHaveLength(2);   // the session, the upsert
  });

  it('tells a missing course from a stale revision', async () => {
    const api = await signIn('trip-put2');
    await api('/api/courses/c1', { method: 'PUT', body: course });
    const saved = await (await api('/api/items/i1', { method: 'PUT', body: item })).json();
    const put = (body, revision) => api('/api/items/i1', { method: 'PUT', headers: { 'if-match': `"${revision}"` }, body });
    const stale = await put(item, saved.revision - 1);
    expect(stale.status).toBe(409);
    expect((await stale.json()).current).toMatchObject({ id: 'i1', revision: saved.revision });
    const missing = await put({ ...item, courseId: 'nope' }, saved.revision);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect((await put({ ...item, courseId: 'nope' }, 0)).status).toBe(400);
    await api('/api/courses/c1', { method: 'DELETE' });
    const now = await (await api('/api/items/i1')).json();
    expect(await (await put(item, now.revision)).json()).toEqual({ error: 'invalid', field: 'courseId' });
  });

  it('deletes in one round trip, and looks up only on a miss', async () => {
    const db = counted(env.DB);
    const saved = await upsertRow(env.DB, 'quotes', 'u-trip-put', 'q1', { text: 'x', source: '' });
    expect(await deleteRow(db, 'quotes', 'u-trip-put', 'q1', Date.now(), saved.revision)).toBe(true);
    expect(db.log).toHaveLength(1);
    expect(await deleteRow(env.DB, 'quotes', 'u-trip-put', 'q1', Date.now(), 0)).toBe(true);   // already deleted
    expect(await deleteRow(env.DB, 'quotes', 'u-trip-put', 'none', Date.now(), 0)).toBe(false);
    const live = await upsertRow(env.DB, 'quotes', 'u-trip-put', 'q2', { text: 'y', source: '' });
    await expect(deleteRow(env.DB, 'quotes', 'u-trip-put', 'q2', Date.now(), live.revision + 5))
      .rejects.toMatchObject({ status: 409, body: { error: 'conflict', current: { id: 'q2', revision: live.revision } } });
  });
});

describe('a sync', () => {
  it('pages and counts the inbox in three round trips: the session, the spaces, the page with the count', async () => {
    const api = await signIn('trip-sync');
    await api('/api/quotes/q1', { method: 'PUT', body: { text: 'x', source: '' } });
    const e = countedEnv();
    const res = await handleApi(request(api, '/api/sync?v=3'), e, new URL(BASE + '/api/sync?v=3'));
    const page = await res.json();
    expect(page).toMatchObject({ more: false, unread: 0 });
    expect(page.changes.map((c) => c.row.id)).toEqual(['q1']);
    expect(e.log).toHaveLength(3);
    expect(e.log.slice(1)).toEqual(['batch', 'batch']);
  });
});

describe('a room poll', () => {
  const T = 1_800_000_000_000;
  const FLOW = { steps: [['study', 25], ['break', 5]], rounds: 2 };

  it('reads the room once, and still sees what changed since the last poll', async () => {
    const [h, p] = await Promise.all([createUser('trip-room-h'), createUser('trip-room-p')]);
    const [lo, hi] = h < p ? [h, p] : [p, h];
    await env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at, accepted_at) VALUES (?, ?, ?, 'accepted', 1, 1)").bind(lo, hi, lo).run();
    const made = await createRoom(env.DB, h, { flow: FLOW }, T);
    await joinRoom(env.DB, p, made.room.id, {}, T);
    /* within 30 s of the last sign of life, so last_seen is not written: one read of the room */
    const db = counted(env.DB);
    expect(await getRoom(db, h, made.room.id, null, T + 1000)).toMatchObject({ room: { id: made.room.id } });
    expect(db.log).toEqual(['batch']);
    await roomClock(env.DB, h, made.room.id, { action: 'pause' }, T + 2000);
    expect((await getRoom(db, p, made.room.id, null, T + 3000)).room.run.pausedAt).toBe(T + 2000);
  });
});
