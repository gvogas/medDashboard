// Spaces (migrations/0002_spaces.sql) and what the class routes share: the limits,
// Worker-made ids, the space revision and a space's summary. Making a class, its details,
// roles and transfer follow below; invites and join codes are in worker/invites.js.
import { HttpError } from './http.js';
import { assertAllowed, assertKeeper, keeperGuard, memberGuard, scopeOf } from './access.js';
import { REVIEW_ID } from '../src/core/shared.ts';
import { COURSE_COLOURS } from './validate.js';
import { noteStmt, undoneStmt } from './activity.js';

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

/* A row's first revision: the change feed's next sequence value, as worker/db.js writes it. */
export const NEXT_ROW_REVISION = "COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1";
/* A person's school calendar, as a class keeps a copy of it (spec §8): only one with a semester; bind the user id. */
const OWNER_CALENDAR = `(SELECT CASE WHEN json_valid(u.school_calendar) AND json_type(u.school_calendar) = 'object'
    AND COALESCE(json_array_length(u.school_calendar, '$.terms'), 0) > 0 THEN u.school_calendar END FROM users AS u WHERE u.id = ?)`;
/* A live class this person owns whose course has the id bound second: an earlier convert of that course. */
const MADE_FROM = `SELECT s.id FROM spaces AS s JOIN members AS m ON m.space_id = s.id
  WHERE m.user_id = ? AND m.role = 'owner' AND m.deleted_at IS NULL AND s.kind = 'class' AND s.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM courses WHERE scope = 'c:' || s.id AND id = ?)`;

const PALETTE = JSON.stringify(COURSE_COLOURS);
/* The colours a person already uses (?1 the user, ?2 the space): their live courses' and their other spaces'. */
const USED = `(SELECT u.color FROM courses AS u WHERE u.scope = 'u:' || ?1 AND u.deleted_at IS NULL AND u.archived = 0
  UNION SELECT q.color FROM space_prefs AS q WHERE q.user_id = ?1 AND q.deleted_at IS NULL AND q.id != ?2)`;

/**
 * The joiner's prefs (spec §9, §11), in the batch that makes the membership: the class
 * course's colour unless they use it, else the first of the twelve they do not use; the
 * class's term. Only for a live member of a live space (a project has no course, so it gets
 * the first colour you do not use and no term); a live prefs row is left as it is (an
 * accept retried), a deleted one revived with these defaults (a rejoin).
 */
