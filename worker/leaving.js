// Leaving and removal (spec §13). Detach turns a class's rows into your own: leaving or being
// removed copies the class course and its items into your scope with your layer folded in;
// Keep as mine (and the nightly purge, for an item about to be purged) copies removed items,
// filed under the class. Each is a handful of set-based statements in one batch. Every
// statement carries a `live` condition that the batch's last write ends (your membership, or
// your mark), so a retry copies nothing twice. Statements use numbered parameters:
//   ?1 whose rows   ?2 the space   ?3 'u:' || ?1   ?4 'c:' || ?2   ?5 now
//   ?6 the item ids a copy takes, [[class id, copy id]]   ?7 the course copy's id
//   ?8 the items a keep copies (JSON)   ?9 who acts (a removal's owner)
import { HttpError } from './http.js';
import { logError, messageOf } from './errors.js';
import { assertAllowed, assertKeeper, keeperGuard, roleOf } from './access.js';
import { LIVE_MEMBERS, NEXT_ROW_REVISION, NEXT_SPACE_REVISION, touchSpace } from './spaces.js';
import { REVIEW_ID } from '../src/core/shared.ts';
import { HAND_ON } from './accounts.js';

/** A mark holding anything of yours (spec §13): a status, grade, weight, notes, a checklist or a completion. `m` is its alias. */
export const MEANINGFUL = (m) =>
  `(${m}.status != 'todo' OR ${m}.grade IS NOT NULL OR ${m}.weight IS NOT NULL OR ${m}.notes != '' OR ${m}.checklist != '[]' OR ${m}.completed_at IS NOT NULL)`;

/* Bind only the numbered parameters a statement uses: SQLite counts up to the highest. */
function prepare(db, sql, values) {
  const n = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  return db.prepare(sql).bind(...values.slice(0, n));
}
const valuesOf = ({ userId, spaceId, now, items = '[]', course = null, only = null, actor = null }) =>
  [userId, spaceId, 'u:' + userId, 'c:' + spaceId, now, items, course, only, actor];

/* The copy ids as rows, and a class id's copy (the id itself when the map has none). */
const MAP = "(SELECT json_extract(value, '$[0]') AS from_id, json_extract(value, '$[1]') AS to_id FROM json_each(?6))";
const TO = (col) => `COALESCE((SELECT to_id FROM ${MAP} WHERE from_id = ${col}), ${col})`;

/*
 * Copy ids for `ids` (class ids, in order) that no live row of yours (`taken`) has and no
 * other copy in the same map takes: an id's own when free, else 'k' and its first 23
 * characters, else 'k', a counter and as much of the id as fits in 24. The upserts only
 * revive tombstones, so a copy id must never be live, or the copy would silently not land.
 */
function freeIds(ids, taken) {
  const used = new Set(taken), out = new Map();
  for (const id of ids) if (!used.has(id)) { out.set(id, id); used.add(id); }
  for (const id of ids) {
    if (out.has(id)) continue;
    let to = 'k' + id.slice(0, 23);
    for (let i = 1; used.has(to); i++) to = 'k' + i + id.slice(0, 23 - String(i).length);
    out.set(id, to);
    used.add(to);
  }
  return ids.map((id) => [id, out.get(id)]);
}

/**
 * The ids a copy into your scope takes (spec §13): each class row's own, unless a live row of
 * yours already has it (or another copy in this map does), then a free 'k' id (`freeIds`).
 * `only` limits the items (a keep). Returns {course: the course copy's id or null, items: JSON
 * [[class id, copy id]]}.
 */
export async function copyIds(db, userId, spaceId, only = null) {
  const mine = 'u:' + userId, scope = 'c:' + spaceId;
  const [course, items, myCourses, myItems] = await db.batch([
    db.prepare('SELECT id FROM courses WHERE scope = ? LIMIT 1').bind(scope),
    db.prepare(`SELECT id FROM items WHERE scope = ?1${only ? ' AND id IN (SELECT value FROM json_each(?2))' : ''} ORDER BY id`)
      .bind(scope, ...(only ? [JSON.stringify(only)] : [])),
    db.prepare('SELECT id FROM courses WHERE scope = ? AND deleted_at IS NULL').bind(mine),
    db.prepare('SELECT id FROM items WHERE scope = ? AND deleted_at IS NULL').bind(mine),
  ]);
  const ids = (r) => r.results.map((x) => x.id);
  const courseId = course.results[0]?.id;
  return {
    course: courseId === undefined ? null : freeIds([courseId], ids(myCourses))[0][1],
    items: JSON.stringify(freeIds(ids(items), ids(myItems))),
  };
}

