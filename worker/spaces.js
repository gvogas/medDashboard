// Space rows (migrations/0002_spaces.sql). Stage 3 adds the routes that create and change them.

/**
 * The next space revision: above the change feed's head and above every space's own, so a
 * space whose row or members changed is always above the `sv` a client sends, even when no
 * course or item was written in between (spec §3, §6).
 */
export const NEXT_SPACE_REVISION =
  "(SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0), COALESCE((SELECT MAX(revision) FROM spaces), 0)) + 1)";

/** Move a space's revision on. Put it in the same batch as the change to the space or its members. */
export const touchSpace = (db, spaceId, now = Date.now()) =>
  db.prepare(`UPDATE spaces SET revision = ${NEXT_SPACE_REVISION}, updated_at = ? WHERE id = ?`).bind(now, spaceId);
