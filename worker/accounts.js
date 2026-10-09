// What deleting an account does, shared by the Admin page (worker/admin.js, through
// worker/leaving.js handOnStmts) and scripts/add-user.mjs, so no imports: the script runs it
// under Node. Both run HAND_ON, then the ACCOUNT_TABLES deletes, then the user row's.
//
// HAND_ON passes the spaces the account owns on (spec §13); ?1 is the user id, ?2 now.
// ACCOUNT_TABLES lists each table with how its rows name their owner (?1 is the user id), in
// an order the foreign keys accept. Courses, items and the change feed belong to the scope
// 'u:<id>', which no foreign key follows, so they are listed here. The user row's deletion
// cascades to its Spotify attempts, memberships, invites, marks and space prefs.

/* worker/spaces.js NEXT_SPACE_REVISION, copied (a test keeps them in step). */
export const NEXT_SPACE_REVISION =
  "(SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0), COALESCE((SELECT MAX(revision) FROM spaces), 0)) + 1)";

/* The live spaces ?1 owns, in SQL, with `extra` (an SQL condition on `ow.space_id`) also met. */
const OWNED = (extra) => `(SELECT ow.space_id FROM members AS ow JOIN spaces AS os ON os.id = ow.space_id
  WHERE ow.user_id = ?1 AND ow.role = 'owner' AND ow.deleted_at IS NULL AND os.deleted_at IS NULL AND ${extra})`;
const OTHERS = 'EXISTS (SELECT 1 FROM members AS oo WHERE oo.space_id = ow.space_id AND oo.user_id != ?1 AND oo.deleted_at IS NULL)';

/**
 * Before an account is deleted, in the same transaction: each space it owns passes to its
 * longest-standing editor, else its longest-standing member (demoted before promoted, for the
 * one-owner index); one with nobody else in it is soft-deleted with its invites. Every space
 * it is in moves its revision on, so the others' member lists refresh. Set-based, with the
 * heir chosen inside the batch, so nobody leaving or joining in between can leave a class
 * without an owner. Only ?1 and ?2 appear, nowhere inside a string literal.
 */
export const HAND_ON = [
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
];

export const ACCOUNT_TABLES = [
  ['achievements', 'user_id = ?1'],
  ['study_sessions', 'user_id = ?1'],
  ['items', "scope = 'u:' || ?1"],
  ['quotes', 'user_id = ?1'],
  ['courses', "scope = 'u:' || ?1"],
  ['spotify_tokens', 'user_id = ?1'],
  ['changes', "scope = 'u:' || ?1"],
];