/* Your notes win; the class's follow under "Class notes:" (spec §13). */
const NOTES = `substr(CASE WHEN i.notes = '' THEN COALESCE(m.notes, '')
    WHEN COALESCE(m.notes, '') = '' THEN 'Class notes:' || char(10) || i.notes
    ELSE m.notes || char(10) || char(10) || 'Class notes:' || char(10) || i.notes END, 1, 5000)`;

/* Class items `which` into your scope as copies, your mark folded in; an upsert, so a tombstone of yours revives. */
const itemCopy = (which, course, classId) => `INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, grade, weight, notes,
    checklist, links, recur, weekday, recur_until, dept, completed_at, class_id, created_at, updated_at, revision)
  SELECT ?3, map.to_id, i.type, i.title, ${course}, i.date, i.start, i.end, i.location, COALESCE(m.status, 'todo'), m.grade, COALESCE(m.weight, i.weight), ${NOTES},
    COALESCE(m.checklist, '[]'), i.links, i.recur, i.weekday, i.recur_until, i.dept, m.completed_at, ${classId}, ?5, ?5, ${NEXT_ROW_REVISION}
  FROM items AS i JOIN ${MAP} AS map ON map.from_id = i.id
    LEFT JOIN marks AS m ON m.user_id = ?1 AND m.space_id = ?2 AND m.item_id = i.id AND m.deleted_at IS NULL
  WHERE i.scope = ?4 AND ${which}
  ON CONFLICT (scope, id) DO UPDATE SET type = excluded.type, title = excluded.title, course_id = excluded.course_id, date = excluded.date,
    start = excluded.start, end = excluded.end, location = excluded.location, status = excluded.status, grade = excluded.grade,
    weight = excluded.weight, notes = excluded.notes, checklist = excluded.checklist, links = excluded.links, recur = excluded.recur,
    weekday = excluded.weekday, recur_until = excluded.recur_until, dept = excluded.dept, completed_at = excluded.completed_at,
    class_id = excluded.class_id, updated_at = excluded.updated_at, deleted_at = NULL, revision = items.revision + 1
    WHERE items.deleted_at IS NOT NULL`;

/* What a copy takes (Decision 2): live items, except hidden ones holding nothing of yours that
   nothing of yours points at; removed items holding something of yours. */
const TAKEN = `((i.deleted_at IS NULL AND (COALESCE(m.hidden, 0) = 0 OR ${MEANINGFUL('m')}
      OR EXISTS (SELECT 1 FROM study_sessions AS ss WHERE ss.user_id = ?1 AND ss.space_id = ?2 AND ss.item_id = i.id AND ss.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM achievements AS aa WHERE aa.user_id = ?1 AND aa.space_id = ?2 AND aa.item_id = i.id AND aa.deleted_at IS NULL)))
  OR (i.deleted_at IS NOT NULL AND m.id IS NOT NULL AND ${MEANINGFUL('m')}))`;

/* Your layer in the space, deleted. */
const layerGone = (live) => [
  `UPDATE marks SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
  `UPDATE space_prefs SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
];

/** The class copied into your scope (spec §13 Detach), then your layer there deleted. */
const copyClass = (live) => [
  `INSERT INTO courses (scope, id, code, name, color, instructor, term, archived, meetings, target, created_at, updated_at, revision)
    SELECT ?3, ?7, c.code, c.name, COALESCE(p.color, c.color), c.instructor, COALESCE(p.term, c.term), COALESCE(p.archived, (SELECT sa.archived FROM spaces AS sa WHERE sa.id = ?2)), c.meetings, p.target, ?5, ?5, ${NEXT_ROW_REVISION}
    FROM courses AS c LEFT JOIN space_prefs AS p ON p.user_id = ?1 AND p.id = ?2 AND p.deleted_at IS NULL
    WHERE c.scope = ?4 AND c.deleted_at IS NULL AND ${live}
    ON CONFLICT (scope, id) DO UPDATE SET code = excluded.code, name = excluded.name, color = excluded.color, instructor = excluded.instructor,
      term = excluded.term, archived = excluded.archived, meetings = excluded.meetings, target = excluded.target,
      updated_at = excluded.updated_at, deleted_at = NULL, revision = courses.revision + 1 WHERE courses.deleted_at IS NOT NULL`,
  itemCopy(`${TAKEN} AND ${live}`, 'CASE WHEN i.course_id IS NULL THEN NULL ELSE ?7 END', 'NULL'),
  `UPDATE items SET course_id = ?7, class_id = NULL, updated_at = ?5, revision = revision + 1
    WHERE scope = ?3 AND class_id = ?2 AND deleted_at IS NULL AND ${live}`,
  `UPDATE study_sessions SET space_id = NULL, course_id = CASE WHEN course_id IS NULL THEN NULL ELSE ?7 END,
      item_id = CASE WHEN item_id IS NULL THEN NULL ELSE ${TO('study_sessions.item_id')} END, updated_at = ?5, revision = revision + 1
    WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
  `UPDATE achievements SET space_id = NULL, course_id = CASE WHEN course_id IS NULL THEN NULL ELSE ?7 END,
      item_id = CASE WHEN item_id IS NULL THEN NULL ELSE ${TO('achievements.item_id')} END, updated_at = ?5, revision = revision + 1
    WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
  ...layerGone(live),
];

