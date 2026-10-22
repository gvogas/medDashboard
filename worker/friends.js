// Friends (study together, spec ยง1): requests by username, search, the friends list and the
// two switches. One friendships row per pair, smaller id first (migrations/0006_friends.sql).
// Every check runs here on the server; the client hides buttons only for convenience.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { claimLimit, rateLimited } from './limits.js';
import { normalizeUsername } from './password.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const FRIEND_LIMIT = 200;
/** Requests one person may send in a day, and searches in a minute. */
export const REQUEST_LIMIT = 20;
export const SEARCH_LIMIT = 30;
export const RESULTS = 8;
export const DECLINE_KEEP_MS = 30 * DAY_MS;
const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";

/** The pair's key: smaller id first. */
export const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);
/* the other person in a row read with ?1 = me */
const OTHER = 'CASE WHEN f.user_lo = ?1 THEN f.user_hi ELSE f.user_lo END';

const person = (r) => ({ userId: r.id, username: r.username, name: r.name });

/** {friends, incoming, sent, settings}: names as they are now, newest first. */
export async function listFriends(db, userId) {
  const [rows, settings] = await db.batch([
    db.prepare(`SELECT u.id, u.username, ${NAME} AS name, f.status, f.requested_by, f.created_at, f.accepted_at
      FROM friendships AS f JOIN users AS u ON u.id = ${OTHER}
      WHERE (f.user_lo = ?1 OR f.user_hi = ?1) AND (f.status != 'declined' OR f.requested_by = ?1)
      ORDER BY COALESCE(f.accepted_at, f.created_at) DESC`).bind(userId),
    db.prepare('SELECT findable, show_studying FROM friend_settings WHERE user_id = ?').bind(userId),
  ]);
  const out = { friends: [], incoming: [], sent: [] };
  for (const r of rows.results) {
    if (r.status === 'accepted') out.friends.push({ ...person(r), since: r.accepted_at });
    /* a decline reads as still waiting to the one who asked (spec ยง1) */
    else if (r.requested_by === userId) out.sent.push({ ...person(r), at: r.created_at });
    else out.incoming.push({ ...person(r), at: r.created_at });
  }
  const s = settings.results[0];
  return { ...out, settings: { findable: s ? s.findable === 1 : true, showStudying: s ? s.show_studying === 1 : true } };
}

/** Requests waiting for your answer, for the inbox: newest first. */
export async function incomingRequests(db, userId) {
  const { results } = await db.prepare(`SELECT u.id, u.username, ${NAME} AS name, f.created_at
    FROM friendships AS f JOIN users AS u ON u.id = f.requested_by
    WHERE (f.user_lo = ?1 OR f.user_hi = ?1) AND f.status = 'pending' AND f.requested_by != ?1
    ORDER BY f.created_at DESC LIMIT 50`).bind(userId).all();
  return results.map((r) => ({ ...person(r), at: r.created_at }));
}

export async function saveSettings(db, userId, body) {
  const { findable, showStudying } = body || {};
  if (typeof findable !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'findable' });
  if (typeof showStudying !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'showStudying' });
  await db.prepare(`INSERT INTO friend_settings (user_id, findable, show_studying) VALUES (?1, ?2, ?3)
    ON CONFLICT (user_id) DO UPDATE SET findable = ?2, show_studying = ?3`).bind(userId, findable ? 1 : 0, showStudying ? 1 : 0).run();
}

/** Drop declines older than 30 days (the nightly cron). */
export function purgeFriends(db, now = Date.now()) {
  return db.prepare("DELETE FROM friendships WHERE status = 'declined' AND declined_at < ?").bind(now - DECLINE_KEEP_MS).run();
}

const ROW = 'SELECT status, requested_by FROM friendships WHERE user_lo = ? AND user_hi = ?';
/* both still under the limit, checked inside the write */
const ROOM_FOR_BOTH = `(SELECT count(*) FROM friendships WHERE status = 'accepted' AND (user_lo = ?3 OR user_hi = ?3)) < ${FRIEND_LIMIT}
  AND (SELECT count(*) FROM friendships WHERE status = 'accepted' AND (user_lo = ?4 OR user_hi = ?4)) < ${FRIEND_LIMIT}`;

async function accept(db, me, other, now) {
  const [lo, hi] = pairOf(me, other);
  const done = await db.prepare(`UPDATE friendships SET status = 'accepted', accepted_at = ?5
    WHERE user_lo = ?1 AND user_hi = ?2 AND status = 'pending' AND requested_by = ?4 AND ${ROOM_FOR_BOTH}
    RETURNING user_lo`).bind(lo, hi, me, other, now).first();
  if (done) return;
  const row = await db.prepare(ROW).bind(lo, hi).first();
  if (row?.status === 'pending' && row.requested_by === other) throw new HttpError(409, { error: 'friend_limit' });
  throw new HttpError(404, { error: 'not_found' });
}

