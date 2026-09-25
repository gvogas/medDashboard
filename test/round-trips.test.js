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
import { BASE, signIn } from './helpers.js';

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

describe('a signed-in request', () => {
  it('checks the session and claims the rate limit in one round trip', async () => {
    const api = await signIn('trip-session');
    const e = countedEnv();
    expect((await requireSession(request(api, '/api/me'), e)).userId).toBe('u-trip-session');
    expect(e.log).toHaveLength(1);
    const s = countedEnv();
    await requireSession(request(api, '/api/spotify/devices'), s);
    expect(s.log).toHaveLength(1);
    const hits = await env.DB.prepare('SELECT key, hits FROM request_limits WHERE key LIKE ? ORDER BY key').bind('%:u-trip-session').all();
    expect(hits.results).toEqual([{ key: 'api:u-trip-session', hits: 2 }, { key: 'spotify:u-trip-session', hits: 1 }]);
  });

  it('spends no request budget on a signed-out cookie', async () => {
    const api = await signIn('trip-revoked');
    await env.DB.prepare('UPDATE users SET pw_gen = pw_gen + 1 WHERE id = ?').bind('u-trip-revoked').run();
    const before = await env.DB.prepare('SELECT hits FROM request_limits WHERE key = ?').bind('api:u-trip-revoked').first();
    await expect(requireSession(request(api, '/api/spotify/devices'), env)).rejects.toMatchObject({ status: 401, body: { error: 'unauthenticated' } });
    expect(await env.DB.prepare('SELECT hits FROM request_limits WHERE key = ?').bind('api:u-trip-revoked').first()).toEqual(before);
    expect(await env.DB.prepare('SELECT 1 FROM request_limits WHERE key = ?').bind('spotify:u-trip-revoked').first()).toBeNull();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind('u-trip-revoked').run();
    await expect(requireSession(request(api, '/api/me'), env)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses over the limit with the time left in the window', async () => {
    const api = await signIn('trip-limit');
    await env.DB.prepare('INSERT OR REPLACE INTO request_limits (key, hits, reset_at) VALUES (?, ?, ?)').bind('api:u-trip-limit', API_LIMIT, Date.now() + 30_000).run();
    const err = await requireSession(request(api, '/api/me'), env).catch((e) => e);
    expect(err).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(err.body.retryAfter).toBeGreaterThanOrEqual(29);
    expect(err.body.retryAfter).toBeLessThanOrEqual(30);
    expect(err.headers['retry-after']).toBe(String(err.body.retryAfter));
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
    // The session and limit, the token row, the upstream cooldown.
    expect(e.log).toHaveLength(3);
  });

  it('does not read the row back after a refresh', async () => {
    const api = await connected('trip-refresh', Date.now() + 1000);
    const e = countedEnv();
    const res = await handleApi(request(api, '/api/spotify/player'), e, new URL(BASE + '/api/spotify/player'));
    expect((await res.json()).connected).toBe(true);
    expect(e.log.filter((sql) => /^SELECT refresh_token/.test(sql))).toHaveLength(2);   // before and under the lease
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