/** Leaving without a copy (spec §13): your items filed under the class stay, without a course; sessions keep the class. */
const dropLayer = (live) => [
  `UPDATE items SET class_id = NULL, updated_at = ?5, revision = revision + 1 WHERE scope = ?3 AND class_id = ?2 AND deleted_at IS NULL AND ${live}`,
  ...layerGone(live),
];

/**
 * Detach `userId` from the class `spaceId` and end their membership, in one batch: a copy
 * (keepCopy) or only their layer dropped. `who` is the SQL the membership must still meet
 * (leaving, a removal by ?9, or closing the class); `closing` also deletes the space's
 * invites and, once nobody is left, the space. True when the membership ended now.
 */
export async function detach(db, userId, spaceId, { keepCopy, who, actor = null, closing = false, now = Date.now() }) {
  const ids = keepCopy ? await copyIds(db, userId, spaceId) : { course: null, items: '[]' };
  const v = valuesOf({ userId, spaceId, now, items: ids.items, course: ids.course, actor });
  const live = `EXISTS (SELECT 1 FROM spaces AS ls WHERE ls.id = ?2 AND ls.deleted_at IS NULL) AND ${who}`;
  const stmts = (keepCopy ? copyClass(live) : dropLayer(live)).map((sql) => prepare(db, sql, v));
  if (closing) stmts.push(prepare(db, `DELETE FROM invites WHERE space_id = ?2 AND ${live}`, v));
  stmts.push(
    prepare(db, `UPDATE members SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE space_id = ?2 AND user_id = ?1 AND deleted_at IS NULL AND ${live}`, v),
    db.prepare('SELECT changes() AS n'),
    closing
      ? prepare(db, `UPDATE spaces SET deleted_at = ?5, updated_at = ?5, revision = ${NEXT_SPACE_REVISION}
          WHERE id = ?2 AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM members WHERE space_id = ?2 AND deleted_at IS NULL)
            AND EXISTS (SELECT 1 FROM members WHERE space_id = ?2 AND user_id = ?1 AND role = 'owner' AND deleted_at = ?5)`, v)
      : touchSpace(db, spaceId, now, { ifChanged: true }),
  );
  const results = await db.batch(stmts);
  return results[results.length - 2].results[0].n > 0;
}

/* Whom a statement may still detach: a live member who is not the owner (leaving, or removed by ?9, the live owner). */
const LEAVING = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role != 'owner')";
const REMOVING = `${LEAVING} AND EXISTS (SELECT 1 FROM members AS ow WHERE ow.space_id = ?2 AND ow.user_id = ?9 AND ow.role = 'owner' AND ow.deleted_at IS NULL)`;

/** Leave a class (spec §13): with a copy (the default) or without one. The owner hands it on first: 403 owner. */
export async function leave(db, userId, spaceId, keepCopy, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  if (me.role === 'owner') throw new HttpError(403, { error: 'owner' });
  if (!(await detach(db, userId, spaceId, { keepCopy, who: LEAVING, now }))) throw new HttpError(404, { error: 'not_found' });
}

