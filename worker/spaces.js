// Spaces (migrations/0002_spaces.sql) and what the class routes share: the gate, the limits,
// Worker-made ids, the space revision and a space's summary. Making a class, its details,
// roles and transfer follow below; invites and join codes are in worker/invites.js.
import { scopeOf } from './access.js';

/* Classes are open to admins only until Stage 6 (spec §22): the routes that make or join a
   space refuse anyone else, and an invite to anyone else is refused. Stage 6 sets this false. */
export const ADMINS_ONLY = true;
/** The most live spaces a person holds, and the most live members a space holds (spec §3 Limits). */
export const SPACE_LIMIT = 20;
export const MEMBER_LIMIT = 30;

/** A person's live spaces, counted in SQL; bind the user id. */
export const MY_SPACES = `(SELECT count(*) FROM members AS lm JOIN spaces AS ls ON ls.id = lm.space_id
  WHERE lm.user_id = ? AND lm.deleted_at IS NULL AND ls.deleted_at IS NULL)`;
/** A space's live members, counted in SQL; `space` is a column, or '?' to bind the id. */
export const LIVE_MEMBERS = (space) => `(SELECT count(*) FROM members AS sm WHERE sm.space_id = ${space} AND sm.deleted_at IS NULL)`;

/**
 * The next space revision: above the change feed's head and above every space's own, so a
 * space whose row or members changed is always above the `sv` a client sends, even when no
 * course or item was written in between (spec §3, §6).
 */
export const NEXT_SPACE_REVISION =
  "(SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0), COALESCE((SELECT MAX(revision) FROM spaces), 0)) + 1)";

/**
 * Move a space's revision on. Put it in the same batch as the change to the space or its
 * members; with `ifChanged`, only when the statement just before it changed a row.
 */
export const touchSpace = (db, spaceId, now = Date.now(), { ifChanged = false } = {}) =>
  db.prepare(`UPDATE spaces SET revision = ${NEXT_SPACE_REVISION}, updated_at = ? WHERE id = ?${ifChanged ? ' AND changes() > 0' : ''}`).bind(now, spaceId);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** An id the Worker makes: `n` characters of [a-z0-9], each equally likely. */
export function randomId(n = 12) {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 252 && out.length < n) out += ALPHABET[b % 36];
  }
  return out;
}

/** A space as the class routes answer it, for someone in it: {id, scope, kind, name, role, members}; null for anyone else. */
export async function spaceSummary(db, userId, spaceId) {
  const r = await db.prepare(`SELECT s.id, s.kind, m.role, ${LIVE_MEMBERS('s.id')} AS members,
      CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
        ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END AS name
    FROM spaces AS s JOIN members AS m ON m.space_id = s.id AND m.user_id = ? AND m.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL`).bind(userId, spaceId).first();
  return r ? { id: r.id, scope: scopeOf(r.kind, r.id), kind: r.kind, name: r.name ?? '', role: r.role, members: r.members } : null;
}