export const joinPrefs = (db, userId, spaceId, now = Date.now()) => db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
  SELECT ?1, ?2, ?2, COALESCE(
      (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || ?2 AND c.deleted_at IS NULL AND c.color NOT IN ${USED}),
      (SELECT p.value FROM json_each(?3) AS p WHERE p.value NOT IN ${USED} ORDER BY p.key LIMIT 1),
      (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || ?2 LIMIT 1),
      '#17B3AE'),
    NULL, COALESCE((SELECT c.term FROM courses AS c WHERE c.scope = 'c:' || ?2 AND c.deleted_at IS NULL LIMIT 1), ''), 0, ?4, ?4, ${NEXT_ROW_REVISION}
  WHERE EXISTS (SELECT 1 FROM members WHERE space_id = ?2 AND user_id = ?1 AND deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM spaces WHERE id = ?2 AND deleted_at IS NULL)
  ON CONFLICT (user_id, id) DO UPDATE SET color = excluded.color, target = NULL, term = excluded.term, archived = 0,
    updated_at = excluded.updated_at, deleted_at = NULL, revision = space_prefs.revision + 1
    WHERE space_prefs.deleted_at IS NOT NULL`).bind(userId, spaceId, PALETTE, now);

/** The class you made from your course `courseId` before, as the routes answer it; null if none. */
export async function priorConvert(db, userId, courseId) {
  const prior = await db.prepare(MADE_FROM).bind(userId, courseId).first();
  return prior ? spaceSummary(db, userId, prior.id) : null;
}

/**
 * What a convert moves besides the course and the ticked items (spec §13), each statement
 * running only if the space `spaceId` was made in this batch: a mark from each ticked item
 * that holds anything of yours; your prefs from the course; the space on your sessions and
 * achievements that point at the course or a moved item (a session on the course and an
 * item that stays yours loses its course link instead, as deleting a course does); the
 * ticked items (never a custom-typed one, which has no class copy) and the course
 * soft-deleted directly (the course-delete path would clear their course); every other
 * live item of the course filed under the class.
 */
function moveIntoClass(db, userId, spaceId, courseId, ticked, now) {
  const mine = 'u:' + userId, made = 'EXISTS (SELECT 1 FROM spaces WHERE id = ?)';
  const TICKED = '(SELECT value FROM json_each(?))';
  return [
    db.prepare(`INSERT INTO marks (user_id, id, space_id, item_id, status, grade, weight, notes, checklist, completed_at, hidden, created_at, updated_at, revision)
      SELECT ?, ? || ':' || id, ?, id, status, grade, NULL, notes, checklist, completed_at, 0, ?, ?, ${NEXT_ROW_REVISION} FROM items
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND type NOT GLOB 'c-*' AND id IN ${TICKED}
        AND (status != 'todo' OR grade IS NOT NULL OR notes != '' OR checklist != '[]' OR completed_at IS NOT NULL) AND ${made}`)
      .bind(userId, spaceId, spaceId, now, now, mine, courseId, ticked, spaceId),
    db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
      SELECT ?, ?, ?, color, target, term, archived, ?, ?, ${NEXT_ROW_REVISION} FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${made}`)
      .bind(userId, spaceId, spaceId, now, now, mine, courseId, spaceId),
    db.prepare(`UPDATE study_sessions SET space_id = ?, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL
        AND ((course_id = ? AND (item_id IS NULL OR item_id IN ${TICKED})) OR (course_id IS NULL AND item_id IN ${TICKED})) AND ${made}`)
      .bind(spaceId, now, userId, courseId, ticked, ticked, spaceId),
    db.prepare(`UPDATE study_sessions SET course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND course_id = ? AND ${made}`).bind(now, userId, courseId, spaceId),
    db.prepare(`UPDATE achievements SET space_id = ?, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL
        AND ((rule = 'hours' AND course_id = ?) OR (rule = 'grade' AND item_id IN ${TICKED})) AND ${made}`)
      .bind(spaceId, now, userId, courseId, ticked, spaceId),
    db.prepare(`UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND type NOT GLOB 'c-*' AND id IN ${TICKED} AND ${made}`).bind(now, now, mine, courseId, ticked, spaceId),
    db.prepare(`UPDATE items SET class_id = ?, course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND ${made}`).bind(spaceId, now, mine, courseId, spaceId),
    db.prepare(`UPDATE courses SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${made}`).bind(now, now, mine, courseId, spaceId),
  ];
}

/**
 * A convert's course must be a live course of yours, and each item named a live item of it
 * that a class can take: not one of your own types (the c: CHECK refuses them) and not a
 * lecture review, which is yours alone (spec §13).
 */
export async function checkConvert(db, userId, courseId, ids) {
  const mine = 'u:' + userId;
  const [course, found] = await db.batch([
    db.prepare('SELECT 1 AS x FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL').bind(mine, courseId),
    db.prepare('SELECT id, type FROM items WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))')
      .bind(mine, courseId, JSON.stringify(ids)),
  ]);
  if (!course.results.length) throw new HttpError(400, { error: 'invalid', field: 'convertCourseId' });
  if (found.results.length !== ids.length || found.results.some((r) => r.type.startsWith('c-') || (r.type === 'task' && REVIEW_ID.test(r.id)))) {
    throw new HttpError(400, { error: 'invalid', field: 'items' });
  }
}

/**
 * A new class with you as its owner (spec §13, §20), in one batch: the space, your
 * membership and its course: a blank one from `course`, or a copy of your course
 * `convertCourseId` with the items named in `items`, in class shape. A convert then moves
 * your layer and your course (moveIntoClass; Stage 4 plan, Decision 6); a blank class gives
 * you its colour and term as your prefs. The space INSERT carries the 20-space
 * limit and, for a convert, "you own no class made from this course yet"; every later
 * statement runs only if that row was made, so a refusal leaves nothing. A repeated convert
 * answers the class it made ({created: false}). Past 20 spaces: 409 limit.
 */