/** The owner removes a member, who always keeps a copy (spec §13); never themselves or the owner. 404 when not a live member. */
export async function removeMember(db, userId, spaceId, targetId, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  if (targetId === userId) throw new HttpError(403, { error: 'forbidden' });
  if (await detach(db, targetId, spaceId, { keepCopy: true, who: REMOVING, actor: userId, now })) return;
  const them = await roleOf(db, targetId, spaceId);
  throw them ? new HttpError(403, { error: 'forbidden' }) : new HttpError(404, { error: 'not_found' });
}

/** Archive or unarchive a class (spec §13), the owner only, archived or not; moves the revision when it changes. */
export async function setArchived(db, userId, spaceId, archived, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const g = keeperGuard(spaceId, userId), a = archived ? 1 : 0;
  await db.prepare(`UPDATE spaces SET archived = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND archived != ? AND ${g.sql}`)
    .bind(a, now, spaceId, a, ...g.binds).run();
}

/* The owner, the space's only live member. */
const CLOSING = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role = 'owner') AND (SELECT count(*) FROM members AS sm WHERE sm.space_id = ?2 AND sm.deleted_at IS NULL) = 1";

/**
 * Delete a class (spec §13): the owner, while nobody else is in it (409 members). Keep a copy
 * (the default) detaches first; the invites go, then the membership, then the space. Sync
 * revokes it from every device; the nightly purge removes it 30 days later.
 */
export async function deleteClass(db, userId, spaceId, keepCopy, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const crowded = async () => (await db.prepare(`SELECT ${LIVE_MEMBERS('?')} AS n`).bind(spaceId).first()).n > 1;
  if (await crowded()) throw new HttpError(409, { error: 'members' });
  if (await detach(db, userId, spaceId, { keepCopy, who: CLOSING, closing: true, now })) return;
  /* someone joined between the count and the batch */
  throw (await crowded()) ? new HttpError(409, { error: 'members' }) : new HttpError(404, { error: 'not_found' });
}

/* The items a keep names (?8) that are removed and hold something of yours in your live mark. */
const KEPT = `(SELECT km.item_id FROM marks AS km JOIN items AS ki ON ki.scope = ?4 AND ki.id = km.item_id AND ki.deleted_at IS NOT NULL
  WHERE km.user_id = ?1 AND km.space_id = ?2 AND km.deleted_at IS NULL AND km.item_id IN (SELECT value FROM json_each(?8)) AND ${MEANINGFUL('km')})`;
const MEMBER_LIVE = 'EXISTS (SELECT 1 FROM members AS kl WHERE kl.space_id = ?2 AND kl.user_id = ?1 AND kl.deleted_at IS NULL)';
/* The class a kept copy is filed under: none once you are no longer in it (the purge keeps for people who left). */
const FILED = `(CASE WHEN ${MEMBER_LIVE} THEN ?2 END)`;
/* The copy of the class item `col` that this batch wrote: if its id became live in between, the copy did not land, so nothing else moves and your mark stays for a later keep. */
const COPIED = (col) => `EXISTS (SELECT 1 FROM items AS kc WHERE kc.scope = ?3 AND kc.id = ${TO(col)} AND kc.deleted_at IS NULL AND kc.updated_at = ?5 AND kc.class_id IS ${FILED})`;

/**
 * Keep as mine (spec §13): each removed class item `only` names that holds something of yours
 * becomes your own item, filed under the class (if you are still in it), with your layer folded in (under a free id,
 * `copyIds`); your sessions and grade achievements on it follow; your marks on them go, which
 * ends every statement's condition (KEPT), so a retry copies nothing. With `member`, only
 * while you are still in the class (the route); the nightly purge keeps without it.
 */
export async function keepItems(db, userId, spaceId, only, now = Date.now(), { member = false } = {}) {
  const ids = await copyIds(db, userId, spaceId, only);
  const v = valuesOf({ userId, spaceId, now, items: ids.items, only: JSON.stringify(only) });
  const live = member ? ` AND ${MEMBER_LIVE}` : '';
  await db.batch([
    itemCopy(`i.id IN ${KEPT}${live}`, 'NULL', FILED),
    `UPDATE study_sessions SET space_id = NULL, course_id = NULL, item_id = ${TO('study_sessions.item_id')}, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND item_id IN ${KEPT} AND ${COPIED('study_sessions.item_id')}${live}`,
    `UPDATE achievements SET space_id = NULL, item_id = ${TO('achievements.item_id')}, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND rule = 'grade' AND deleted_at IS NULL AND item_id IN ${KEPT} AND ${COPIED('achievements.item_id')}${live}`,
    `UPDATE marks SET deleted_at = ?5, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND item_id IN ${KEPT} AND ${COPIED('marks.item_id')}${live}`,
  ].map((sql) => prepare(db, sql, v)));
}