/** Ask someone by username; accepts instead when they already asked you. */
export async function requestFriend(db, me, body, now = Date.now()) {
  const wait = await claimLimit(db, `friend-req:${me}`, REQUEST_LIMIT, now, DAY_MS);
  if (wait) throw rateLimited(wait);
  const name = normalizeUsername(body?.username);
  const who = name && await db.prepare(`SELECT u.id, u.username, ${NAME} AS name FROM users AS u WHERE u.username = ?`).bind(name).first();
  if (!who) throw new HttpError(404, { error: 'no_user' });
  if (who.id === me) throw new HttpError(400, { error: 'invalid', field: 'username' });
  const [lo, hi] = pairOf(me, who.id);
  const row = await db.prepare(ROW).bind(lo, hi).first();
  const out = (state) => ({ ...person(who), state });
  if (row?.status === 'accepted') throw new HttpError(409, { error: 'friends' });
  if (row?.requested_by === who.id && row.status === 'pending') {
    try { await accept(db, me, who.id, now); return out('friends'); }
    catch (e) { if (e.status !== 404) throw e; /* they cancelled in between: ask afresh below */ }
  } else if (row?.requested_by === me) return out('requested');   /* waiting, or declined unseen */
  /* none, or they asked and I declined: a fresh request from me */
  const made = await db.prepare(`INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)
    ON CONFLICT (user_lo, user_hi) DO UPDATE SET requested_by = ?3, status = 'pending', created_at = ?4, declined_at = NULL
      WHERE friendships.status = 'declined' RETURNING user_lo`).bind(lo, hi, me, now).first();
  if (made) return out('requested');
  /* someone wrote the pair first: take what is there now */
  const current = await db.prepare(ROW).bind(lo, hi).first();
  if (current?.status === 'pending' && current.requested_by === who.id) { await accept(db, me, who.id, now); return out('friends'); }
  return out(current?.status === 'accepted' ? 'friends' : 'requested');
}

/** Accept or decline a request someone sent you. */
export async function answerFriend(db, me, other, body, now = Date.now()) {
  if (typeof body?.accept !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'accept' });
  if (body.accept) return accept(db, me, other, now);
  const [lo, hi] = pairOf(me, other);
  const done = await db.prepare(`UPDATE friendships SET status = 'declined', declined_at = ?4
    WHERE user_lo = ?1 AND user_hi = ?2 AND status = 'pending' AND requested_by = ?3 RETURNING user_lo`).bind(lo, hi, other, now).first();
  if (!done) throw new HttpError(404, { error: 'not_found' });
}

/** Remove a friend, or cancel a request you sent (seen or declined). */
export async function removeFriend(db, me, other) {
  const [lo, hi] = pairOf(me, other);
  const gone = await db.prepare(`DELETE FROM friendships WHERE user_lo = ?1 AND user_hi = ?2
    AND (status = 'accepted' OR requested_by = ?3) RETURNING user_lo`).bind(lo, hi, me).first();
  if (!gone) throw new HttpError(404, { error: 'not_found' });
}

const STATE = `CASE WHEN f.status = 'accepted' THEN 'friends'
  WHEN f.requested_by = ?1 THEN 'requested'
  WHEN f.status = 'pending' THEN 'asked' ELSE 'none' END`;

/** Up to 8 people matching `q` (2-40 characters) with where you stand with each. */
export async function searchPeople(db, me, raw, now = Date.now()) {
  const q = String(raw ?? '').trim().toLowerCase();
  if (q.length < 2 || q.length > 40) throw new HttpError(400, { error: 'invalid', field: 'q' });
  const wait = await claimLimit(db, `friend-search:${me}`, SEARCH_LIMIT, now);
  if (wait) throw rateLimited(wait);
  /* LIKE ignores case for ASCII letters only, so "ษ" does not match "้" */
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const { results } = await db.prepare(`SELECT u.id, u.username, ${NAME} AS name, ${STATE} AS state
    FROM users AS u
    LEFT JOIN friend_settings AS s ON s.user_id = u.id
    LEFT JOIN friendships AS f ON f.user_lo = min(?1, u.id) AND f.user_hi = max(?1, u.id)
    WHERE u.id != ?1 AND (u.username = ?2
      OR (COALESCE(s.findable, 1) = 1 AND (u.username LIKE ?3 ESCAPE '\\' OR u.display_name LIKE ?3 ESCAPE '\\')))
    ORDER BY u.username = ?2 DESC, name COLLATE NOCASE LIMIT ${RESULTS}`).bind(me, q, like).all();
  return { people: results.map((r) => ({ ...person(r), state: r.state })) };
}

const route = (path) => new RegExp(`^/api/${path}$`);

/* The fixed paths (settings, search) must stay before friends/([^/]{1,64}). */
export const friendRoutes = [
  ['GET', route('friends'), async ({ request, env }) => json(await listFriends(env.DB, await requireUser(request, env)))],
  ['PUT', route('friends/settings'), async ({ request, env }) => {
    await saveSettings(env.DB, await requireUser(request, env), await readJson(request));
    return new Response(null, { status: 204 });
  }],
  ['GET', route('friends/search'), async ({ request, env, url }) =>
    json(await searchPeople(env.DB, await requireUser(request, env), url.searchParams.get('q')))],
  ['POST', route('friends'), async ({ request, env }) =>
    json(await requestFriend(env.DB, await requireUser(request, env), await readJson(request)))],
  ['PUT', route('friends/([^/]{1,64})'), async ({ request, env, params: [other] }) => {
    await answerFriend(env.DB, await requireUser(request, env), other, await readJson(request));
    return new Response(null, { status: 204 });
  }],
  ['DELETE', route('friends/([^/]{1,64})'), async ({ request, env, params: [other] }) => {
    await removeFriend(env.DB, await requireUser(request, env), other);
    return new Response(null, { status: 204 });
  }],
];
