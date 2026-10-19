// Team projects (spec §10): one 'project' item and its tasks in a 'p:' scope. Making one,
// linking it to a class assignment, leaving it or being removed (no copy: the rows are the
// team's), and deleting it. Tasks themselves are ordinary shared writes (worker/db.js), whose
// member rules have been there since Stage 2. Open to everyone since Stage 10.
import { HttpError } from './http.js';
import { assertKeeper, assertOwner, keeperGuard, memberGuard, ownerGuard } from './access.js';
import { MY_SPACES, NEXT_ROW_REVISION, NEXT_SPACE_REVISION, SPACE_LIMIT, joinPrefs, randomId, spaceSummary, touchSpace } from './spaces.js';
import { BUCKET, NAME } from './accounts.js';
import { SPACE_NAME, noteStmt, undoneStmt } from './activity.js';

/** The most live tasks a project holds (spec §3 Limits). */
export const TASK_LIMIT = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SPACE_ID = /^[a-z0-9]{12}$/;
const bad = (field) => new HttpError(400, { error: 'invalid', field });

/** {space, item} of a class assignment, or null; anything else is a 400 on `parent`. */
export function parentOf(v) {
  if (v == null) return null;
  if (typeof v !== 'object' || !SPACE_ID.test(v.space) || typeof v.item !== 'string' || v.item.length < 1 || v.item.length > 24
    || /[\u0000-\u001f\u007f]/.test(v.item)) throw bad('parent');
  return { space: v.space, item: v.item };
}

/** POST /api/spaces for a project: {title, date?, parent?}; a date unless it belongs to an assignment. */
export function projectBody(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 140 || title.includes('\0')) throw bad('title');
  const parent = parentOf(body.parent);
  const date = body.date == null ? null : body.date;
  if (date !== null && (typeof date !== 'string' || !DATE.test(date))) throw bad('date');
  if (date === null && !parent) throw bad('date');
  return { title, date, parent };
}

/* A live item of the class `?` (bound 'c:' || space) with the id `?`; its date. */
const ASSIGNMENT_DATE = '(SELECT date FROM items WHERE scope = ? AND id = ? AND deleted_at IS NULL)';

/**
 * A new project with you as its owner (Decision 3), in one batch: the space, your membership,
 * its 'project' item and your prefs. With a parent, you must be a live member of that class and
 * the item live there, and the date defaults to the item's. 409 limit past 20 spaces; 400 parent.
 */
export async function createProject(db, userId, { title, date = null, parent = null }, now = Date.now()) {
  const id = randomId(), scope = 'p:' + id, made = 'EXISTS (SELECT 1 FROM spaces WHERE id = ?)';
  const g = parent ? memberGuard(parent.space, userId) : null;
  const [space] = await db.batch([
    db.prepare(`INSERT INTO spaces (id, kind, parent_space, parent_item, created_at, updated_at, revision)
      SELECT ?, 'project', ?, ?, ?, ?, ${NEXT_SPACE_REVISION} WHERE ${MY_SPACES} < ?${parent ? ` AND ${g.sql} AND ${ASSIGNMENT_DATE} IS NOT NULL` : ''}`)
      .bind(id, parent?.space ?? null, parent?.item ?? null, now, now, userId, SPACE_LIMIT, ...(parent ? [...g.binds, 'c:' + parent.space, parent.item] : [])),
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) SELECT ?, ?, 'owner', ?, ? WHERE ${made}`).bind(id, userId, now, now, id),
    db.prepare(`INSERT INTO items (scope, id, type, title, date, status, updated_by, created_at, updated_at, revision)
      SELECT ?, 'project', 'project', ?, COALESCE(?, ${ASSIGNMENT_DATE}), 'todo', ?, ?, ?, ${NEXT_ROW_REVISION} WHERE ${made}`)
      .bind(scope, title, date, 'c:' + (parent?.space ?? ''), parent?.item ?? '', userId, now, now, id),
    joinPrefs(db, userId, id, now),
  ]);
  /* the spaces insert only: no trigger writes on spaces, as createClass relies on */
  if (space.meta.changes) return spaceSummary(db, userId, id);
  const { n } = await db.prepare(`SELECT ${MY_SPACES} AS n`).bind(userId).first();
  if (n >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  throw bad('parent');
}

/**
 * The owner links an unarchived project to a class assignment they can see, taking its date,
 * or unlinks it (parent null; a body with no parent too), which keeps the date (Decision 4);
 * writes space.linked, from the item it was linked to ('' for none), and deletes it when a
 * relink or unlink brings it back there within its ten minutes (spec §12). 404 outside the project or on a class; 403 for anyone but the owner; 400 parent.
 */
export async function linkProject(db, userId, spaceId, parent, now = Date.now()) {
  const me = await assertOwner(db, userId, spaceId);
  if (me.kind !== 'project') throw new HttpError(404, { error: 'not_found' });
  let assignment = null;
  if (parent) {
    const g = memberGuard(parent.space, userId);
    assignment = await db.prepare(`SELECT title, date FROM items WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind('c:' + parent.space, parent.item, ...g.binds).first();
    if (!assignment) throw bad('parent');
  }
  const prior = (await db.prepare('SELECT parent_item FROM spaces WHERE id = ?').bind(spaceId).first())?.parent_item ?? '';
  const g = ownerGuard(spaceId, userId);
  await db.batch([
    db.prepare(`UPDATE spaces SET parent_space = ?, parent_item = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION}
      WHERE id = ? AND (parent_space IS NOT ? OR parent_item IS NOT ?) AND ${g.sql}`)
      .bind(parent?.space ?? null, parent?.item ?? null, now, spaceId, parent?.space ?? null, parent?.item ?? null, ...g.binds),
    ...(parent ? [db.prepare(`UPDATE items SET date = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND id = 'project' AND date != ? AND EXISTS (SELECT 1 FROM spaces WHERE id = ? AND parent_item = ? AND updated_at = ?)`)
      .bind(assignment.date, userId, now, 'p:' + spaceId, assignment.date, spaceId, parent.item, now)] : []),
    /* old_value is never NULL, so the first "from" is kept and an undone link is found */
    noteStmt(db, { spaceId, actorId: userId, verb: 'space.linked', oldValue: prior, newValue: parent?.item ?? null, detail: parent ? { assignment: assignment.title } : {}, now,
      when: 'EXISTS (SELECT 1 FROM spaces WHERE id = ?1 AND updated_at = ?8 AND parent_item IS ?6)' }),
    undoneStmt(db, { spaceId, actorId: userId, verb: 'space.linked', now }),
  ]);
}