export async function createClass(db, userId, { course, convertCourseId = null, items = [] }, now = Date.now()) {
  const id = randomId(), scope = scopeOf('class', id), mine = 'u:' + userId;
  const copy = convertCourseId !== null, courseId = copy ? convertCourseId : randomId();
  const made = 'EXISTS (SELECT 1 FROM spaces WHERE id = ?)';
  const stmts = [
    db.prepare(`INSERT INTO spaces (id, kind, school_calendar, created_at, updated_at, revision) SELECT ?, 'class', ${OWNER_CALENDAR}, ?, ?, ${NEXT_SPACE_REVISION}
      WHERE ${MY_SPACES} < ?${copy ? ` AND EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL) AND NOT EXISTS (${MADE_FROM})` : ''}`)
      .bind(id, userId, now, now, userId, SPACE_LIMIT, ...(copy ? [mine, courseId, userId, courseId] : [])),
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) SELECT ?, ?, 'owner', ?, ? WHERE ${made}`).bind(id, userId, now, now, id),
    copy
      ? db.prepare(`INSERT INTO courses (scope, id, code, name, color, instructor, term, archived, meetings, target, updated_by, created_at, updated_at, revision)
          SELECT ?, id, code, name, color, instructor, term, 0, meetings, NULL, ?, ?, ?, ${NEXT_ROW_REVISION} FROM courses
          WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${made}`).bind(scope, userId, now, now, mine, courseId, id)
      : db.prepare(`INSERT INTO courses (scope, id, code, name, color, instructor, term, archived, meetings, target, updated_by, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ${NEXT_ROW_REVISION} WHERE ${made}`)
          .bind(scope, courseId, course.code, course.name, course.color, course.instructor, course.term, JSON.stringify(course.meetings), userId, now, now, id),
  ];
  if (copy && items.length) {
    /* the class's facts only: no status, grade, checklist or notes of yours (the c: CHECK) */
    stmts.push(db.prepare(`INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, weight, notes, links,
        recur, weekday, recur_until, dept, updated_by, created_at, updated_at, revision)
      SELECT ?, id, type, title, course_id, date, start, end, location, 'todo', weight, '', links,
        recur, weekday, recur_until, dept, ?, ?, ?, ${NEXT_ROW_REVISION} FROM items
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND type NOT GLOB 'c-*' AND id IN (SELECT value FROM json_each(?)) AND ${made}`)
      .bind(scope, userId, now, now, mine, courseId, JSON.stringify(items), id));
  }
  if (copy) stmts.push(...moveIntoClass(db, userId, id, courseId, JSON.stringify(items), now));
  else {
    stmts.push(db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
      SELECT ?, ?, ?, ?, NULL, ?, 0, ?, ?, ${NEXT_ROW_REVISION} WHERE ${made}`).bind(userId, id, id, course.color, course.term, now, now, id));
  }
  const [space] = await db.batch(stmts);
  if (space.meta.changes) return { created: true, space: await spaceSummary(db, userId, id) };
  if (copy) {
    const prior = await db.prepare(MADE_FROM).bind(userId, courseId).first();
    if (prior) return { created: false, space: await spaceSummary(db, userId, prior.id) };
  }
  const { n } = await db.prepare(`SELECT ${MY_SPACES} AS n`).bind(userId).first();
  if (n >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  throw new HttpError(400, { error: 'invalid', field: 'convertCourseId' });
}

const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";

/**
 * A space for its Members tab (spec §11, §15): its members for everyone in it; its invites
 * not yet accepted for the owner and editors (a pending one past its expiry reads
 * 'expired'); and its join code's expiry and uses left for the owner. The code itself is
 * kept only as its hash; and the class's copy of its owner's school calendar for everyone in
 * it (offered to joiners with none). 404 outside the space.
 */
