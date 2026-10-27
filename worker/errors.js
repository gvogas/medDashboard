// The error log the Admin page reads, in four kinds: server (unexpected failures the Worker
// caught: 500s, failed AI reads), request (4xx answers: refused, not found, rate limited),
// browser (crashes in people's browsers, sent to /api/errors) and nightly (a scheduled job
// that failed). The kind comes from the row itself: method 'BROWSER' or 'CRON', else the status.
//
// Writing one must never fail the request it describes, and a bug that fails every request
// must not spend the day's free D1 writes, so each kind writes at most its cap per UTC day;
// the rest only reach Workers Logs. A flood of 4xx cannot crowd out the 500s, and refused
// requests and browser reports from no account (anyone on the internet) have a smaller cap
// inside their kind's, so they cannot crowd out those from people signed in.
import { readJson, HttpError } from './http.js';
import { claimLimit, rateLimited } from './limits.js';
import { sessionUserId } from './auth.js';
import { HOUR_MS, DAY_MS } from './time.js';

export const KINDS = ['server', 'request', 'browser', 'nightly'];
export const CAPS = { server: 500, request: 500, browser: 300, nightly: 100 };
/** Of the cap, how many may come from no account. */
export const ANON_CAPS = { request: 100, browser: 100 };
/** The server kind's cap, as before kinds. */
export const DAILY_CAP = CAPS.server;
const KEEP_MS = 30 * DAY_MS;
/** Browser reports one person (or address) may send an hour. */
export const BROWSER_PER_HOUR = 30;

const kindSql = (t = '') => `CASE WHEN ${t}method = 'BROWSER' THEN 'browser' WHEN ${t}method = 'CRON' THEN 'nightly'
  WHEN ${t}status BETWEEN 400 AND 499 THEN 'request' ELSE 'server' END`;
const KIND_SQL = kindSql();
export const kindOf = ({ method = '', status = 500 }) =>
  method === 'BROWSER' ? 'browser' : method === 'CRON' ? 'nightly' : status >= 400 && status <= 499 ? 'request' : 'server';

const dayStart = (now) => now - (now % DAY_MS);

/** Record one error. Never throws. */
export async function logError(db, { method = '', route = '', status = 500, message = '', userId = null }, now = Date.now()) {
  const kind = kindOf({ method, status });
  const anonCap = userId === null ? ANON_CAPS[kind] ?? null : null;
  try {
    await db.prepare(
      `INSERT INTO error_log (at, method, route, status, message, user_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT count(*) FROM error_log WHERE at >= ?7 AND ${KIND_SQL} = ?9) < ?8
         AND (?10 IS NULL OR (SELECT count(*) FROM error_log WHERE at >= ?7 AND ${KIND_SQL} = ?9 AND user_id IS NULL) < ?10)`,
    ).bind(now, String(method).slice(0, 8), String(route).slice(0, 200), status, String(message).slice(0, 500), userId, dayStart(now), CAPS[kind], kind, anonCap).run();
  } catch (e) {
    console.error('error_log:', e?.message || e);
  }
}

/** A message for the log: the error's own, without a stack. */
export const messageOf = (e) => String(e?.message || e || 'unknown').split('\n')[0];

/** Run a scheduled job; a failure goes in the log as nightly, under `cron/<name>`. */
export async function cronJob(db, name, job) {
  try {
    await job();
  } catch (e) {
    console.error(`cron ${name}:`, e);
    await logError(db, { method: 'CRON', route: 'cron/' + name, message: messageOf(e) });
  }
}

/**
 * The errors since `since`, grouped by route and message, newest first:
 * [{kind, method, route, status, message, count, last, first, users}].
 */
export async function errorGroups(db, since) {
  const { results } = await db.prepare(
    `SELECT ${KIND_SQL} AS kind, method, route, status, message, count(*) AS count, max(at) AS last, min(at) AS first,
            count(DISTINCT user_id) AS users
     FROM error_log WHERE at >= ? GROUP BY method, route, status, message ORDER BY last DESC LIMIT 400`,
  ).bind(since).all();
  return results;
}

/** The latest errors one by one, `limit` of each kind, with the username where there was one. */
export async function recentErrors(db, limit = 50) {
  const { results } = await db.prepare(
    `SELECT at, kind, method, route, status, message, username FROM (
       SELECT e.at, ${kindSql('e.')} AS kind, e.method, e.route, e.status, e.message, u.username,
              row_number() OVER (PARTITION BY ${kindSql('e.')} ORDER BY e.at DESC) AS n
       FROM error_log AS e LEFT JOIN users AS u ON u.id = e.user_id)
     WHERE n <= ? ORDER BY at DESC`,
  ).bind(limit).all();
  return results;
}

/** Nightly: forget errors older than 30 days. */
export async function purgeErrors(db, now = Date.now()) {
  await db.prepare('DELETE FROM error_log WHERE at < ?').bind(now - KEEP_MS).run();
}

/* ── browser reports ── */

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '');

/** A crash in someone's browser: {message, where, kind}. Signed in or not; a few an hour each. */
export async function reportBrowserError(request, env, now = Date.now()) {
  const body = await readJson(request);
  const message = text(body?.message, 500);
  if (!message) throw new HttpError(400, { error: 'invalid', field: 'message' });
  const userId = await sessionUserId(request, env);
  const who = userId ?? 'ip:' + (request.headers.get('cf-connecting-ip') || 'unknown');
  const wait = await claimLimit(env.DB, `browser-error:${who}`, BROWSER_PER_HOUR, now, HOUR_MS);
  if (wait) throw rateLimited(wait);
  const what = text(body?.kind, 20);
  await logError(env.DB, { method: 'BROWSER', route: text(body?.where, 200), status: 0, message: (what ? what + ': ' : '') + message, userId }, now);
}

export const errorRoutes = [
  ['POST', /^\/api\/errors$/, async ({ request, env }) => { await reportBrowserError(request, env); return new Response(null, { status: 204 }); }],
];