/* ?1 the person, ?2 the space, ?3 who acts, ?4 now. A live member of the live space who is not the owner; and ?3 its live owner. */
const LIVE_MEMBER = `EXISTS (SELECT 1 FROM spaces AS ls WHERE ls.id = ?2 AND ls.deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role != 'owner')`;
const ACTOR_OWNS = "EXISTS (SELECT 1 FROM members AS ow WHERE ow.space_id = ?2 AND ow.user_id = ?3 AND ow.role = 'owner' AND ow.deleted_at IS NULL)";

/** ?1 taken out of every live task's assignees in the project ?2 (a task left with nobody is unassigned; the trigger says so). */
const STRIP = (live) => `UPDATE items SET assignees = (SELECT json_group_array(a.value) FROM json_each(items.assignees) AS a WHERE a.value != ?1),
    updated_by = ?3, updated_at = ?4, revision = revision + 1
  WHERE scope = 'p:' || ?2 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(items.assignees) AS a WHERE a.value = ?1) AND ${live}`;

/**
 * `userId` leaves the project, or is removed by its owner `actorId` (Decision 6), in one
 * batch: stripped from the assignees, their marks and prefs there soft-deleted, the
 * membership ended (the batch's last guarded write, so a retry does nothing), member.left or
 * member.removed. Nothing is copied: the rows are the team's. True when it ended now.
 */
export async function leaveProject(db, userId, spaceId, actorId = userId, now = Date.now()) {
  const leaving = actorId === userId;
  const live = leaving ? LIVE_MEMBER : `${LIVE_MEMBER} AND ${ACTOR_OWNS}`;
  const v = [userId, spaceId, actorId, now];
  const results = await db.batch([
    db.prepare(STRIP(live)).bind(...v),
    ...['marks', 'space_prefs'].map((t) => db.prepare(`UPDATE ${t} SET deleted_at = ?4, updated_at = ?4, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`).bind(...v)),
    db.prepare(`UPDATE members SET deleted_at = ?4, updated_at = ?4, revision = revision + 1 WHERE space_id = ?2 AND user_id = ?1 AND ${live}`).bind(...v),
    db.prepare('SELECT changes() AS n'),
    touchSpace(db, spaceId, now, { ifChanged: true }),
    /* the membership of ?9 ended in this batch (worker/leaving.js ENDED) */
    noteStmt(db, { spaceId, actorId, verb: leaving ? 'member.left' : 'member.removed', subjectUser: leaving ? '' : userId, now,
      when: 'EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?9 AND deleted_at = ?8)', binds: [userId] }),
  ]);
  return results[4].results[0].n > 0;
}

/* keeperGuard's SQL with the space and the owner numbered ?1 and ?2 (a plain ? beside numbered ones would be numbered past them). */
const OWNER_HERE = `EXISTS (SELECT 1 FROM members AS gm JOIN spaces AS gs ON gs.id = gm.space_id
  WHERE gm.space_id = ?1 AND gm.user_id = ?2 AND gm.deleted_at IS NULL AND gs.deleted_at IS NULL AND gm.role = 'owner')`;

/**
 * The owner deletes the project (Decision 7), archived or not, with its title typed as
 * `confirm`, in one batch: space.deleted about each other live member (first, while the space
 * and its name are live, so it reaches them after the space is gone), every member's marks and
 * prefs there, its invites, then the space. Sync revokes it; the nightly purge removes it.
 * 404 outside it or on a class; 403 for anyone but the owner; 400 confirm.
 */
export async function deleteProject(db, userId, spaceId, confirm, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'project') throw new HttpError(404, { error: 'not_found' });
  const row = await db.prepare("SELECT title FROM items WHERE scope = ? AND id = 'project'").bind('p:' + spaceId).first();
  if (typeof confirm !== 'string' || confirm.trim() !== row?.title?.trim()) throw bad('confirm');
  const g = keeperGuard(spaceId, userId);
  await db.batch([
    db.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, detail, bucket, at)
      SELECT ?1, ?2, 'space.deleted', '', m.user_id, json_object('by', ${NAME('?2')}, 'whom', ${NAME('m.user_id')}, 'space', ${SPACE_NAME('?1')}), ${BUCKET('?3')}, ?3
      FROM members AS m WHERE m.space_id = ?1 AND m.user_id != ?2 AND m.deleted_at IS NULL AND ${OWNER_HERE}
      ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET at = excluded.at, detail = excluded.detail`)
      .bind(spaceId, userId, now),
    ...['marks', 'space_prefs'].map((t) => db.prepare(`UPDATE ${t} SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND deleted_at IS NULL AND ${g.sql}`).bind(now, now, spaceId, ...g.binds)),
    db.prepare(`DELETE FROM invites WHERE space_id = ? AND ${g.sql}`).bind(spaceId, ...g.binds),
    db.prepare(`UPDATE spaces SET deleted_at = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind(now, now, spaceId, ...g.binds),
  ]);
}
