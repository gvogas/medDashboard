// The error log the Admin page reads: unexpected failures the Worker caught (500s,
// failed AI reads). Writing one must never fail the request it describes, and a bug
// that fails every request must not spend the day's free D1 writes, so at most
// DAILY_CAP rows are written per UTC day; the rest only reach Workers Logs.

export const DAILY_CAP = 500;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const dayStart = (now) => now - (now % (24 * 60 * 60 * 1000));

/** Record one error. Never throws. */
export async function logError(db, { method = '', route = '', status = 500, message = '', userId = null }, now = Date.now()) {
  try {
    await db.prepare(
      `INSERT INTO error_log (at, method, route, status, message, user_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT count(*) FROM error_log WHERE at >= ?7) < ?8`,
    ).bind(now, String(method).slice(0, 8), String(route).slice(0, 200), status, String(message).slice(0, 500), userId, dayStart(now), DAILY_CAP).run();
  } catch (e) {
    console.error('error_log:', e?.message || e);
  }
}

/** A message for the log: the error's own, without a stack. */
export const messageOf = (e) => String(e?.message || e || 'unknown').split('\n')[0];

/**
 * The errors since `since`, grouped by route and message, newest first:
 * [{method, route, status, message, count, last, first, users}].
 */
export async function errorGroups(db, since) {
  const { results } = await db.prepare(
    `SELECT method, route, status, message, count(*) AS count, max(at) AS last, min(at) AS first,
            count(DISTINCT user_id) AS users
     FROM error_log WHERE at >= ? GROUP BY method, route, status, message ORDER BY last DESC LIMIT 200`,
  ).bind(since).all();
  return results;
}

/** The latest errors one by one, with the username where there was one. */
export async function recentErrors(db, limit = 50) {
  const { results } = await db.prepare(
    `SELECT e.at, e.method, e.route, e.status, e.message, u.username
     FROM error_log AS e LEFT JOIN users AS u ON u.id = e.user_id ORDER BY e.at DESC LIMIT ?`,
  ).bind(limit).all();
  return results;
}

/** Nightly: forget errors older than 30 days. */
export async function purgeErrors(db, now = Date.now()) {
  await db.prepare('DELETE FROM error_log WHERE at < ?').bind(now - KEEP_MS).run();
}
