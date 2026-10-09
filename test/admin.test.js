import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, createUser, login, signIn } from './helpers.js';
import { LATEST_MIGRATION, adminHousekeeping } from '../worker/admin.js';
import { DAILY_CAP, logError, purgeErrors } from '../worker/errors.js';
import { trafficReport } from '../worker/analytics.js';
import { upsertRow } from '../worker/db.js';
import { NEXT_SPACE_REVISION as COPIED_REVISION } from '../worker/accounts.js';
import { NEXT_SPACE_REVISION } from '../worker/spaces.js';

const makeAdmin = (username) => env.DB.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').bind(username).run();

async function signInAdmin(username) {
  await createUser(username);
  await makeAdmin(username);
  const res = await login(username);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = (path, init = {}) => SELF.fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers || {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  call.id = 'u-' + username;
  return call;
}

const auditActions = async () =>
  (await env.DB.prepare('SELECT action, target FROM admin_log ORDER BY id').all()).results;

describe('admin access', () => {
  it('refuses every admin route to a signed-in person who is not an admin', async () => {
    const api = await signIn('plain1');
    for (const [method, path] of [['GET', '/api/admin/accounts'], ['POST', '/api/admin/accounts'], ['GET', '/api/admin/errors'],
      ['GET', '/api/admin/audit'], ['GET', '/api/admin/traffic'], ['GET', '/api/admin/health'], ['PUT', '/api/admin/announcement'],
      ['DELETE', '/api/admin/accounts/u-plain1']]) {
      const res = await api(path, { method, body: method === 'GET' ? undefined : {} });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses them signed out', async () => {
    expect((await SELF.fetch(`${BASE}/api/admin/accounts`)).status).toBe(401);
  });

  it('tells the app who is an admin', async () => {
    const plain = await signIn('plain2');
    expect((await (await plain('/api/me')).json()).isAdmin).toBe(false);
    const admin = await signInAdmin('boss1');
    expect((await (await admin('/api/me')).json()).isAdmin).toBe(true);
  });
});

describe('accounts', () => {
  it('creates an account that can sign in, and logs it', async () => {
    const admin = await signInAdmin('boss2');
    const res = await admin('/api/admin/accounts', { method: 'POST', body: { username: 'NewPerson', displayName: 'New Person', password: 'long enough' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ username: 'newperson' });
    expect((await login('newperson', 'long enough')).status).toBe(200);
    expect(await auditActions()).toContainEqual({ action: 'create', target: 'newperson' });
    expect((await admin('/api/admin/accounts', { method: 'POST', body: { username: 'newperson', password: 'long enough' } })).status).toBe(409);
    expect((await admin('/api/admin/accounts', { method: 'POST', body: { username: 'x', password: 'long enough' } })).status).toBe(400);
    expect((await admin('/api/admin/accounts', { method: 'POST', body: { username: 'shortpw', password: 'short' } })).status).toBe(400);
  });

  it('lists accounts with their activity', async () => {
    const admin = await signInAdmin('boss3');
    const id = await createUser('busy1');
    await upsertRow(env.DB, 'courses', id, 'c1', { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] });
    const body = await (await admin('/api/admin/accounts')).json();
    const busy = body.accounts.find((a) => a.username === 'busy1');
    expect(busy).toMatchObject({ courses: 1, items: 0, studyMinutes: 0, admin: false, spotify: false, feed: false });
    expect(body.accounts.find((a) => a.username === 'boss3')).toMatchObject({ admin: true });
    expect(Array.isArray(body.locks)).toBe(true);
  });

  it('records the day a person was last seen, once a day', async () => {
    const api = await signIn('seen1');
    await api('/api/me');
    const day = new Date().toISOString().slice(0, 10);
    expect(await env.DB.prepare('SELECT last_seen_day FROM users WHERE username = ?').bind('seen1').first()).toEqual({ last_seen_day: day });
  });

  it('resets a password: the old one stops working and so do the sessions', async () => {
    const admin = await signInAdmin('boss4');
    const victim = await signIn('reset1');
    expect((await admin('/api/admin/accounts/u-reset1/password', { method: 'POST', body: { password: 'brand new pw' } })).status).toBe(204);
    expect((await victim('/api/me')).status).toBe(401);
    expect((await login('reset1')).status).toBe(401);
    expect((await login('reset1', 'brand new pw')).status).toBe(200);
  });

  it('signs a person out everywhere without changing the password', async () => {
    const admin = await signInAdmin('boss5');
    const victim = await signIn('revoke1');
    expect((await admin('/api/admin/accounts/u-revoke1/revoke', { method: 'POST' })).status).toBe(204);
    expect((await victim('/api/me')).status).toBe(401);
    expect((await login('revoke1')).status).toBe(200);
  });

  it('deletes an account and its data, only with the name typed', async () => {
    const admin = await signInAdmin('boss6');
    const id = await createUser('gone1');
    await upsertRow(env.DB, 'courses', id, 'c1', { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] });
    expect((await admin('/api/admin/accounts/u-gone1', { method: 'DELETE', body: { confirm: 'wrong' } })).status).toBe(400);
    expect((await admin('/api/admin/accounts/u-gone1', { method: 'DELETE', body: { confirm: 'gone1' } })).status).toBe(204);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users WHERE id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?").bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM changes WHERE scope = 'u:' || ?").bind(id).first()).toEqual({ n: 0 });
    expect((await admin('/api/admin/accounts/u-gone1', { method: 'DELETE', body: { confirm: 'gone1' } })).status).toBe(404);
  });

  it("keeps worker/accounts.js's copy of the next space revision in step with worker/spaces.js", () => {
    expect(COPIED_REVISION).toBe(NEXT_SPACE_REVISION);
  });

  it('hands a class the account owns to its longest-standing editor, deletes one with nobody else, and drops its memberships', async () => {
    const admin = await signInAdmin('boss-own');
    const id = await createUser('owner9'), ed = await createUser('ed9'), mem = await createUser('mem9'), late = await createUser('late9');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at) VALUES ('ownsclass001', 'class', 1, 1), ('ownsclass002', 'class', 1, 1), ('ownsclass003', 'class', 1, 1), ('ownsclass004', 'class', 1, 1)"),
      env.DB.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES
        ('ownsclass001', ?1, 'owner', 1, 1), ('ownsclass001', ?2, 'member', 2, 2), ('ownsclass001', ?3, 'editor', 3, 3), ('ownsclass001', ?4, 'editor', 4, 4),
        ('ownsclass002', ?1, 'owner', 1, 1),
        ('ownsclass003', ?3, 'owner', 1, 1), ('ownsclass003', ?1, 'member', 2, 2),
        ('ownsclass004', ?1, 'owner', 1, 1), ('ownsclass004', ?4, 'member', 3, 3), ('ownsclass004', ?2, 'member', 2, 2)`).bind(id, mem, ed, late),
      env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES ('ownsclass002', ?, ?, 'member', 1, 9e15)").bind(mem, id),
      env.DB.prepare("INSERT INTO request_limits (key, hits, reset_at) VALUES ('invite:' || ?1, 1, 9e15), ('join:' || ?1, 1, 9e15)").bind(id),
    ]);
    const revisions = async () => (await env.DB.prepare("SELECT id, revision FROM spaces WHERE id GLOB 'ownsclass00*' ORDER BY id").all()).results;
    const before = await revisions();
    expect((await admin('/api/admin/accounts/u-owner9', { method: 'DELETE', body: { confirm: 'owner9' } })).status).toBe(204);
    const roles = async (space) => (await env.DB.prepare('SELECT user_id, role FROM members WHERE space_id = ? ORDER BY user_id').bind(space).all()).results;
    /* the longest-standing editor, ahead of a member who joined earlier */
    expect(await roles('ownsclass001')).toEqual([{ user_id: ed, role: 'owner' }, { user_id: late, role: 'editor' }, { user_id: mem, role: 'member' }]);
    /* no editor: the longest-standing member */
    expect(await roles('ownsclass004')).toEqual([{ user_id: late, role: 'member' }, { user_id: mem, role: 'owner' }]);
    /* a class it was only in keeps its owner */
    expect(await roles('ownsclass003')).toEqual([{ user_id: ed, role: 'owner' }]);
    const after = await revisions();
    for (let i = 0; i < 4; i++) expect(after[i].revision, after[i].id).toBeGreaterThan(before[i].revision);
    expect(await env.DB.prepare("SELECT deleted_at IS NOT NULL AS gone FROM spaces WHERE id = 'ownsclass002'").first()).toEqual({ gone: 1 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM spaces WHERE id GLOB 'ownsclass00*' AND deleted_at IS NOT NULL").first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM invites WHERE space_id = 'ownsclass002'").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM members WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM request_limits WHERE key IN ('invite:' || ?1, 'join:' || ?1)").bind(id).first()).toEqual({ n: 0 });
  });

  it("shows an invite from a deleted account as from 'A former member'", async () => {
    const admin = await signInAdmin('boss-former');
    const sender = await createUser('sender10');
    const guest = await signInAdmin('guest10');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at) VALUES ('formerinv001', 'class', 1, 1)"),
      env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, status, created_at, expires_at) VALUES ('formerinv001', ?, ?, 'member', 'pending', 1, 9e15)").bind(guest.id, sender),
    ]);
    expect((await admin('/api/admin/accounts/u-sender10', { method: 'DELETE', body: { confirm: 'sender10' } })).status).toBe(204);
    expect(await env.DB.prepare("SELECT invited_by FROM invites WHERE space_id = 'formerinv001'").first()).toEqual({ invited_by: null });
    const mine = await (await guest('/api/invites')).json();
    expect(mine.invites).toEqual([expect.objectContaining({ spaceId: 'formerinv001', from: 'A former member' })]);
  });

  it('will not let an admin delete or demote themselves', async () => {
    const admin = await signInAdmin('boss7');
    expect((await admin('/api/admin/accounts/u-boss7', { method: 'DELETE', body: { confirm: 'boss7' } })).status).toBe(400);
    expect((await admin('/api/admin/accounts/u-boss7/admin', { method: 'PUT', body: { admin: false } })).status).toBe(400);
  });

  it('promotes and demotes', async () => {
    const admin = await signInAdmin('boss8');
    await createUser('helper1');
    expect((await admin('/api/admin/accounts/u-helper1/admin', { method: 'PUT', body: { admin: true } })).status).toBe(204);
    expect(await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind('u-helper1').first()).toEqual({ is_admin: 1 });
    expect((await admin('/api/admin/accounts/u-helper1/admin', { method: 'PUT', body: { admin: false } })).status).toBe(204);
    expect(await auditActions()).toEqual(expect.arrayContaining([{ action: 'promote', target: 'helper1' }, { action: 'demote', target: 'helper1' }]));
    /* demoting someone who is not an admin changes nothing and logs nothing */
    expect((await admin('/api/admin/accounts/u-helper1/admin', { method: 'PUT', body: { admin: false } })).status).toBe(204);
    expect((await auditActions()).filter((e) => e.target === 'helper1')).toHaveLength(2);
  });

  it('unlocks a locked sign-in', async () => {
    const admin = await signInAdmin('boss9');
    await createUser('locked1');
    await env.DB.prepare('INSERT INTO login_throttle (username, fails, locked_until, updated_at) VALUES (?, 6, ?, ?)').bind('locked1', Date.now() + 600_000, Date.now()).run();
    const { locks } = await (await admin('/api/admin/accounts')).json();
    expect(locks).toContainEqual(expect.objectContaining({ key: 'locked1', username: 'locked1', device: false }));
    expect((await admin('/api/admin/locks/locked1', { method: 'DELETE' })).status).toBe(204);
    expect((await login('locked1')).status).toBe(200);
    expect((await admin('/api/admin/locks/locked1', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('errors', () => {
  it('logs a caught failure and groups repeats', async () => {
    const admin = await signInAdmin('boss10');
    await logError(env.DB, { method: 'GET', route: '/api/x', message: 'boom' });
    await logError(env.DB, { method: 'GET', route: '/api/x', message: 'boom' });
    const { groups, recent } = await (await admin('/api/admin/errors')).json();
    expect(groups.find((g) => g.message === 'boom')).toMatchObject({ count: 2, route: '/api/x', status: 500 });
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });

  it('writes at most the daily cap, and the nightly run forgets old ones', async () => {
    const day = Date.UTC(2020, 0, 1, 12);
    await env.DB.prepare('INSERT INTO error_log (at, message) SELECT ?, ? FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) SELECT i FROM n)')
      .bind(day, 'flood', DAILY_CAP).run();
    await logError(env.DB, { message: 'one more' }, day + 1000);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM error_log WHERE message = 'one more'").first()).toEqual({ n: 0 });
    await logError(env.DB, { message: 'next day' }, day + 24 * 60 * 60 * 1000);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM error_log WHERE message = 'next day'").first()).toEqual({ n: 1 });
    await purgeErrors(env.DB);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM error_log WHERE at < ?').bind(day + 2 * 24 * 60 * 60 * 1000).first()).toEqual({ n: 0 });
  });
});

describe('announcement', () => {
  it('shows a live announcement to everyone through /api/me, and takes it down', async () => {
    const admin = await signInAdmin('boss11');
    const person = await signIn('reader1');
    const until = Date.now() + 60 * 60 * 1000;
    const set = await admin('/api/admin/announcement', { method: 'PUT', body: { text: 'Maintenance tonight', until } });
    expect(set.status).toBe(200);
    expect((await (await person('/api/me')).json()).announcement).toMatchObject({ text: 'Maintenance tonight', until });
    expect((await admin('/api/admin/announcement', { method: 'DELETE' })).status).toBe(204);
    expect((await (await person('/api/me')).json()).announcement).toBeNull();
    expect((await admin('/api/admin/announcement', { method: 'PUT', body: { text: '', until } })).status).toBe(400);
    expect((await admin('/api/admin/announcement', { method: 'PUT', body: { text: 'x', until: Date.now() - 1 } })).status).toBe(400);
  });
});

describe('health and traffic', () => {
  it('knows the newest migration', () => {
    expect(env.TEST_MIGRATIONS.at(-1).name).toBe(LATEST_MIGRATION);
  });

  it('reports migrations, the nightly run and which secrets are set', async () => {
    const admin = await signInAdmin('boss12');
    await adminHousekeeping(env.DB, 1234);
    const h = await (await admin('/api/admin/health')).json();
    expect(h.migrations).toMatchObject({ ok: true, latest: LATEST_MIGRATION });
    expect(h.cronLastRun).toBe(1234);
    expect(h.secrets).toMatchObject({ SESSION_SECRET: true, CF_ANALYTICS_TOKEN: false });
    expect(JSON.stringify(h)).not.toContain('test-secret');
  });

  it('says traffic is not set up without a token', async () => {
    const admin = await signInAdmin('boss13');
    expect(await (await admin('/api/admin/traffic')).json()).toMatchObject({ configured: false });
  });

  it('adds up the analytics answers, and shows the parts that failed', async () => {
    const answers = {
      workersInvocationsAdaptive: (q) => q.includes('datetimeHour')
        ? [{ dimensions: { datetimeHour: '2026-10-01T02:00:00Z' }, sum: { requests: 5, errors: 1 } }, { dimensions: { datetimeHour: '2026-10-01T01:00:00Z' }, sum: { requests: 3, errors: 0 } }]
        : [{ sum: { requests: 40 } }, { sum: { requests: 2 } }],
      aiInferenceAdaptiveGroups: () => [{ sum: { totalNeurons: 108.4 } }],
      d1AnalyticsAdaptiveGroups: () => [{ sum: { rowsRead: 900, rowsWritten: 30 } }],
    };
    const fake = async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      expect(variables.account).toBe('acct');
      expect(init.headers.authorization).toBe('Bearer tok');
      const name = Object.keys(answers).find((n) => query.includes(n));
      if (!name) return Response.json({ errors: [{ message: 'unknown field' }] });
      return Response.json({ data: { viewer: { accounts: [{ rows: answers[name](query) }] } } });
    };
    const r = await trafficReport({ CF_ACCOUNT_ID: 'acct', CF_ANALYTICS_TOKEN: 'tok' }, Date.UTC(2026, 9, 1, 3), fake);
    expect(r.hours.map((h) => h.hour)).toEqual(['2026-10-01T01:00:00Z', '2026-10-01T02:00:00Z']);
    expect(r.today).toEqual({ requests: 42, neurons: 108, rowsRead: 900, rowsWritten: 30, storageBytes: null });
    expect(r.failed).toEqual({ storage: 'unknown field' });
  });
});
