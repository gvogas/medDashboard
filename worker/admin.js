// The Admin page's API, /api/admin/*: accounts, sign-in locks, the error and audit
// logs, traffic, health, the announcement and maintenance mode. Every route checks users.is_admin on
// the server; the sidebar hiding the page is only a convenience.
//
// Guards: an admin cannot delete or demote their own account, and the last admin
// cannot be removed. Each change is written to admin_log in the same batch.

import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { hashPassword, normalizeUsername } from './password.js';
import { errorGroups, recentErrors } from './errors.js';
import { cachedTrafficReport, configured as analyticsConfigured } from './analytics.js';
import { configured as spotifyConfigured } from './spotify.js';
import { ACCOUNT_TABLES } from './accounts.js';
import { readMaintenance, validateMaintenance } from './maintenance.js';
import { handOnStmts } from './leaving.js';

/* The newest file in migrations/; a test keeps it in step. */
export const LATEST_MIGRATION = '0003_presence.sql';
const AUDIT_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const ANNOUNCE_MAX = 280;
const ANNOUNCE_MAX_MS = 30 * DAY_MS;

/** The signed-in admin, {id, username}, or a 403. */
export async function requireAdmin(request, env) {
  const userId = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT username, is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!row || row.is_admin !== 1) throw new HttpError(403, { error: 'forbidden' });
  return { id: userId, username: row.username };
}

const audit = (db, admin, action, target = '', detail = '', now = Date.now()) =>
  db.prepare('INSERT INTO admin_log (at, admin, action, target, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(now, admin.username, action, target, String(detail).slice(0, 300));

function password(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) {
    throw new HttpError(400, { error: 'invalid', field: 'password' });
  }
  return value;
}

/** The account a route names, or a 404. */
async function target(db, id) {
  const row = await db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, { error: 'not_found' });
  return row;
}

/* Every throttle row of a name: its own and its trusted devices' (`name#device`). Not
   LIKE, where `_` is a wildcard. */
const throttleRows = (db, username) =>
  db.prepare('DELETE FROM login_throttle WHERE username = ?1 OR substr(username, 1, length(?1) + 1) = ?1 || \'#\'').bind(username);

export async function listAccounts(db) {
  const { results } = await db.prepare(
    `SELECT u.id, u.username, u.display_name AS displayName, u.is_admin AS admin, u.last_seen_day AS lastSeen,
            u.created_at AS createdAt, u.feed_gen IS NOT NULL AS feed, u.leaderboard,
            (SELECT count(*) FROM courses AS c WHERE c.scope = 'u:' || u.id AND c.deleted_at IS NULL) AS courses,
            (SELECT count(*) FROM items AS i WHERE i.scope = 'u:' || u.id AND i.deleted_at IS NULL) AS items,
            (SELECT COALESCE(sum(s.study_minutes), 0) FROM study_sessions AS s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS studyMinutes,
            EXISTS (SELECT 1 FROM spotify_tokens AS t WHERE t.user_id = u.id) AS spotify
     FROM users AS u ORDER BY u.username`,
  ).all();
  return results.map((r) => ({ ...r, admin: r.admin === 1, feed: r.feed === 1, leaderboard: r.leaderboard === 1, spotify: r.spotify === 1 }));
}

export async function listLocks(db, now = Date.now()) {
  const { results } = await db.prepare(
    'SELECT username AS key, fails, locked_until AS lockedUntil, updated_at AS updatedAt FROM login_throttle WHERE locked_until > ? ORDER BY locked_until DESC LIMIT 100',
  ).bind(now).all();
  /* `name#device` is a browser that signed in as the name before */
  return results.map((r) => ({ ...r, username: r.key.split('#')[0], device: r.key.includes('#') }));
}

export async function readAnnouncement(db, now = Date.now()) {
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'announcement'").first();
  if (!row) return null;
  try {
    const a = JSON.parse(row.value);
    return a && typeof a.text === 'string' && a.until > now ? { id: a.id, text: a.text, until: a.until } : null;
  } catch {
    return null;
  }
}

/** Nightly: note the run, and drop audit entries older than 90 days. */
export async function adminHousekeeping(db, now = Date.now()) {
  await db.batch([
    db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('cron', ?1, ?1) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?1").bind(String(now)),
    db.prepare('DELETE FROM admin_log WHERE at < ?').bind(now - AUDIT_KEEP_MS),
  ]);
}