export async function spaceDetails(db, userId, spaceId, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  const g = memberGuard(spaceId, userId);
  const [members, invites, code, cal] = await db.batch([
    db.prepare(`SELECT m.user_id, m.role, m.joined_at, u.username, ${NAME} AS name FROM members AS m JOIN users AS u ON u.id = m.user_id
      WHERE m.space_id = ? AND m.deleted_at IS NULL AND ${g.sql} ORDER BY m.joined_at, m.user_id`).bind(spaceId, ...g.binds),
    db.prepare(`SELECT i.user_id, i.role, i.status, i.created_at, i.expires_at, i.invited_by, u.username, ${NAME} AS name
      FROM invites AS i JOIN users AS u ON u.id = i.user_id
      WHERE i.space_id = ? AND i.status != 'accepted' AND ${g.sql} ORDER BY i.created_at DESC, i.user_id`).bind(spaceId, ...g.binds),
    db.prepare(`SELECT code_expires, code_uses_left FROM spaces WHERE id = ? AND code_hash IS NOT NULL AND ${g.sql}`).bind(spaceId, ...g.binds),
    db.prepare(`SELECT school_calendar FROM spaces WHERE id = ? AND ${g.sql}`).bind(spaceId, ...g.binds),
  ]);
  const c = code.results[0];
  return {
    id: spaceId, scope: scopeOf(me.kind, spaceId), kind: me.kind, role: me.role, archived: me.archived,
    members: members.results.map((m) => ({ userId: m.user_id, username: m.username, name: m.name, role: m.role, joinedAt: m.joined_at })),
    invites: me.role === 'member' ? [] : invites.results.map((i) => ({
      userId: i.user_id, username: i.username, name: i.name, role: i.role,
      status: i.status === 'pending' && i.expires_at <= now ? 'expired' : i.status,
      createdAt: i.created_at, expiresAt: i.expires_at, invitedBy: i.invited_by,
    })),
    code: me.role === 'owner' && c && c.code_expires > now && c.code_uses_left > 0 ? { expires: c.code_expires, usesLeft: c.code_uses_left } : null,
    schoolCalendar: cal.results[0]?.school_calendar ? JSON.parse(cal.results[0].school_calendar) : null,
  };
}

/**
 * The owner copies their school calendar into the class again (spec §8), archived or not; one
 * with no semester leaves the class's copy as it was. Answers {schoolCalendar}.
 */
export async function refreshSchool(db, userId, spaceId, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const g = keeperGuard(spaceId, userId);
  await db.prepare(`UPDATE spaces SET school_calendar = COALESCE(${OWNER_CALENDAR}, school_calendar), updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND ${g.sql}`)
    .bind(userId, now, spaceId, ...g.binds).run();
  const row = await db.prepare('SELECT school_calendar FROM spaces WHERE id = ?').bind(spaceId).first();
  return { schoolCalendar: row?.school_calendar ? JSON.parse(row.school_calendar) : null };
}

/**
 * The owner makes a member an editor or a member (spec §5), archived or not: never themselves,
 * never the owner (a transfer does that). Answers {userId, role}; 404 when they are not a live member.
 */
export async function setRole(db, userId, spaceId, targetId, role, now = Date.now()) {
  await assertKeeper(db, userId, spaceId);
  if (targetId === userId) throw new HttpError(403, { error: 'forbidden' });
  const g = keeperGuard(spaceId, userId);
  await db.batch([
    db.prepare(`UPDATE members SET role = ?, updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL AND role NOT IN ('owner', ?) AND ${g.sql}`)
      .bind(role, now, spaceId, targetId, role, ...g.binds),
    touchSpace(db, spaceId, now, { ifChanged: true }),
    /* a role write moves only between editor and member, so the old role is the other one; only when it moved in this batch */
    noteStmt(db, { spaceId, actorId: userId, verb: 'member.role', subjectUser: targetId, oldValue: role === 'editor' ? 'member' : 'editor', newValue: role, now,
      when: 'EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?4 AND role = ?6 AND updated_at = ?8 AND deleted_at IS NULL)' }),
    undoneStmt(db, { spaceId, actorId: userId, verb: 'member.role', subjectUser: targetId, now }),
  ]);
  const row = await db.prepare('SELECT role FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL').bind(spaceId, targetId).first();
  if (!row) throw new HttpError(404, { error: 'not_found' });
  if (row.role === 'owner') throw new HttpError(403, { error: 'forbidden' });
  return { userId: targetId, role: row.role };
}

/**
 * The owner hands the space to another live member (spec §13), archived or not: the owner becomes an editor
 * before the other becomes the owner, since the one-owner index is checked statement by
 * statement; both in one batch. 404 when the other is not a live member.
 */