/** POST …/items/:id/keep: a removed item of the class you hold something on, archived or not. 404 otherwise. */
export async function keep(db, userId, spaceId, itemId, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const found = await db.prepare(`SELECT 1 AS x FROM items AS i JOIN marks AS m ON m.user_id = ? AND m.space_id = ? AND m.item_id = i.id AND m.deleted_at IS NULL
    WHERE i.scope = ? AND i.id = ? AND i.deleted_at IS NOT NULL AND ${MEANINGFUL('m')}`).bind(userId, spaceId, 'c:' + spaceId, itemId).first();
  if (!found) throw new HttpError(404, { error: 'not_found' });
  await keepItems(db, userId, spaceId, [itemId], now, { member: true });
}

/* The owner or an editor of the unarchived class. */
const EDITOR = `EXISTS (SELECT 1 FROM members AS gm JOIN spaces AS gs ON gs.id = gm.space_id WHERE gm.space_id = ?2 AND gm.user_id = ?1
  AND gm.deleted_at IS NULL AND gs.deleted_at IS NULL AND gs.archived = 0 AND gm.role IN ('owner', 'editor'))`;

/**
 * Share items of yours filed under a class with it (spec §13; absorb {items}): each becomes a
 * class item under the same id (reviving a class tombstone), its facts the class's; your
 * status, grade, checklist, notes and completion move into your mark; your sessions and grade
 * achievements on it get the space; your item goes, which ends the batch (a retry is 400
 * items). 400 items for one that is not yours under the class or is a lecture review, 400 type
 * for a custom type, 409 exists for an id the class has live (also when the class made every one
 * live after the check, so nothing was shared). Answers {shared}, the items shared.
 */
