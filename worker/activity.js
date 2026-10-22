// Activity (spec §12): the rows routes write for member and space events (the triggers in
// migrations/0001_schema.sql write the rest), and the reads: your inbox, its unread count,
// and a space's Activity tab. Nothing is fanned out: the inbox is a query over the spaces you
// are in and the rows about you.
import { memberGuard, assertAllowed } from './access.js';
import { BUCKET, BUCKET_MS, NAME, SPACE_NAME } from './accounts.js';
import { UNREAD_CAP } from '../src/core/shared.ts';

export { BUCKET_MS, SPACE_NAME };

/**
 * An activity row a route writes in its own batch (Decision 9): who did what in a space, about
 * whom. `when` is SQL that holds only if the act happened in this batch, using ?9 onwards for
 * `binds`; ?1 the space, ?2 the actor, ?4 the person it is about, ?8 now. detail gains the
 * actor's and the person's names and the space's name as they are now.
 */
export function noteStmt(db, { spaceId, actorId, verb, subjectUser = '', oldValue = null, newValue = null, detail = {}, now, when = '1', binds = [] }) {
  return db.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
    SELECT ?1, ?2, ?3, '', ?4, ?5, ?6, json_set(?7, '$.by', ${NAME('?2')}, '$.whom', ${NAME('?4')}, '$.space', ${SPACE_NAME('?1')}), ${BUCKET('?8')}, ?8
    WHERE ${when}
    ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET
      new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail`)
    .bind(spaceId, actorId, verb, subjectUser, oldValue, newValue, JSON.stringify(detail), now, ...binds);
}

/**
 * For a route row that can be undone (a role, archiving; spec §12 "a change that returns to
 * where it started deletes its row"): after noteStmt in the same batch, deletes the row its
 * coalescing brought back to its first "from". A "from" of '' matches a NULL "to" (an unlink).
 */
export const undoneStmt = (db, { spaceId, actorId, verb, subjectUser = '', now }) => db.prepare(`DELETE FROM activity
  WHERE space_id = ? AND actor_id = ? AND verb = ? AND subject = '' AND subject_user = ? AND bucket = ${BUCKET('?')}
    AND old_value IS NOT NULL AND old_value = COALESCE(new_value, '')`).bind(spaceId, actorId, verb, subjectUser, now);

/* Verbs every member is told of; the rest reach someone only when they are about them (Decision 4). a = activity, ?1 you. */
const CONCERNS = `(a.verb IN ('item.created', 'item.deleted', 'item.date', 'course.meetings', 'space.archived', 'space.linked')
  OR (a.verb = 'task.assigned' AND a.subject_user = '')
  OR (a.verb = 'task.status' AND EXISTS (SELECT 1 FROM json_each(a.detail, '$.assignees') AS j WHERE j.value IN (?1, '*'))))`;
const COLS = 'a.seq, a.space_id, a.actor_id, a.verb, a.subject, a.subject_user, a.old_value, a.new_value, a.detail, a.n, a.at';
/** How long activity is kept (spec §12): the reads hold to it, so the window does not wait on the nightly purge. */
export const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
/*
 * The inbox's newest `limit` rows above `since` (SQL) from each branch: about you anywhere,
 * and what concerns you in your live spaces since you joined; ?2 is now. The first branch
 * repeats `subject_user != ''` (implied by `= ?1`, as a user id is never empty) so SQLite
 * may use the partial index activity_about; with only the bound `= ?1` it cannot prove the
 * index's WHERE and scans the table by seq.
 */
export const INBOX = (since, limit) => `SELECT * FROM (SELECT ${COLS} FROM activity AS a
    WHERE a.subject_user = ?1 AND a.subject_user != '' AND a.actor_id != ?1 AND a.seq > ${since} AND a.at > ?2 - ${KEEP_MS}
    ORDER BY a.seq DESC LIMIT ${limit})
  UNION ALL
  SELECT * FROM (SELECT ${COLS} FROM members AS m JOIN spaces AS sp ON sp.id = m.space_id AND sp.deleted_at IS NULL
      JOIN activity AS a ON a.space_id = m.space_id AND a.seq > ${since} AND a.at >= m.joined_at
    WHERE m.user_id = ?1 AND m.deleted_at IS NULL AND a.actor_id != ?1 AND a.subject_user != ?1 AND a.at > ?2 - ${KEEP_MS} AND ${CONCERNS}
    ORDER BY a.seq DESC LIMIT ${limit})`;
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
export async function inboxRows(db, userId, now = Date.now()) {
  const [rows, seen] = await db.batch([
    db.prepare(`SELECT x.*, COALESCE(${SPACE_NAME('x.space_id')}, json_extract(x.detail, '$.space')) AS space,
        (SELECT kind FROM spaces WHERE id = x.space_id) AS kind
      FROM (${INBOX('0', 50)}) AS x ORDER BY x.seq DESC LIMIT 50`).bind(userId, now),
    db.prepare(`SELECT ${SEEN} AS seq`).bind(userId),
  ]);
  return { items: rows.results.map((r) => toApi(r, userId)), seen: seen.results[0].seq };
}

/** Unread (Decision 5): pending unexpired invites to live spaces plus inbox rows above what you read; at most UNREAD_CAP (99). */
export async function unreadCount(db, userId, now = Date.now()) {
  const r = await db.prepare(`SELECT MIN(${UNREAD_CAP},
      (SELECT count(*) FROM invites AS i JOIN spaces AS s ON s.id = i.space_id AND s.deleted_at IS NULL
        WHERE i.user_id = ?1 AND i.status = 'pending' AND i.expires_at > ?2)
      + (SELECT count(*) FROM friendships WHERE (user_lo = ?1 OR user_hi = ?1) AND status = 'pending' AND requested_by != ?1)
      + (SELECT count(*) FROM (SELECT 1 FROM (${INBOX(SEEN, UNREAD_CAP + 1)}) LIMIT ${UNREAD_CAP + 1}))) AS n`).bind(userId, now).first();
  return r.n;
}

/** You have read up to `seq`: forward only, never past the newest row there is. */
export function markSeen(db, userId, seq) {
  return db.prepare(`INSERT INTO inbox_seen (user_id, seq) VALUES (?1, MIN(?2, COALESCE((SELECT MAX(seq) FROM activity), 0)))
    ON CONFLICT (user_id) DO UPDATE SET seq = MAX(inbox_seen.seq, excluded.seq)`).bind(userId, seq).run();
}

export const PAGE = 30;
/** A space's Activity tab (Decision 7): 30 rows below `before` (all when null) within the 90 days kept, newest first, for a live member. 404 outside it. */
export async function spaceActivity(db, userId, spaceId, before = null, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  const g = memberGuard(spaceId, userId);
  const { results } = await db.prepare(`SELECT ${COLS} FROM activity AS a WHERE a.space_id = ? AND a.seq < ? AND a.at > ? AND ${g.sql}
    ORDER BY a.seq DESC LIMIT ?`).bind(spaceId, before ?? Number.MAX_SAFE_INTEGER, now - KEEP_MS, ...g.binds, PAGE + 1).all();
  return { items: results.slice(0, PAGE).map((r) => toApi({ ...r, kind: me.kind }, userId)), more: results.length > PAGE };
}
