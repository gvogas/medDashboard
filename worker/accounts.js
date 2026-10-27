// What deleting an account does, shared by the Admin page (worker/admin.js, through
// worker/leaving.js handOnStmts) and scripts/add-user.mjs, so no imports: the script runs it
// under Node. Both run DELETE_ACCOUNT (below), so what a deletion does lives here once.
//
// HAND_ON takes the account off its live projects' tasks and passes the spaces it owns on
// (spec §13); ?1 is the user id, ?2 now.
// ACCOUNT_TABLES lists each table with how its rows name their owner (?1 is the user id), in
// an order the foreign keys accept. Courses, items and the change feed belong to the scope
// 'u:<id>', which no foreign key follows, so they are listed here. The user row's deletion
// cascades to its Spotify attempts, memberships, invites, marks, space prefs and push devices.
// Activity about the account goes; activity it took part in keeps its name in detail.by. Its
// inbox_seen row goes by ON DELETE CASCADE.

/* worker/spaces.js NEXT_SPACE_REVISION, copied (a test keeps them in step). */
export const NEXT_SPACE_REVISION =
  "(SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0), COALESCE((SELECT MAX(revision) FROM spaces), 0)) + 1)";

/* Activity's buckets and names (worker/activity.js imports them from here, so the hand-on's row
   below and the routes' rows read alike). `id` is SQL for a user id or a space id. */
export const BUCKET_MS = 600_000;
/* The bucket of the time `t` (SQL). D1 binds a JS number as a REAL, so it is made an integer first, or the division keeps its fraction and nothing coalesces. */
export const BUCKET = (t) => `(CAST(${t} AS INTEGER) / ${BUCKET_MS})`;
/** A user's display name, in SQL, where the user row is aliased `u`. */
export const DISPLAY_NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";
/** The same for the user whose id is the SQL `id`. */
export const NAME = (id) => `(SELECT ${DISPLAY_NAME} FROM users AS u WHERE u.id = ${id})`;
/** A friendship's key: the smaller id first. */
export const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);
/** A space's name now: its class course's, or its project item's title. */
export const SPACE_NAME = (id) => `(SELECT CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
  ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END FROM spaces AS s WHERE s.id = ${id})`;

/* The live spaces ?1 owns, in SQL, with `extra` (an SQL condition on `ow.space_id`) also met. */
const OWNED = (extra) => `(SELECT ow.space_id FROM members AS ow JOIN spaces AS os ON os.id = ow.space_id
  WHERE ow.user_id = ?1 AND ow.role = 'owner' AND ow.deleted_at IS NULL AND os.deleted_at IS NULL AND ${extra})`;
const OTHERS = 'EXISTS (SELECT 1 FROM members AS oo WHERE oo.space_id = ow.space_id AND oo.user_id != ?1 AND oo.deleted_at IS NULL)';

/**
 * Before an account is deleted, in the same transaction: it is taken off its projects' tasks;
 * each space it owns passes to its longest-standing editor, else its longest-standing member
 * (demoted before promoted, for the one-owner index); one with nobody else in it is soft-deleted with its invites. Every space
 * it is in moves its revision on, so the others' member lists refresh. Set-based, with the
 * heir chosen inside the batch, so nobody leaving or joining in between can leave a class
 * without an owner. Only ?1 and ?2 appear, nowhere inside a string literal.
 */
