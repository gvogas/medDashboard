// Who may do what in a shared space (spec §5). Every guard is a SQL fragment with its binds,
// run inside the statement that reads or writes, so there is no gap between the check and
// the act. A scope and a user id always come from the route and the session, never a body.
import { HttpError } from './http.js';

const SPACE_ID = /^[a-z0-9]{12}$/;
const PREFIX = { class: 'c', project: 'p' };

/**
 * 'u:<user id>' → {kind:'user', userId}; 'c:<space id>' → {kind:'class', spaceId};
 * 'p:<space id>' → {kind:'project', spaceId}; anything else null. A scope is at most 40
 * characters (the schema's CHECK) and never holds a comma (sync's cursor list).
 */
export function parseScope(scope) {
  if (typeof scope !== 'string' || scope.length > 40) return null;
  const prefix = scope.slice(0, 2), rest = scope.slice(2);
  if (prefix === 'u:') return rest && !/[\u0000-\u001f\u007f,]/.test(rest) ? { kind: 'user', userId: rest } : null;
  if ((prefix === 'c:' || prefix === 'p:') && SPACE_ID.test(rest)) return { kind: prefix === 'c:' ? 'class' : 'project', spaceId: rest };
  return null;
}

/** The scope of a space's rows. */
export const scopeOf = (kind, spaceId) => `${PREFIX[kind]}:${spaceId}`;

/* Live membership of a live space, plus what the action needs. */
const guard = (extra) => (spaceId, userId) => ({
  sql: `EXISTS (SELECT 1 FROM members AS gm JOIN spaces AS gs ON gs.id = gm.space_id
    WHERE gm.space_id = ? AND gm.user_id = ? AND gm.deleted_at IS NULL AND gs.deleted_at IS NULL${extra})`,
  binds: [spaceId, userId],
});
/** Reading a space: any live member, archived or not. */
export const memberGuard = guard('');
/** A member's own writes (completing a task): any live member of an unarchived space. */
export const writerGuard = guard(' AND gs.archived = 0');
/** Shared facts: the owner or an editor of an unarchived space. */
export const editorGuard = guard(" AND gs.archived = 0 AND gm.role IN ('owner', 'editor')");
/** The owner's own acts on an unarchived space: codes, roles, inviting with another role, handing it on. */
export const ownerGuard = guard(" AND gs.archived = 0 AND gm.role = 'owner'");
/** The owner's management of the space, archived or not: roles, transfer, removing, archiving (Stage 5 plan, Decision 4). */
export const keeperGuard = guard(" AND gm.role = 'owner'");

/** {kind, role, archived} of this person in the space, or null outside it (or if it is deleted). */
export async function roleOf(db, userId, spaceId) {
  const r = await db.prepare(`SELECT s.kind, s.archived, m.role FROM members AS m JOIN spaces AS s ON s.id = m.space_id
    WHERE m.space_id = ? AND m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL`).bind(spaceId, userId).first();
  return r ? { kind: r.kind, role: r.role, archived: r.archived === 1 } : null;
}

/**
 * Throws the answer a refused action gets: 404 to someone outside the space (ids reveal
 * nothing), 403 archived for a write to an archived space, 403 forbidden for a member
 * asking for an editor's action. `need` is 'read', 'write' or 'editor'. Returns the role
 * when the action is allowed, so a caller can look for another cause of a miss.
 */
export async function assertAllowed(db, userId, spaceId, need) {
  const r = await roleOf(db, userId, spaceId);
  if (!r) throw new HttpError(404, { error: 'not_found' });
  if (need === 'read') return r;
  if (r.archived) throw new HttpError(403, { error: 'archived' });
  if (need === 'editor' && r.role === 'member') throw new HttpError(403, { error: 'forbidden' });
  return r;
}

/** As assertAllowed(…, 'editor'), and 403 forbidden for anyone in the space but its owner. */
export async function assertOwner(db, userId, spaceId) {
  const r = await assertAllowed(db, userId, spaceId, 'editor');
  if (r.role !== 'owner') throw new HttpError(403, { error: 'forbidden' });
  return r;
}

/** 404 outside the space, 403 forbidden for anyone in it but its owner; archived or not. */
export async function assertKeeper(db, userId, spaceId) {
  const r = await assertAllowed(db, userId, spaceId, 'read');
  if (r.role !== 'owner') throw new HttpError(403, { error: 'forbidden' });
  return r;
}