/** Remember the UTC day the person was last seen; one write a day at most. */
export async function markSeen(db, userId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  await db.prepare('UPDATE users SET last_seen_day = ?1 WHERE id = ?2 AND (last_seen_day IS NULL OR last_seen_day != ?1)').bind(day, userId).run();
}

async function health(env, now = Date.now()) {
  const db = env.DB;
  const [migrations, cron, counts] = await Promise.all([
    db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().then((r) => r.results.map((m) => m.name), () => []),
    db.prepare("SELECT value FROM app_meta WHERE key = 'cron'").first(),
    db.prepare('SELECT (SELECT count(*) FROM users) AS accounts, (SELECT count(*) FROM error_log WHERE at >= ? AND status NOT BETWEEN 400 AND 499) AS errors24h').bind(now - DAY_MS).first(),
  ]);
  return {
    migrations: { latest: LATEST_MIGRATION, applied: migrations.at(-1) || null, ok: migrations.includes(LATEST_MIGRATION) },
    cronLastRun: cron ? Number(cron.value) : null,
    /* names and yes/no only, never values */
    secrets: {
      SESSION_SECRET: !!env.SESSION_SECRET,
      SPOTIFY: spotifyConfigured(env) && !!env.SPOTIFY_TOKEN_KEYS,
      CF_ANALYTICS_TOKEN: analyticsConfigured(env),
    },
    ai: !!env.AI,
    accounts: counts.accounts,
    errors24h: counts.errors24h,
  };
}

const done = () => new Response(null, { status: 204 });
const ACCOUNT = /^\/api\/admin\/accounts\/([^/]{1,64})$/;