export async function transfer(db, userId, spaceId, targetId, now = Date.now()) {
  await assertKeeper(db, userId, spaceId);
  if (targetId === userId) throw new HttpError(400, { error: 'invalid', field: 'userId' });
  const g = keeperGuard(spaceId, userId);
  const [demoted] = await db.batch([
    db.prepare(`UPDATE members SET role = 'editor', updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND user_id = ? AND role = 'owner' AND deleted_at IS NULL AND ${g.sql}
        AND EXISTS (SELECT 1 FROM members AS t WHERE t.space_id = ? AND t.user_id = ? AND t.deleted_at IS NULL)`)
      .bind(now, spaceId, userId, ...g.binds, spaceId, targetId),
    db.prepare(`UPDATE members SET role = 'owner', updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL AND changes() > 0`).bind(now, spaceId, targetId),
    touchSpace(db, spaceId, now, { ifChanged: true }),
    noteStmt(db, { spaceId, actorId: userId, verb: 'space.transferred', subjectUser: targetId, now,
      when: "EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?4 AND role = 'owner' AND updated_at = ?8 AND deleted_at IS NULL)" }),
  ]);
  if (!demoted.meta.changes) throw new HttpError(404, { error: 'not_found' });
}

/**
 * Merge a course of yours into a class you are in (spec §13, merge on join): for each pair
 * [your item, the class's item], a mark from your item when it holds anything of yours (its
 * weight an override only when it differs from the class's; a mark you already had wins
 * field by field), your sessions and achievements on it and on the course moved to the
 * class's ids with the space, your item soft-deleted; your other items of the course filed
 * under the class; your target (always, while your prefs have none) and, with `fromCourse`,
 * your colour, term and archive flag into your prefs; the course soft-deleted. Writes no
 * shared row. Pairs name live items of your course (never a custom-typed one) and live items
 * of the class. A course already gone answers {paired: 0, filed: 0}: a retry.
 */