export async function shareItems(db, userId, spaceId, ids, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'editor');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const mine = 'u:' + userId, scope = 'c:' + spaceId, J = JSON.stringify(ids);
  const [own, taken] = await db.batch([
    db.prepare('SELECT id, type FROM items WHERE scope = ? AND class_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(mine, spaceId, J),
    db.prepare('SELECT id FROM items WHERE scope = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(scope, J),
  ]);
  if (own.results.length !== ids.length || own.results.some((r) => r.type === 'task' && REVIEW_ID.test(r.id))) throw new HttpError(400, { error: 'invalid', field: 'items' });
  if (own.results.some((r) => r.type.startsWith('c-'))) throw new HttpError(400, { error: 'invalid', field: 'type' });
  if (taken.results.length) throw new HttpError(409, { error: 'exists' });
  const v = [userId, spaceId, mine, scope, now, J];
  const OWN = 'p.scope = ?3 AND p.class_id = ?2 AND p.deleted_at IS NULL AND p.id IN (SELECT value FROM json_each(?6))';
  /* the class item this batch wrote: if the class made one live in between, it keeps its facts and your item stays yours */
  const SHARED = 'EXISTS (SELECT 1 FROM items AS ci WHERE ci.scope = ?4 AND ci.id = p.id AND ci.deleted_at IS NULL AND ci.updated_at = ?5 AND ci.updated_by = ?1)';
  const COURSE = '(SELECT id FROM courses WHERE scope = ?4 AND deleted_at IS NULL LIMIT 1)';
  const results = await db.batch([
    `INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, weight, notes, links, recur, weekday, recur_until, dept,
        updated_by, created_at, updated_at, revision)
      SELECT ?4, p.id, p.type, p.title, ${COURSE}, p.date, p.start, p.end, p.location, 'todo', p.weight, '', p.links, p.recur, p.weekday, p.recur_until, p.dept,
        ?1, ?5, ?5, ${NEXT_ROW_REVISION}
      FROM items AS p WHERE ${OWN} AND p.type NOT GLOB 'c-*' AND ${EDITOR}
      ON CONFLICT (scope, id) DO UPDATE SET type = excluded.type, title = excluded.title, course_id = excluded.course_id, date = excluded.date,
        start = excluded.start, end = excluded.end, location = excluded.location, weight = excluded.weight, notes = '', links = excluded.links,
        recur = excluded.recur, weekday = excluded.weekday, recur_until = excluded.recur_until, dept = excluded.dept,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at, deleted_at = NULL, revision = items.revision + 1
        WHERE items.deleted_at IS NOT NULL`,
    `INSERT INTO marks (user_id, id, space_id, item_id, status, grade, weight, notes, checklist, completed_at, hidden, created_at, updated_at, revision)
      SELECT ?1, ?2 || ':' || p.id, ?2, p.id, p.status, p.grade, NULL, p.notes, p.checklist, p.completed_at, 0, ?5, ?5, ${NEXT_ROW_REVISION}
      FROM items AS p WHERE ${OWN} AND ${SHARED} AND ${EDITOR}
        /* an item holding nothing makes no mark, but one you have (a hidden one on a class tombstone) becomes yours, shown */
        AND (p.status != 'todo' OR p.grade IS NOT NULL OR p.notes != '' OR p.checklist != '[]' OR p.completed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM marks AS om WHERE om.user_id = ?1 AND om.id = ?2 || ':' || p.id AND om.deleted_at IS NULL))
      ON CONFLICT (user_id, id) DO UPDATE SET status = excluded.status, grade = excluded.grade, weight = NULL, notes = excluded.notes,
        checklist = excluded.checklist, completed_at = excluded.completed_at, hidden = 0, deleted_at = NULL,
        updated_at = excluded.updated_at, revision = marks.revision + 1`,
    `UPDATE study_sessions SET space_id = ?2, course_id = ${COURSE}, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id IS NULL AND deleted_at IS NULL AND item_id IN (SELECT p.id FROM items AS p WHERE ${OWN} AND ${SHARED}) AND ${EDITOR}`,
    `UPDATE achievements SET space_id = ?2, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id IS NULL AND rule = 'grade' AND deleted_at IS NULL AND item_id IN (SELECT p.id FROM items AS p WHERE ${OWN} AND ${SHARED}) AND ${EDITOR}`,
    `UPDATE items AS p SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE ${OWN} AND ${SHARED} AND ${EDITOR}`,
    'SELECT changes() AS n',
  ].map((sql) => prepare(db, sql, v)));
  const shared = results[5].results[0].n;
  if (shared) return { shared };
  /* nothing moved: you lost the role, or the class made the id live in between */
  await assertAllowed(db, userId, spaceId, 'editor');
  throw new HttpError(409, { error: 'exists' });
}

/* People-and-classes the purge keeps for in one night: each is two D1 calls, and the cron's invocation has few to spare. */
const AUTO_KEEP_GROUPS = 3;

/**
 * The purge's last step (spec §13; after the sweep, so the sweep never waits on it): Keep as mine, for its holder, every live mark holding
 * something on a class item whose tombstone is older than `before`, whether or not they are
 * still in the class. At most 500 marks in AUTO_KEEP_GROUPS (person, class) groups a night;
 * the rest the next (their items wait for them, see purgeTombstones). A kept item's class row
 * goes the night after. A group that fails is logged and skipped, so it never blocks the others.
 */
export async function autoKeep(db, before, now = Date.now()) {
  const { results } = await db.prepare(`SELECT m.user_id, m.space_id, m.item_id FROM marks AS m
      JOIN items AS i ON i.scope = 'c:' || m.space_id AND i.id = m.item_id
    WHERE m.deleted_at IS NULL AND i.deleted_at IS NOT NULL AND i.deleted_at < ? AND ${MEANINGFUL('m')}
    ORDER BY m.user_id, m.space_id LIMIT 500`).bind(before).all();
  const groups = new Map();
  for (const r of results) {
    const k = r.user_id + '\n' + r.space_id;
    if (!groups.has(k)) {
      if (groups.size === AUTO_KEEP_GROUPS) break;
      groups.set(k, []);
    }
    groups.get(k).push(r);
  }
  for (const rows of groups.values()) {
    const { user_id: userId, space_id: spaceId } = rows[0];
    try {
      await keepItems(db, userId, spaceId, rows.map((r) => r.item_id), now);
    } catch (e) {
      console.error('autoKeep:', spaceId, messageOf(e));
      await logError(db, { method: 'CRON', route: 'purge/keep/' + spaceId, message: messageOf(e), userId }, now);
    }
  }
}

/**
 * Before an account is deleted, for the same batch as the deletion: worker/accounts.js HAND_ON
 * (its spaces passed on, or deleted with nobody else in them), bound to the user and now.
 */
export const handOnStmts = (db, userId, now = Date.now()) => HAND_ON.map((sql) => prepare(db, sql, [userId, now]));
