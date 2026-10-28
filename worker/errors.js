// The error log the Admin page reads, in four kinds: server (unexpected failures the Worker
// caught: 500s, failed AI reads), request (4xx answers: refused, not found, rate limited),
// browser (crashes in people's browsers, sent to /api/errors) and nightly (a scheduled job
// that failed). The kind comes from the row itself: method 'BROWSER' or 'CRON', else the status.
//
// Writing one must never fail the request it describes, and a bug that fails every request
// must not spend the day's free D1 writes, so each kind writes at most its cap per UTC day;
// the rest only reach Workers Logs. A flood of 4xx cannot crowd out the 500s, and refused
// requests from no account (anyone on the internet) have a smaller cap inside their kind's, so
// they cannot crowd out those from people signed in. Browser reports need a signed-in session.
import { readJson, HttpError } from './http.js';
import { claimLimit, rateLimited } from './limits.js';
import { requireUser } from './auth.js';
import { HOUR_MS, DAY_MS } from './time.js';

export const KINDS = ['server', 'request', 'browser', 'nightly'];
export const CAPS = { server: 500, request: 500, browser: 300, nightly: 100 };
/** Of the cap, how many refused requests from no account may take. */
export const ANON_CAPS = { request: 100 };
/** The server kind's cap, as before kinds. */
export const DAILY_CAP = CAPS.server;
const KEEP_MS = 30 * DAY_MS;
/** Browser reports one person may send an hour. */
export const BROWSER_PER_HOUR = 30;

const kindSql = (t = '') => `CASE WHEN ${t}method = 'BROWSER' THEN 'browser' WHEN ${t}method = 'CRON' THEN 'nightly'
  WHEN ${t}status BETWEEN 400 AND 499 THEN 'request' ELSE 'server' END`;
const KIND_SQL = kindSql();
export const kindOf = ({ method = '', status = 500 }) =>
  method === 'BROWSER' ? 'browser' : method === 'CRON' ? 'nightly' : status >= 400 && status <= 499 ? 'request' : 'server';

const dayStart = (now) => now - (now % DAY_MS);

/* patterns with their own indices, built once per pattern */
const indexed = new WeakMap();

/**
 * A request's route as the log keeps it: the route table's template, with every captured
 * value (ids, tokens, a calendar feed's link) replaced by `:param`. A path no route matches
 * is one fixed label, so arbitrary text from the request never reaches the log.
 */
export function routeLabel(pathname, routes) {
  for (const [, pattern] of routes) {
    let re = indexed.get(pattern);
    if (!re) { re = new RegExp(pattern.source, pattern.flags + 'd'); indexed.set(pattern, re); }
    const m = re.exec(pathname);
    if (!m) continue;
    const spans = m.indices.slice(1).filter(Boolean).sort((a, b) => a[0] - b[0]);
    let label = '', at = 0;
    for (const [start, end] of spans) {
      if (start < at) continue;
      label += pathname.slice(at, start) + ':param';
      at = end;
    }
    return label + pathname.slice(at);
  }
  return '(unknown route)';
}

/* Caps already reached, per isolate: "<kind>" or "<kind>:anon" on a UTC day. Once a cap is
   reached, nothing more is written that day, so the count (up to 500 rows) is not run again. */
const full = new Set();
const fullKey = (kind, anon, now) => `${kind}${anon ? ':anon' : ''}@${dayStart(now)}`;

/** Record one error. Never throws. */
export async function logError(db, { method = '', route = '', status = 500, message = '', userId = null }, now = Date.now()) {
  // callers pass a label from routeLabel (or a fixed name for CRON and BROWSER rows)
  const kind = kindOf({ method, status });
  const anonCap = userId === null ? ANON_CAPS[kind] ?? null : null;
  try {
    if (full.has(fullKey(kind, false, now)) || (anonCap !== null && full.has(fullKey(kind, true, now)))) return;
    const res = await db.prepare(
      `INSERT INTO error_log (at, method, route, status, message, user_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT count(*) FROM error_log WHERE at >= ?7 AND ${KIND_SQL} = ?9) < ?8
         AND (?10 IS NULL OR (SELECT count(*) FROM error_log WHERE at >= ?7 AND ${KIND_SQL} = ?9 AND user_id IS NULL) < ?10)`,
    ).bind(now, String(method).slice(0, 8), String(route).slice(0, 200), status, String(message).slice(0, 500), userId, dayStart(now), CAPS[kind], kind, anonCap).run();
    if (res?.meta?.changes === 0) {
      // Refused: find which cap was reached, and remember it for the day.
      const row = await db.prepare(`SELECT count(*) AS n, count(user_id) AS signed FROM error_log WHERE at >= ? AND ${KIND_SQL} = ?`).bind(dayStart(now), kind).first();
      if (row.n >= CAPS[kind]) full.add(fullKey(kind, false, now));
      else if (anonCap !== null && row.n - row.signed >= anonCap) full.add(fullKey(kind, true, now));
      if (full.size > 64) full.clear();
    }
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
            count(DISTINCT user_id) AS users, count(*) - count(user_id) AS anon
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

/** The kinds the crash reporter sends (src/core/report.ts). Any other kind is refused, so a kind cannot pose as a label. */
const BROWSER_KINDS = ['error', 'rejection', 'react'];
/** A page path as location.pathname gives it: no scheme, host or spaces, so a report cannot carry a link. */
const PAGE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&()*+,;=@%\/]{0,199}$/;

/** A crash in someone's browser: {message, where, kind}. Signed in only: a few an hour each. */
export async function reportBrowserError(request, env, now = Date.now()) {
  const userId = await requireUser(request, env);
  const body = await readJson(request);
  const message = text(body?.message, 500);
  if (!message) throw new HttpError(400, { error: 'invalid', field: 'message' });
  const kind = body?.kind ?? '';
  if (kind !== '' && !BROWSER_KINDS.includes(kind)) throw new HttpError(400, { error: 'invalid', field: 'kind' });
  const where = body?.where ?? '';
  if (where !== '' && !(typeof where === 'string' && PAGE_PATH.test(where))) throw new HttpError(400, { error: 'invalid', field: 'where' });
  const wait = await claimLimit(env.DB, `browser-error:${userId}`, BROWSER_PER_HOUR, now, HOUR_MS);
  if (wait) throw rateLimited(wait);
  await logError(env.DB, { method: 'BROWSER', route: where, status: 0, message: (kind ? kind + ': ' : '') + message, userId }, now);
}

export const errorRoutes = [
  ['POST', /^\/api\/errors$/, async ({ request, env }) => { await reportBrowserError(request, env); return new Response(null, { status: 204 }); }],
];