export async function absorb(db, userId, spaceId, { courseId, pairs, fromCourse = false }, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const mine = 'u:' + userId, scope = scopeOf('class', spaceId), J = JSON.stringify(pairs);
  const [course, own, theirs] = await db.batch([
    db.prepare('SELECT deleted_at FROM courses WHERE scope = ? AND id = ?').bind(mine, courseId),
    db.prepare(`SELECT id, type FROM items WHERE scope = ? AND course_id = ? AND deleted_at IS NULL
      AND id IN (SELECT json_extract(value, '$[0]') FROM json_each(?))`).bind(mine, courseId, J),
    db.prepare(`SELECT id FROM items WHERE scope = ? AND deleted_at IS NULL
      AND id IN (SELECT json_extract(value, '$[1]') FROM json_each(?))`).bind(scope, J),
  ]);
  const c = course.results[0];
  if (!c) throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  if (c.deleted_at !== null) return { paired: 0, filed: 0 };
  if (own.results.length !== pairs.length || theirs.results.length !== pairs.length || own.results.some((r) => r.type.startsWith('c-'))) {
    throw new HttpError(400, { error: 'invalid', field: 'pairs' });
  }
  const g = memberGuard(spaceId, userId), f = fromCourse ? 1 : 0;
  const P = `(SELECT json_extract(value, '$[0]') AS mine, json_extract(value, '$[1]') AS shared FROM json_each(?))`;
  const CLASS_COURSE = '(SELECT id FROM courses WHERE scope = ? AND deleted_at IS NULL LIMIT 1)';
  /* the course not merged yet: a second merge racing this one writes nothing */
  const LIVE = 'EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL)';
  /* rows the statement just before changed: meta.changes would also count the change log's trigger writes */
  const COUNT = db.prepare('SELECT changes() AS n');
  const results = await db.batch([
    db.prepare(`INSERT INTO marks (user_id, id, space_id, item_id, status, grade, weight, notes, checklist, completed_at, hidden, created_at, updated_at, revision)
      SELECT ?, ? || ':' || p.shared, ?, p.shared, i.status, i.grade, CASE WHEN i.weight IS NOT s.weight THEN i.weight END, i.notes, i.checklist, i.completed_at, 0, ?, ?, ${NEXT_ROW_REVISION}
      FROM ${P} AS p JOIN items AS i ON i.scope = ? AND i.id = p.mine AND i.course_id = ? AND i.deleted_at IS NULL
        JOIN items AS s ON s.scope = ? AND s.id = p.shared AND s.deleted_at IS NULL
      WHERE (i.status != 'todo' OR i.grade IS NOT NULL OR i.notes != '' OR i.checklist != '[]' OR i.completed_at IS NOT NULL OR (i.weight IS NOT NULL AND i.weight IS NOT s.weight))
        AND ${g.sql} AND ${LIVE}
      ON CONFLICT (user_id, id) DO UPDATE SET
        /* a deleted mark's fields are stale: the incoming values replace them; a live mark wins field by field */
        status = CASE WHEN marks.deleted_at IS NOT NULL OR marks.status = 'todo' THEN excluded.status ELSE marks.status END,
        grade = CASE WHEN marks.deleted_at IS NOT NULL THEN excluded.grade ELSE COALESCE(marks.grade, excluded.grade) END,
        weight = CASE WHEN marks.deleted_at IS NOT NULL THEN excluded.weight ELSE COALESCE(marks.weight, excluded.weight) END,
        notes = CASE WHEN marks.deleted_at IS NOT NULL OR marks.notes = '' THEN excluded.notes ELSE marks.notes END,
        checklist = CASE WHEN marks.deleted_at IS NOT NULL OR marks.checklist = '[]' THEN excluded.checklist ELSE marks.checklist END,
        completed_at = CASE WHEN marks.deleted_at IS NOT NULL THEN excluded.completed_at ELSE COALESCE(marks.completed_at, excluded.completed_at) END,
        hidden = CASE WHEN marks.deleted_at IS NOT NULL THEN excluded.hidden ELSE marks.hidden END,
        deleted_at = NULL, updated_at = excluded.updated_at, revision = marks.revision + 1`)
      .bind(userId, spaceId, spaceId, now, now, J, mine, courseId, scope, ...g.binds, mine, courseId),
    db.prepare(`UPDATE study_sessions SET space_id = ?, course_id = ${CLASS_COURSE},
        item_id = (SELECT p.shared FROM ${P} AS p WHERE p.mine = study_sessions.item_id), updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND (course_id IS NULL OR course_id = ?)
        AND item_id IN (SELECT p.mine FROM ${P} AS p) AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, scope, J, now, userId, courseId, J, ...g.binds, mine, courseId),
    db.prepare(`UPDATE study_sessions SET space_id = ?, course_id = ${CLASS_COURSE}, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND course_id = ? AND item_id IS NULL AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, scope, now, userId, courseId, ...g.binds, mine, courseId),
    db.prepare(`UPDATE study_sessions SET course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND course_id = ? AND ${g.sql} AND ${LIVE}`)
      .bind(now, userId, courseId, ...g.binds, mine, courseId),
    db.prepare(`UPDATE achievements SET space_id = ?,
        course_id = CASE WHEN rule = 'hours' THEN ${CLASS_COURSE} ELSE course_id END,
        item_id = CASE WHEN rule = 'grade' THEN (SELECT p.shared FROM ${P} AS p WHERE p.mine = achievements.item_id) ELSE item_id END,
        updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL
        AND ((rule = 'hours' AND course_id = ?) OR (rule = 'grade' AND item_id IN (SELECT p.mine FROM ${P} AS p))) AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, scope, J, now, userId, courseId, J, ...g.binds, mine, courseId),
    db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
      SELECT ?, ?, ?, color, target, term, archived, ?, ?, ${NEXT_ROW_REVISION} FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${g.sql}
      ON CONFLICT (user_id, id) DO UPDATE SET
        /* a deleted prefs row's values are stale: the course's values replace them */
        target = CASE WHEN space_prefs.deleted_at IS NOT NULL THEN excluded.target ELSE COALESCE(space_prefs.target, excluded.target) END,
        color = CASE WHEN ? OR space_prefs.deleted_at IS NOT NULL THEN excluded.color ELSE space_prefs.color END,
        term = CASE WHEN ? OR space_prefs.deleted_at IS NOT NULL THEN excluded.term ELSE space_prefs.term END,
        archived = CASE WHEN ? OR space_prefs.deleted_at IS NOT NULL THEN excluded.archived ELSE space_prefs.archived END,
        deleted_at = NULL, updated_at = excluded.updated_at, revision = space_prefs.revision + 1`)
      .bind(userId, spaceId, spaceId, now, now, mine, courseId, ...g.binds, f, f, f),
    db.prepare(`UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND id IN (SELECT p.mine FROM ${P} AS p) AND ${g.sql} AND ${LIVE}`)
      .bind(now, now, mine, courseId, J, ...g.binds, mine, courseId),
    COUNT,
    db.prepare(`UPDATE items SET class_id = ?, course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, now, mine, courseId, ...g.binds, mine, courseId),
    COUNT,
    db.prepare(`UPDATE courses SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind(now, now, mine, courseId, ...g.binds),
  ]);
  return { paired: results[7].results[0].n, filed: results[9].results[0].n };
}
