// The study leaderboard: total study minutes this week and all-time for every user
// who has joined it. Opt-in both ways: a user who has not joined sees nobody.
import { HttpError } from './http.js';
import { DAY_MS } from './time.js';


/* The viewer's Monday 00:00, from their browser. A week back is at most 7 days
   (plus a day of time-zone slack), so a bad value cannot turn this into all-time. */
function weekStart(raw, now) {
  const since = /^\d{1,16}$/.test(raw || '') ? Number(raw) : NaN;
  if (!Number.isSafeInteger(since) || since < now - 8 * DAY_MS || since > now + DAY_MS) throw new HttpError(400, { error: 'invalid', field: 'since' });
  return since;
}

const TOTALS = `SELECT u.id, CASE WHEN u.display_name <> '' THEN u.display_name ELSE u.username END AS name,
    COALESCE(SUM(CASE WHEN s.started_at >= ?1 THEN s.study_minutes END), 0) AS week,
    COALESCE(SUM(s.study_minutes), 0) AS total
  FROM users AS u LEFT JOIN study_sessions AS s ON s.user_id = u.id AND s.deleted_at IS NULL
  WHERE u.leaderboard = 1 GROUP BY u.id ORDER BY total DESC LIMIT 200`;

/** {joined, week, all}: each list is [{name, minutes, me}], most minutes first. */
export async function leaderboard(db, userId, rawSince, now = Date.now()) {
  const since = weekStart(rawSince, now);
  const me = await db.prepare('SELECT leaderboard FROM users WHERE id = ?').bind(userId).first();
  if (!me?.leaderboard) return { joined: false, week: [], all: [] };
  const { results } = await db.prepare(TOTALS).bind(since).all();
  const list = (key) => results
    .map((r) => ({ name: r.name, minutes: r[key], me: r.id === userId }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  return { joined: true, week: list('week'), all: list('total') };
}

export async function setJoined(db, userId, joined) {
  if (typeof joined !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'joined' });
  await db.prepare('UPDATE users SET leaderboard = ? WHERE id = ?').bind(joined ? 1 : 0, userId).run();
}
