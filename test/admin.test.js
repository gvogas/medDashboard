import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, createUser, login, signIn } from './helpers.js';
import { LATEST_MIGRATION, adminHousekeeping } from '../worker/admin.js';
import { ANON_CAPS, BROWSER_PER_HOUR, CAPS, DAILY_CAP, cronJob, logError, purgeErrors } from '../worker/errors.js';
import { trafficReport } from '../worker/analytics.js';
import { upsertRow } from '../worker/db.js';
import { DELETE_ACCOUNT, LAST_ADMIN, NEXT_SPACE_REVISION as COPIED_REVISION } from '../worker/accounts.js';
import { deleteAccountStmts } from '../worker/leaving.js';
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

  it('deletes through the shared statements for a script too: audit as the CLI, limits cleared, last admin refused', async () => {
    await signInAdmin('bossscript');
    const id = await createUser('gone2');
    await env.DB.prepare("INSERT INTO request_limits (key, hits, reset_at) VALUES ('api:' || ?, 1, 1)").bind(id).run();
    /* the script binds the same text itself, value by value */
    const values = [`'${id}'`, '5', "'gone2'", "'cli'", "'scripts/add-user.mjs'"];
    for (const sql of DELETE_ACCOUNT) await env.DB.prepare(sql.replace(/\?(\d+)/g, (_, n) => values[n - 1])).run();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users WHERE id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM request_limits WHERE key = 'api:' || ?").bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT admin, target, detail FROM admin_log WHERE action = 'delete' AND target = 'gone2'").first())
      .toEqual({ admin: 'cli', target: 'gone2', detail: 'scripts/add-user.mjs' });
    /* the Worker's binding writes the same entry for an admin */
    const other = await createUser('gone3');
    await env.DB.batch(deleteAccountStmts(env.DB, { id: other, username: 'gone3', actor: 'bossscript' }));
    expect(await env.DB.prepare("SELECT admin FROM admin_log WHERE target = 'gone3'").first()).toEqual({ admin: 'bossscript' });
    /* only one admin: a row means it may not go */
    const { results: admins } = await env.DB.prepare("SELECT id FROM users WHERE is_admin = 1 AND id != 'u-bossscript'").all();
    expect(await env.DB.prepare(LAST_ADMIN).bind('u-bossscript').first()).toBeNull();
    await env.DB.prepare("UPDATE users SET is_admin = 0 WHERE id != 'u-bossscript'").run();
    expect(await env.DB.prepare(LAST_ADMIN).bind('u-bossscript').first()).toEqual({ x: 1 });
    await env.DB.batch(admins.map((a) => env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(a.id)));
    expect(await env.DB.prepare(LAST_ADMIN).bind(id).first()).toBeNull();
  });

  it('undoes a deletion batch that would leave no admin, as when two admins delete each other at once', async () => {
    const x = await createUser('racex'), y = await createUser('racey');
    const { results: others } = await env.DB.prepare('SELECT id FROM users WHERE is_admin = 1').all();
    await env.DB.prepare('UPDATE users SET is_admin = 0').run();
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id IN (?, ?)').bind(x, y).run();
    try {
      /* both checks ran before either batch: the first batch goes through, the second stops at its guard */
      await env.DB.batch(deleteAccountStmts(env.DB, { id: x, username: 'racex', actor: 'racey' }));
      await expect(env.DB.batch(deleteAccountStmts(env.DB, { id: y, username: 'racey', actor: 'racex' }))).rejects.toThrow();
      expect(await env.DB.prepare('SELECT username, is_admin FROM users WHERE id = ?').bind(y).first()).toEqual({ username: 'racey', is_admin: 1 });
      expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_log WHERE action = 'delete' AND target = 'racey'").first()).toEqual({ n: 0 });
    } finally {
      await env.DB.batch(others.map((a) => env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(a.id)));
    }
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
    await env.DB.batch([
      env.DB.prepare("INSERT INTO activity (space_id, actor_id, verb, subject_user, bucket, at) VALUES ('ownsclass001', ?1, 'member.joined', '', 1, 1), ('ownsclass001', ?2, 'member.role', ?1, 2, 2)").bind(id, ed),
      env.DB.prepare('INSERT INTO inbox_seen (user_id, seq) VALUES (?, 1)').bind(id),
    ]);
    expect((await admin('/api/admin/accounts/u-owner9', { method: 'DELETE', body: { confirm: 'owner9' } })).status).toBe(204);
    expect((await env.DB.prepare('SELECT verb FROM activity WHERE subject_user = ?').bind(id).all()).results).toEqual([]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM inbox_seen WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM activity WHERE actor_id = ? AND verb = 'member.joined'").bind(id).first()).toEqual({ n: 1 });
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

  it("strips a deleted account from its projects' assignees", async () => {
    const admin = await signInAdmin('boss-strip');
    const gone = await createUser('strip1'), stays = await createUser('strip2');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at) VALUES ('stripproj001', 'project', 1, 1)"),
      env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES ('stripproj001', ?1, 'owner', 1, 1), ('stripproj001', ?2, 'editor', 2, 2)").bind(stays, gone),
      env.DB.prepare(`INSERT INTO items (scope, id, type, title, date, status, assignees, created_at, updated_at) VALUES
        ('p:stripproj001', 't1', 'task', 'T', '2026-10-20', 'todo', ?1, 1, 1), ('p:stripproj001', 't2', 'task', 'U', '2026-10-20', 'todo', ?2, 1, 1)`)
        .bind(JSON.stringify([gone, stays]), JSON.stringify([stays])),
      /* a deleted project waits for the purge untouched */
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at, deleted_at) VALUES ('stripproj002', 'project', 1, 1, 5)"),
      env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES ('stripproj002', ?1, 'owner', 1, 1), ('stripproj002', ?2, 'editor', 2, 2)").bind(stays, gone),
      env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, assignees, created_at, updated_at) VALUES ('p:stripproj002', 't1', 'task', 'T', '2026-10-20', 'todo', ?, 1, 1)")
        .bind(JSON.stringify([gone])),
    ]);
    expect((await admin('/api/admin/accounts/u-strip1', { method: 'DELETE', body: { confirm: 'strip1' } })).status).toBe(204);
    const rows = (await env.DB.prepare("SELECT id, assignees, revision FROM items WHERE scope = 'p:stripproj001' ORDER BY id").all()).results;
    expect(rows.map((r) => [r.id, JSON.parse(r.assignees)])).toEqual([['t1', [stays]], ['t2', [stays]]]);
    /* a task it was not on is left alone */
    expect(rows[1].revision).toBe(1);
    expect(await env.DB.prepare("SELECT assignees, revision FROM items WHERE scope = 'p:stripproj002'").first()).toEqual({ assignees: JSON.stringify([gone]), revision: 1 });
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

  it('never keeps a calendar feed link: its token is the password', async () => {
    await logError(env.DB, { method: 'GET', route: '/api/calendar/u1/s3cr3tt0ken.ics', status: 429, message: 'rate_limited' });
    const rows = await env.DB.prepare("SELECT route FROM error_log WHERE route LIKE '/api/calendar/%'").all();
    expect(rows.results.map((r) => r.route)).toEqual(['/api/calendar/…/….ics']);
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

describe('every kind of error', () => {
  const rows = (route) => env.DB.prepare('SELECT method, status, message, user_id FROM error_log WHERE route = ? ORDER BY id').bind(route).all().then((r) => r.results);

  it('logs a refused request with who sent it, as a request error, and leaves it out of the health count', async () => {
    const admin = await signInAdmin('boss20');
    const before = (await (await admin('/api/admin/health')).json()).errors24h;
    expect((await admin('/api/items/nope', { method: 'PUT', body: {} })).status).toBeGreaterThanOrEqual(400);
    expect((await admin('/api/no-such-thing')).status).toBe(404);
    expect(await rows('/api/no-such-thing')).toEqual([{ method: 'GET', status: 404, message: 'not_found', user_id: 'u-boss20' }]);
    const { groups } = await (await admin('/api/admin/errors')).json();
    expect(groups.find((g) => g.route === '/api/no-such-thing')).toMatchObject({ kind: 'request', users: 1 });
    expect((await (await admin('/api/admin/health')).json()).errors24h).toBe(before);
  });

  it('leaves out a 401 to someone with no session, and keeps one to a session that ended', async () => {
    /* other tests ask /api/me too: only what these two add counts */
    const before = (await rows('/api/me')).length;
    expect((await SELF.fetch(`${BASE}/api/me`)).status).toBe(401);
    expect((await rows('/api/me')).length).toBe(before);
    const stale = await SELF.fetch(`${BASE}/api/me`, { headers: { cookie: 'rounds_session=not-a-session' } });
    expect(stale.status).toBe(401);
    expect((await rows('/api/me')).slice(before)).toEqual([{ method: 'GET', status: 401, message: 'unauthenticated', user_id: null }]);
  });

  it('takes a crash from a browser, signed in or not, a few an hour each', async () => {
    const person = await signIn('crash1');
    expect((await person('/api/errors', { method: 'POST', body: { kind: 'react', message: 'TypeError: x is undefined @ /assets/a.js:1:2', where: '/study' } })).status).toBe(204);
    expect(await rows('/study')).toEqual([{ method: 'BROWSER', status: 0, message: 'react: TypeError: x is undefined @ /assets/a.js:1:2', user_id: 'u-crash1' }]);
    const anon = (body) => SELF.fetch(`${BASE}/api/errors`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.9.9' }, body: JSON.stringify(body) });
    expect((await anon({ message: 'boom', where: '/signin' })).status).toBe(204);
    expect(await rows('/signin')).toEqual([expect.objectContaining({ method: 'BROWSER', user_id: null })]);
    expect((await anon({ message: '' })).status).toBe(400);
    for (let i = 1; i < BROWSER_PER_HOUR; i++) await anon({ message: 'again ' + i });
    expect((await anon({ message: 'one too many' })).status).toBe(429);
    /* a refused report is not logged again as a refused request */
    expect(await rows('/api/errors')).toEqual([]);
  });

  it('logs a nightly job that fails, and the jobs after it still run', async () => {
    let ran = false;
    await cronJob(env.DB, 'test-job', async () => { throw new Error('disk on fire\nat stack'); });
    await cronJob(env.DB, 'next-job', async () => { ran = true; });
    expect(ran).toBe(true);
    expect(await rows('cron/test-job')).toEqual([{ method: 'CRON', status: 500, message: 'disk on fire', user_id: null }]);
    const admin = await signInAdmin('boss21');
    const { groups, recent } = await (await admin('/api/admin/errors')).json();
    expect(groups.find((g) => g.route === 'cron/test-job').kind).toBe('nightly');
    expect(recent.find((e) => e.route === 'cron/test-job').kind).toBe('nightly');
  });

  it('caps each kind on its own, so a flood of refused requests leaves room for failures', async () => {
    const day = Date.UTC(2020, 1, 1, 12);
    await env.DB.prepare("INSERT INTO error_log (at, method, status, message) SELECT ?, 'GET', 404, 'flood' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) SELECT i FROM n)")
      .bind(day, CAPS.request).run();
    await logError(env.DB, { method: 'GET', route: '/cap/req', status: 404, message: 'x' }, day + 1000);
    await logError(env.DB, { method: 'GET', route: '/cap/500', status: 500, message: 'x' }, day + 1000);
    await logError(env.DB, { method: 'BROWSER', route: '/cap/br', status: 0, message: 'x' }, day + 1000);
    expect((await rows('/cap/req')).length).toBe(0);
    expect((await rows('/cap/500')).length).toBe(1);
    expect((await rows('/cap/br')).length).toBe(1);
    await env.DB.prepare('DELETE FROM error_log WHERE at < ?').bind(day + 24 * 60 * 60 * 1000).run();
  });

  it('does not count again once a kind has reached its cap for the day', async () => {
    const day = Date.UTC(2020, 5, 1, 12);
    await env.DB.prepare("INSERT INTO error_log (at, method, status, message) SELECT ?, 'GET', 404, 'flood' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) SELECT i FROM n)")
      .bind(day, CAPS.request).run();
    await logError(env.DB, { method: 'GET', route: '/full/1', status: 404, message: 'x', userId: 'u-x' }, day + 1000);
    const prepared = [];
    const spy = { prepare: (sql) => { prepared.push(sql); return env.DB.prepare(sql); } };
    await logError(spy, { method: 'GET', route: '/full/2', status: 404, message: 'x', userId: 'u-x' }, day + 2000);
    expect(prepared).toEqual([]);
    expect((await rows('/full/2')).length).toBe(0);
    await env.DB.prepare('DELETE FROM error_log WHERE at < ?').bind(day + 24 * 60 * 60 * 1000).run();
  });

  it('keeps room for signed-in people when strangers send a flood', async () => {
    const day = Date.UTC(2020, 2, 1, 12);
    await env.DB.prepare("INSERT INTO error_log (at, method, status, message) SELECT ?, 'GET', 404, 'flood' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) SELECT i FROM n)")
      .bind(day, ANON_CAPS.request).run();
    await logError(env.DB, { method: 'GET', route: '/anon/req', status: 404, message: 'x' }, day + 1000);
    await createUser('capped1');
    await logError(env.DB, { method: 'GET', route: '/anon/user', status: 404, message: 'x', userId: 'u-capped1' }, day + 1000);
    expect((await rows('/anon/req')).length).toBe(0);
    expect((await rows('/anon/user')).length).toBe(1);
    await env.DB.prepare('DELETE FROM error_log WHERE at < ?').bind(day + 24 * 60 * 60 * 1000).run();
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