export const adminRoutes = [
  ['GET', /^\/api\/admin\/accounts$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    const [accounts, locks] = await Promise.all([listAccounts(env.DB), listLocks(env.DB)]);
    return json({ accounts, locks });
  }],

  ['POST', /^\/api\/admin\/accounts$/, async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    if (!username) throw new HttpError(400, { error: 'invalid', field: 'username' });
    const displayName = typeof body.displayName === 'string' ? body.displayName.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60) : '';
    const hash = await hashPassword(password(body.password));
    const makeAdmin = body.admin === true;
    const now = Date.now(), id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, username, password_hash, display_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(id, username, hash, displayName, makeAdmin ? 1 : 0, now, now),
        audit(env.DB, admin, 'create', username, makeAdmin ? 'as admin' : '', now),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(e?.message || '')) throw new HttpError(409, { error: 'taken', field: 'username' });
      throw e;
    }
    return json({ id, username }, 201);
  }],

  ['POST', /^\/api\/admin\/accounts\/([^/]{1,64})\/password$/, async ({ request, env, params: [id] }) => {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    const hash = await hashPassword(password(body.password));
    const user = await target(env.DB, id);
    const now = Date.now();
    /* a new password signs the person out everywhere and lifts any lock on the name */
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ?, pw_gen = pw_gen + 1, updated_at = ? WHERE id = ?').bind(hash, now, id),
      throttleRows(env.DB, user.username),
      audit(env.DB, admin, 'reset', user.username, '', now),
    ]);
    return done();
  }],

  ['POST', /^\/api\/admin\/accounts\/([^/]{1,64})\/revoke$/, async ({ request, env, params: [id] }) => {
    const admin = await requireAdmin(request, env);
    const user = await target(env.DB, id);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_gen = pw_gen + 1 WHERE id = ?').bind(id),
      audit(env.DB, admin, 'revoke', user.username),
    ]);
    return done();
  }],

  ['PUT', /^\/api\/admin\/accounts\/([^/]{1,64})\/admin$/, async ({ request, env, params: [id] }) => {
    const admin = await requireAdmin(request, env);
    const { admin: on } = await readJson(request);
    if (typeof on !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'admin' });
    const user = await target(env.DB, id);
    if (!on && id === admin.id) throw new HttpError(400, { error: 'self' });
    /* the guard is in the statement, so two admins demoting each other cannot both win */
    const [changed] = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET is_admin = ?1 WHERE id = ?2 AND is_admin != ?1
        AND (?1 = 1 OR (SELECT count(*) FROM users WHERE is_admin = 1) > 1)`).bind(on ? 1 : 0, id),
      env.DB.prepare(`INSERT INTO admin_log (at, admin, action, target, detail) SELECT ?, ?, ?, ?, '' WHERE changes() > 0`)
        .bind(Date.now(), admin.username, on ? 'promote' : 'demote', user.username),
    ]);
    if (!changed.meta.changes && !on && user.is_admin === 1) throw new HttpError(409, { error: 'last_admin' });
    return done();
  }],

  ['DELETE', ACCOUNT, async ({ request, env, params: [id] }) => {
    const admin = await requireAdmin(request, env);
    const { confirm } = await readJson(request);
    const user = await target(env.DB, id);
    if (id === admin.id) throw new HttpError(400, { error: 'self' });
    if (confirm !== user.username) throw new HttpError(400, { error: 'invalid', field: 'confirm' });
    const db = env.DB;
    if (user.is_admin === 1) {
      const { n } = await db.prepare('SELECT count(*) AS n FROM users WHERE is_admin = 1').first();
      if (n <= 1) throw new HttpError(409, { error: 'last_admin' });
    }
    /* Its classes pass on (or go, with nobody else in them) in the same batch as the deletion. */
    await db.batch([
      ...handOnStmts(db, id),
      ...ACCOUNT_TABLES.map(([table, owner]) => db.prepare(`DELETE FROM ${table} WHERE ${owner}`).bind(id)),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
      throttleRows(db, user.username),
      db.prepare("DELETE FROM request_limits WHERE key IN ('api:' || ?1, 'spotify:' || ?1, 'outline:' || ?1, 'invite:' || ?1, 'join:' || ?1)").bind(id),
      audit(db, admin, 'delete', user.username),
    ]);
    return done();
  }],

  ['DELETE', /^\/api\/admin\/locks\/([^/]{1,80})$/, async ({ request, env, params: [key] }) => {
    const admin = await requireAdmin(request, env);
    const { meta } = await env.DB.prepare('DELETE FROM login_throttle WHERE username = ?').bind(key).run();
    if (!meta.changes) throw new HttpError(404, { error: 'not_found' });
    await audit(env.DB, admin, 'unlock', key.split('#')[0], key.includes('#') ? 'one browser' : '').run();
    return done();
  }],

  ['GET', /^\/api\/admin\/errors$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    const [groups, recent] = await Promise.all([errorGroups(env.DB, Date.now() - 7 * DAY_MS), recentErrors(env.DB)]);
    return json({ groups, recent });
  }],

  ['GET', /^\/api\/admin\/audit$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare('SELECT at, admin, action, target, detail FROM admin_log ORDER BY at DESC, id DESC LIMIT 200').all();
    return json({ entries: results });
  }],

  ['GET', /^\/api\/admin\/traffic$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    return json(await cachedTrafficReport(env));
  }],

  ['GET', /^\/api\/admin\/health$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    return json(await health(env));
  }],

  ['GET', /^\/api\/admin\/announcement$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    return json({ announcement: await readAnnouncement(env.DB) });
  }],

  ['PUT', /^\/api\/admin\/announcement$/, async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    const text = typeof body.text === 'string' ? body.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
    if (!text || text.length > ANNOUNCE_MAX) throw new HttpError(400, { error: 'invalid', field: 'text' });
    const now = Date.now();
    if (!Number.isSafeInteger(body.until) || body.until <= now || body.until > now + ANNOUNCE_MAX_MS) throw new HttpError(400, { error: 'invalid', field: 'until' });
    /* a new id each time, so a changed message shows again to those who closed the last */
    const announcement = { id: now, text, until: body.until };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('announcement', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2")
        .bind(JSON.stringify(announcement), now),
      audit(env.DB, admin, 'announce', '', text, now),
    ]);
    return json({ announcement });
  }],

  /* maintenance mode (worker/maintenance.js): which features are switched off, and why */
  ['GET', /^\/api\/admin\/maintenance$/, async ({ request, env }) => {
    await requireAdmin(request, env);
    return json({ maintenance: await readMaintenance(env.DB) });
  }],

  ['PUT', /^\/api\/admin\/maintenance$/, async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const maintenance = validateMaintenance(await readJson(request), admin.username);
    /* not in admin_log, whose CHECK lists its actions (a migration); the value says who */
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2")
      .bind(JSON.stringify(maintenance), maintenance.updatedAt).run();
    return json({ maintenance });
  }],

  ['DELETE', /^\/api\/admin\/announcement$/, async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM app_meta WHERE key = 'announcement'"),
      audit(env.DB, admin, 'unannounce'),
    ]);
    return done();
  }],
];