export const HAND_ON = [
  /* Off every task's assignees in the live projects ?1 is in (spec §13), first, while the
     memberships are live; a task left with nobody is unassigned (the trigger says so). */
  `UPDATE items SET assignees = (SELECT json_group_array(a.value) FROM json_each(items.assignees) AS a WHERE a.value != ?1),
      updated_by = ?1, updated_at = ?2, revision = revision + 1
    WHERE scope IN (SELECT 'p:' || pm.space_id FROM members AS pm JOIN spaces AS ps ON ps.id = pm.space_id AND ps.deleted_at IS NULL
        WHERE pm.user_id = ?1 AND pm.deleted_at IS NULL) AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM json_each(items.assignees) AS a WHERE a.value = ?1)`,
  `UPDATE spaces SET revision = ${NEXT_SPACE_REVISION}, updated_at = ?2
    WHERE deleted_at IS NULL AND id IN (SELECT space_id FROM members WHERE user_id = ?1 AND deleted_at IS NULL)`,
  `DELETE FROM invites WHERE space_id IN ${OWNED(`NOT ${OTHERS}`)}`,
  `UPDATE spaces SET deleted_at = ?2, updated_at = ?2 WHERE id IN ${OWNED(`NOT ${OTHERS}`)}`,
  `UPDATE members SET role = 'editor', updated_at = ?2, revision = revision + 1
    WHERE user_id = ?1 AND space_id IN ${OWNED(OTHERS)}`,
  /* In each live space ?1 is still in that is now left with no owner, the heir: the first live
     member other than ?1, editors before members, then by joined_at, a tie falling to user_id. */
  `UPDATE members AS h SET role = 'owner', updated_at = ?2, revision = h.revision + 1
    WHERE h.deleted_at IS NULL AND h.user_id = (SELECT o.user_id FROM members AS o WHERE o.space_id = h.space_id AND o.user_id != ?1 AND o.deleted_at IS NULL
        ORDER BY o.role = 'member', o.joined_at, o.user_id LIMIT 1)
      AND EXISTS (SELECT 1 FROM members AS d JOIN spaces AS ds ON ds.id = d.space_id WHERE d.space_id = h.space_id AND d.user_id = ?1 AND d.deleted_at IS NULL AND ds.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM members AS w WHERE w.space_id = h.space_id AND w.role = 'owner' AND w.deleted_at IS NULL)`,
  /* space.transferred (spec §12) in each space just handed on, about the heir, with ?1 as the
     actor: ?1 demoted and the heir promoted in this batch. Before the user row goes, so the
     names still read; worker/activity.js noteStmt's row, set-based. */
  `INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, detail, bucket, at)
    SELECT h.space_id, ?1, 'space.transferred', '', h.user_id,
      json_object('by', ${NAME('?1')}, 'whom', ${NAME('h.user_id')}, 'space', ${SPACE_NAME('h.space_id')}),
      ${BUCKET('?2')}, ?2
    FROM members AS h WHERE h.role = 'owner' AND h.deleted_at IS NULL AND h.updated_at = ?2 AND h.user_id != ?1
      AND EXISTS (SELECT 1 FROM members AS d WHERE d.space_id = h.space_id AND d.user_id = ?1 AND d.role = 'editor' AND d.deleted_at IS NULL AND d.updated_at = ?2)
    ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET n = activity.n + 1, at = excluded.at, detail = excluded.detail`,
];

export const ACCOUNT_TABLES = [
  ['activity', 'subject_user = ?1'],
  ['achievements', 'user_id = ?1'],
  ['study_sessions', 'user_id = ?1'],
  ['items', "scope = 'u:' || ?1"],
  ['quotes', 'user_id = ?1'],
  ['courses', "scope = 'u:' || ?1"],
  ['spotify_tokens', 'user_id = ?1'],
  ['changes', "scope = 'u:' || ?1"],
];

/** Whether ?1 is the only admin left (a row when so): neither the Admin page nor the script may delete it. */
export const LAST_ADMIN = 'SELECT 1 AS x FROM users WHERE id = ?1 AND is_admin = 1 AND (SELECT count(*) FROM users WHERE is_admin = 1) <= 1';

/** Deletes a username's sign-in lock rows (the name itself and its `name#device` ones); `name` is SQL. Not LIKE: `_` is a wildcard there. */
export const UNLOCK = (name) => `DELETE FROM login_throttle WHERE username = ${name} OR substr(username, 1, length(${name}) + 1) = ${name} || '#'`;

/*
 * Every statement of an account's deletion, in order, for one batch: ?1 the user id, ?2 now,
 * ?3 the username, ?4 who did it (the admin's username, or 'cli'), ?5 a note for the audit log.
 * It ends with the audit entry, so a deletion that fails leaves none.
 */
export const DELETE_ACCOUNT = [
  ...HAND_ON,
  ...ACCOUNT_TABLES.map(([table, owner]) => `DELETE FROM ${table} WHERE ${owner}`),
  'DELETE FROM users WHERE id = ?1',
  UNLOCK('?3'),
  "DELETE FROM request_limits WHERE key IN ('api:' || ?1, 'spotify:' || ?1, 'outline:' || ?1, 'invite:' || ?1, 'join:' || ?1)",
  "INSERT INTO admin_log (at, admin, action, target, detail) VALUES (?2, ?4, 'delete', ?3, ?5)",
];
