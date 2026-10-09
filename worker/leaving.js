// Leaving and removal (spec §13). Detach turns a class's rows into your own: leaving or being
// removed copies the class course and its items into your scope with your layer folded in;
// Keep as mine (and the nightly purge, for an item about to be purged) copies removed items,
// filed under the class. Each is a handful of set-based statements in one batch. Every
// statement carries a `live` condition that the batch's last write ends (your membership, or
// your mark), so a retry copies nothing twice. Statements use numbered parameters:
//   ?1 whose rows   ?2 the space   ?3 'u:' || ?1   ?4 'c:' || ?2   ?5 now
//   ?6 the item ids a copy takes, [[class id, copy id]]   ?7 the course copy's id
//   ?8 the items a keep copies (JSON)   ?9 who acts (a removal's owner)
import { NEXT_ROW_REVISION, NEXT_SPACE_REVISION, touchSpace } from './spaces.js';

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

/**
 * The ids a copy into your scope takes (spec §13): each class row's own, unless a live row of
 * yours already has it, then 'k' and its first 23 characters. `only` limits the items (a keep).
 * Returns {course: the course copy's id or null, items: JSON [[class id, copy id]]}.
 */
export async function copyIds(db, userId, spaceId, only = null) {
  const mine = 'u:' + userId, scope = 'c:' + spaceId;
  const [course, items] = await db.batch([
    db.prepare(`SELECT c.id, EXISTS (SELECT 1 FROM courses AS x WHERE x.scope = ?1 AND x.id = c.id AND x.deleted_at IS NULL) AS clash
      FROM courses AS c WHERE c.scope = ?2 LIMIT 1`).bind(mine, scope),
    db.prepare(`SELECT i.id, EXISTS (SELECT 1 FROM items AS x WHERE x.scope = ?1 AND x.id = i.id AND x.deleted_at IS NULL) AS clash
      FROM items AS i WHERE i.scope = ?2${only ? ' AND i.id IN (SELECT value FROM json_each(?3))' : ''} ORDER BY i.id`)
      .bind(mine, scope, ...(only ? [JSON.stringify(only)] : [])),
  ]);
  const to = (r) => (r.clash ? 'k' + r.id.slice(0, 23) : r.id);
  return { course: course.results[0] ? to(course.results[0]) : null, items: JSON.stringify(items.results.map((r) => [r.id, to(r)])) };
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
    SELECT ?3, ?7, c.code, c.name, COALESCE(p.color, c.color), c.instructor, COALESCE(p.term, c.term), COALESCE(p.archived, 0), c.meetings, p.target, ?5, ?5, ${NEXT_ROW_REVISION}
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
