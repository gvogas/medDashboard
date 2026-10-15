// Activity (spec §12): the rows routes write for member and space events (the triggers in
// migrations/0005_activity.sql write the rest), and the reads: your inbox, its unread count,
// and a space's Activity tab. Nothing is fanned out: the inbox is a query over the spaces you
// are in and the rows about you.
import { memberGuard, assertAllowed } from './access.js';

export const BUCKET_MS = 600_000;
const NAME = (id) => `(SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = ${id})`;
/** A space's name now: its class course's, or its project item's title. `id` is SQL for the space id. */
export const SPACE_NAME = (id) => `(SELECT CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
  ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END FROM spaces AS s WHERE s.id = ${id})`;

/**
 * An activity row a route writes in its own batch (Decision 9): who did what in a space, about
 * whom. `when` is SQL that holds only if the act happened in this batch, using ?9 onwards for
 * `binds`; ?1 the space, ?2 the actor, ?4 the person it is about, ?8 now. detail gains the
 * actor's and the person's names and the space's name as they are now.
 */
export function noteStmt(db, { spaceId, actorId, verb, subjectUser = '', oldValue = null, newValue = null, detail = {}, now, when = '1', binds = [] }) {
  return db.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
    SELECT ?1, ?2, ?3, '', ?4, ?5, ?6, json_set(?7, '$.by', ${NAME('?2')}, '$.whom', ${NAME('?4')}, '$.space', ${SPACE_NAME('?1')}), ?8 / ${BUCKET_MS}, ?8
    WHERE ${when}
    ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET
      new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail`)
    .bind(spaceId, actorId, verb, subjectUser, oldValue, newValue, JSON.stringify(detail), now, ...binds);
}

/* Verbs every member is told of; the rest reach someone only when they are about them (Decision 4). a = activity, ?1 you. */
const CONCERNS = `(a.verb IN ('item.created', 'item.deleted', 'item.date', 'course.meetings', 'space.archived', 'space.linked')
  OR (a.verb = 'task.assigned' AND a.subject_user = '')
  OR (a.verb = 'task.status' AND EXISTS (SELECT 1 FROM json_each(a.detail, '$.assignees') AS j WHERE j.value IN (?1, '*'))))`;
const COLS = 'a.seq, a.space_id, a.actor_id, a.verb, a.subject, a.subject_user, a.old_value, a.new_value, a.detail, a.n, a.at';
/* The inbox's rows above `since` (SQL): about you anywhere, and what concerns you in your live spaces since you joined. */
const INBOX = (since) => `SELECT ${COLS} FROM activity AS a WHERE a.subject_user = ?1 AND a.actor_id != ?1 AND a.seq > ${since}
  UNION ALL
  SELECT ${COLS} FROM members AS m JOIN activity AS a ON a.space_id = m.space_id AND a.seq > ${since} AND a.at >= m.joined_at
  WHERE m.user_id = ?1 AND m.deleted_at IS NULL AND a.actor_id != ?1 AND a.subject_user != ?1 AND ${CONCERNS}`;
const SEEN = '(SELECT COALESCE(MAX(seq), 0) FROM inbox_seen WHERE user_id = ?1)';

/** A row as the API answers it; `about` is whether it is about you. */
export function toApi(r, userId) {
  const detail = JSON.parse(r.detail);
  return {
    seq: r.seq, spaceId: r.space_id, space: r.space ?? detail.space ?? '', kind: r.kind ?? null, verb: r.verb, subject: r.subject,
    actor: r.actor_id, subjectUser: r.subject_user, about: r.subject_user === userId,
    old: r.old_value, new: r.new_value, detail, n: r.n, at: r.at,
  };
}

/** Your inbox's newest 50 rows within the 90 days kept, and where you have read up to. */
export async function inboxRows(db, userId) {
  const [rows, seen] = await db.batch([
    db.prepare(`SELECT x.*, COALESCE(${SPACE_NAME('x.space_id')}, json_extract(x.detail, '$.space')) AS space,
        (SELECT kind FROM spaces WHERE id = x.space_id) AS kind
      FROM (${INBOX('0')}) AS x ORDER BY x.seq DESC LIMIT 50`).bind(userId),
    db.prepare(`SELECT ${SEEN} AS seq`).bind(userId),
  ]);
  return { items: rows.results.map((r) => toApi(r, userId)), seen: seen.results[0].seq };
}

/** Unread (Decision 5): pending unexpired invites to live spaces plus inbox rows above what you read; at most 99. */
export async function unreadCount(db, userId, now = Date.now()) {
  const r = await db.prepare(`SELECT MIN(99,
      (SELECT count(*) FROM invites AS i JOIN spaces AS s ON s.id = i.space_id AND s.deleted_at IS NULL
        WHERE i.user_id = ?1 AND i.status = 'pending' AND i.expires_at > ?2)
      + (SELECT count(*) FROM (SELECT 1 FROM (${INBOX(SEEN)}) LIMIT 100))) AS n`).bind(userId, now).first();
  return r.n;
}

/** You have read up to `seq`: forward only, never past the newest row there is. */
export function markSeen(db, userId, seq) {
  return db.prepare(`INSERT INTO inbox_seen (user_id, seq) VALUES (?1, MIN(?2, COALESCE((SELECT MAX(seq) FROM activity), 0)))
    ON CONFLICT (user_id) DO UPDATE SET seq = MAX(inbox_seen.seq, excluded.seq)`).bind(userId, seq).run();
}

export const PAGE = 30;
/** A space's Activity tab (Decision 7): 30 rows below `before` (all when null), newest first, for a live member. 404 outside it. */
export async function spaceActivity(db, userId, spaceId, before = null) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  const g = memberGuard(spaceId, userId);
  const { results } = await db.prepare(`SELECT ${COLS} FROM activity AS a WHERE a.space_id = ? AND a.seq < ? AND ${g.sql}
    ORDER BY a.seq DESC LIMIT ?`).bind(spaceId, before ?? Number.MAX_SAFE_INTEGER, ...g.binds, PAGE + 1).all();
  return { items: results.slice(0, PAGE).map((r) => toApi({ ...r, kind: me.kind }, userId)), more: results.length > PAGE };
}
