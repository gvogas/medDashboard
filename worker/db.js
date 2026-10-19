// Every query here takes a userId and keeps to that person's rows. No exceptions.
// Courses and items belong to a scope, a person's own being 'u:<user id>'; the other
// tables belong to the user directly.
import { HttpError } from './http.js';
import { assertAllowed, editorGuard, memberGuard, parseScope, scopeOf, writerGuard } from './access.js';
import { SPACE_LIMIT } from './spaces.js';
import { MEANINGFUL, autoKeep } from './leaving.js';
import { KEEP_MS } from './activity.js';
import { TASK_LIMIT } from './projects.js';
import { MARK_DEFAULTS, stable } from '../src/core/shared.ts';

const PROFILE_COLS =
  'id, username, display_name, coat_name, coat_role, coat_color, theme, bg, types, study_flow, study_prefs, school_calendar, hidden_sources, term_start, is_admin, created_at, updated_at, revision';

function profileFromRow(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    coat: { name: r.coat_name, role: r.coat_role, color: r.coat_color },
    theme: r.theme,
    bg: r.bg,
    types: jsonOut(r.types),
    studyFlow: flowOut(r.study_flow),
    studyPrefs: prefsOut(r.study_prefs),
    schoolCalendar: prefsOut(r.school_calendar),
    hiddenSources: jsonOut(r.hidden_sources),
    termStart: r.term_start,
    isAdmin: r.is_admin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
  };
}

/**
 * {password_hash, pw_gen, profile} for a username, or null: one read for the whole sign-in.
 * Only the login route reads the hash.
 */
export async function getUserForLogin(db, username) {
  const row = await db.prepare(`SELECT ${PROFILE_COLS}, password_hash, pw_gen FROM users WHERE username = ?`).bind(username).first();
  return row ? { password_hash: row.password_hash, pw_gen: row.pw_gen, profile: profileFromRow(row) } : null;
}

/** Invalidate every session of this user. */
export async function bumpPasswordGen(db, userId) {
  await db.prepare('UPDATE users SET pw_gen = pw_gen + 1 WHERE id = ?').bind(userId).run();
}

export async function getProfile(db, userId) {
  const row = await db.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE id = ?`).bind(userId).first();
  return row ? profileFromRow(row) : null;
}

export async function updateProfile(db, userId, p, now = Date.now(), revision) {
  const saved = await db
    .prepare(
      `UPDATE users SET display_name = ?, coat_name = ?, coat_role = ?, coat_color = ?, theme = ?, bg = ?, types = COALESCE(?, types), study_flow = COALESCE(?, study_flow), study_prefs = COALESCE(?, study_prefs), school_calendar = COALESCE(?, school_calendar), hidden_sources = COALESCE(?, hidden_sources), term_start = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING ${PROFILE_COLS}`,
    )
    .bind(p.displayName, p.coatName, p.coatRole, p.coatColor, p.theme, p.bg, p.types === null ? null : JSON.stringify(p.types), p.studyFlow ? JSON.stringify(p.studyFlow) : null, p.studyPrefs ? JSON.stringify(p.studyPrefs) : null, p.schoolCalendar ? JSON.stringify(p.schoolCalendar) : null, p.hiddenSources ? JSON.stringify(p.hiddenSources) : null, p.termStart, now, userId, revision ?? -1)
    .first();
  if (!saved) throw new HttpError(409, { error: 'conflict', current: await getProfile(db, userId) });
  return profileFromRow(saved);
}

// ── user-owned rows ─────────────────────────────────────────────────────────
// Each table: `cols` maps API field → column, `toRow`/`fromRow` convert values
// (JSON columns, booleans, the where/location rename).

const jsonIn = (v) => JSON.stringify(v ?? []);
// Every JSON column is a list. One unreadable value must not fail a whole sync page.
const jsonOut = (v) => {
  if (typeof v !== 'string') return v ?? [];
  try { return JSON.parse(v); } catch { return []; }
};

const DEFAULT_FLOW = { steps: [['study', 25], ['break', 5]], rounds: 4 };
/* The client fills in defaults (normalizePrefs); an unreadable value is no prefs at all. */
const prefsOut = (v) => {
  try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; }
};
const flowOut = (v) => {
  try { const f = JSON.parse(v); return f && Array.isArray(f.steps) ? f : DEFAULT_FLOW; } catch { return DEFAULT_FLOW; }
};

const TABLES = {
  courses: {
    cols: { code: 'code', name: 'name', color: 'color', instructor: 'instructor', term: 'term', archived: 'archived', meetings: 'meetings', target: 'target' },
    toRow: (c) => ({ ...c, archived: c.archived ? 1 : 0, meetings: jsonIn(c.meetings) }),
    fromRow: (r) => ({ archived: r.archived === 1, meetings: jsonOut(r.meetings), target: r.target ?? null }),
  },
  items: {
    cols: {
      type: 'type', title: 'title', courseId: 'course_id', date: 'date', start: 'start', end: 'end', where: 'location',
      status: 'status', grade: 'grade', weight: 'weight', notes: 'notes', checklist: 'checklist', links: 'links',
      recur: 'recur', weekday: 'weekday', recurUntil: 'recur_until', dept: 'dept', completedAt: 'completed_at',
      classId: 'class_id',
    },
    toRow: (i) => ({ ...i, checklist: jsonIn(i.checklist), links: jsonIn(i.links) }),
    fromRow: (r) => ({ checklist: jsonOut(r.checklist), links: jsonOut(r.links) }),
  },
  quotes: {
    cols: { text: 'text', source: 'source' },
    toRow: (q) => q,
    fromRow: () => ({}),
  },
  study_sessions: {
    cols: { courseId: 'course_id', itemId: 'item_id', startedAt: 'started_at', studyMinutes: 'study_minutes', roundsDone: 'rounds_done', note: 'note', manual: 'manual', spaceId: 'space_id' },
    toRow: (s) => ({ ...s, note: s.note ?? '', manual: s.manual ? 1 : 0 }),
    fromRow: (r) => ({ note: r.note ?? '', manual: r.manual === 1 }),
  },
  achievements: {
    cols: { name: 'name', sticker: 'sticker', rule: 'rule', courseId: 'course_id', itemId: 'item_id', spaceId: 'space_id', target: 'target' },
    toRow: (a) => a,
    fromRow: () => ({}),
  },
  marks: {
    cols: { spaceId: 'space_id', itemId: 'item_id', status: 'status', grade: 'grade', weight: 'weight', notes: 'notes', checklist: 'checklist', completedAt: 'completed_at', hidden: 'hidden' },
    toRow: (m) => ({ ...m, checklist: jsonIn(m.checklist), hidden: m.hidden ? 1 : 0 }),
    fromRow: (r) => ({ checklist: jsonOut(r.checklist), hidden: r.hidden === 1 }),
  },
  space_prefs: {
    cols: { spaceId: 'space_id', color: 'color', target: 'target', term: 'term', archived: 'archived' },
    toRow: (p) => ({ ...p, archived: p.archived ? 1 : 0 }),
    fromRow: (r) => ({ archived: r.archived === 1, target: r.target ?? null }),
  },
};

/* Live achievements an account may hold; each carries its sticker picture. */
const ACHIEVEMENT_LIMIT = 30;
/* Labels an old client never sends (spec §16): left out of a body, the stored value stays. */
const KEPT_WHEN_ABSENT = new Set(['classId', 'spaceId']);

/** The scope of a person's own courses and items. */
export const personal = (userId) => 'u:' + userId;
/* The column that names a row's owner, and its value for this person. */
const SCOPED = new Set(['courses', 'items']);
const ownerCol = (table) => (SCOPED.has(table) ? 'scope' : 'user_id');
const ownerOf = (table, userId) => (SCOPED.has(table) ? personal(userId) : userId);

function rowToApi(table, r) {
  const t = TABLES[table];
  const out = { id: r.id };
  for (const [field, col] of Object.entries(t.cols)) out[field] = r[col];
  Object.assign(out, t.fromRow(r));
  out.createdAt = r.created_at;
  out.updatedAt = r.updated_at;
  out.deletedAt = r.deleted_at ?? null;
  out.revision = r.revision;
  return out;
}

function selectCols(table) {
  return ['id', ...Object.values(TABLES[table].cols), 'created_at', 'updated_at', 'deleted_at', 'revision'].join(', ');
}

export async function getRow(db, table, userId, id) {
  const r = await db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE ${ownerCol(table)} = ? AND id = ?`).bind(ownerOf(table, userId), id).first();
  return r ? rowToApi(table, r) : null;
}

/** Insert or update. createdAt is kept on update; a deleted row is revived. */
function upsertStmt(db, table, userId, id, fields, now, revision, guard = null) {
  const t = TABLES[table];
  const row = t.toRow(fields);
  /* An old client giving a filed item a course of yours unfiles it (the u: CHECK allows one or the other). */
  const absent = (field) => KEPT_WHEN_ABSENT.has(field) && field in t.cols && fields[field] === undefined;
  const cols = Object.entries(t.cols).filter(([field]) => !(field === 'classId' && absent('classId') && !fields.courseId));
  const owner = ownerCol(table), who = ownerOf(table, userId);
  const names = [owner, 'id', ...cols.map(([, col]) => col), 'created_at', 'updated_at', 'deleted_at'];
  const values = [who, id, ...cols.map(([field]) => row[field] ?? null), now, now, null];
  /* A session's or achievement's space, left out, stays while it still names the same course and item;
     pointed elsewhere, the label no longer fits and goes. A new row starts with none. */
  const setCol = ([field, col]) =>
    field === 'spaceId' && absent('spaceId')
      ? `${col} = CASE WHEN ${table}.course_id IS excluded.course_id AND ${table}.item_id IS excluded.item_id THEN ${table}.${col} END`
      : `${col} = excluded.${col}`;
  const updates = [...cols.map(setCol), 'updated_at = excluded.updated_at', 'deleted_at = NULL', 'revision = revision + 1'];
  const courseGuard = table === 'items' ? ' AND (? IS NULL OR EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL))' : '';
  const courseBindings = table === 'items' ? [fields.courseId ?? null, who, fields.courseId ?? null] : [];
  /* a new or revived achievement must fit under the limit; an edit to a live one always does */
  const capGuard = table === 'achievements' ? ' AND (SELECT count(*) FROM achievements WHERE user_id = ? AND id != ? AND deleted_at IS NULL) < ?' : '';
  const capBindings = table === 'achievements' ? [userId, id, ACHIEVEMENT_LIMIT] : [];
  /* a row of your layer goes only where you may keep one (layer.js): the guard runs inside the write */
  const extra = guard ? ` AND ${guard.sql}` : '';
  return db
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}, revision) SELECT ${names.map(() => '?').join(', ')}, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1 WHERE (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE ${owner} = ? AND id = ?))${courseGuard}${capGuard}${extra}
       ON CONFLICT (${owner}, id) DO UPDATE SET ${updates.join(', ')} WHERE revision = ?
       RETURNING ${selectCols(table)}`,
    )
    .bind(...values, revision, who, id, ...courseBindings, ...capBindings, ...(guard ? guard.binds : []), revision);
}

/**
 * The saved row in API shape, read back in the same statement. An item's course is
 * checked by the statement's own guard; only a miss looks further, to tell a course
 * that is not the user's (400) from a stale revision (409).
 */
export async function upsertRow(db, table, userId, id, fields, now = Date.now(), revision = 0, guard = null) {
  const saved = await upsertStmt(db, table, userId, id, fields, now, revision, guard).first();
  if (saved) return rowToApi(table, saved);
  if (guard && !(await passes(db, guard))) throw new HttpError(404, { error: 'not_found' });
  const [current, course, live] = await db.batch([
    db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE ${ownerCol(table)} = ? AND id = ?`).bind(ownerOf(table, userId), id),
    table === 'items' && fields.courseId ? courseStmt(db, userId, fields.courseId) : db.prepare('SELECT 1 AS x'),
    table === 'achievements' ? db.prepare('SELECT count(*) AS n FROM achievements WHERE user_id = ? AND deleted_at IS NULL').bind(userId) : db.prepare('SELECT 0 AS n'),
  ]);
  if (!course.results.length) throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  /* A new or revived achievement at a matching revision missed only because of the limit. */
  const row = current.results[0];
  if (table === 'achievements' && (row ? row.deleted_at !== null && row.revision === revision : revision === 0) && live.results[0].n >= ACHIEVEMENT_LIMIT) {
    throw new HttpError(400, { error: 'too_many', limit: ACHIEVEMENT_LIMIT });
  }
  throw new HttpError(409, { error: 'conflict', current: row ? rowToApi(table, row) : null });
}

const INVITE_DAYS = 90;

/**
 * The nightly purge (spec §13), in order: the marks on expiring shared items are deleted (soft):
 * every mark on a project task, and on a class item those holding nothing; each space deleted
 * before `before` goes with everything in it; then the floor moves and old tombstones go, items
 * first so course rows go last (a class item still holding a meaningful mark waits; a project
 * task never does); invites go 90 days after they were made, activity 90 days after it happened
 * (a purged space's own rows with it, except those about a person). Only then are removed class
 * items holding something of someone's kept for them (autoKeep, bounded), so the sweep never
 * waits on the keeps; their class rows go the next night. Every step acts only on what is
 * already old, so a rerun finds nothing more to do.
 */
export async function purgeTombstones(db, before, now = Date.now()) {
  const GONE = '(SELECT id FROM spaces WHERE deleted_at IS NOT NULL AND deleted_at < ?)';
  const tombstones = (table) => db.prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`).bind(before);
  await db.batch([
    /* soft, so the change feed carries the deletion; the tombstone goes with a later night's sweep. A project task's
       marks go whatever they hold (your note goes with it, spec §13); a class item's only when they hold nothing */
    db.prepare(`UPDATE marks SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM items AS i
      WHERE i.id = marks.item_id AND i.deleted_at IS NOT NULL AND i.deleted_at < ?
        AND (i.scope = 'p:' || marks.space_id OR (i.scope = 'c:' || marks.space_id AND NOT ${MEANINGFUL('marks')})))`).bind(now, now, before),
    /* a gone space's rows go whatever marks they hold: every way a space is deleted (deleteClass, deleteProject, account deletion) leaves no meaningful live mark in it */
    ...['items', 'courses', 'changes'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE scope IN (SELECT 'c:' || id FROM ${GONE} UNION ALL SELECT 'p:' || id FROM ${GONE})`).bind(before, before)),
    ...['members', 'invites', 'marks', 'space_prefs'].map((t) => db.prepare(`DELETE FROM ${t} WHERE space_id IN ${GONE}`).bind(before)),
    /* rows about a person stay with them (their inbox), ageing out like the rest */
    db.prepare(`DELETE FROM activity WHERE subject_user = '' AND space_id IN ${GONE}`).bind(before),
    tombstones('spaces'),
    db.prepare('UPDATE sync_state SET floor = MAX(floor, COALESCE((SELECT MAX(seq) FROM changes WHERE deleted_at < ?), 0)) WHERE id = 1').bind(before),
    db.prepare('DELETE FROM changes WHERE deleted_at < ?').bind(before),
    ...['marks', 'space_prefs', 'members', 'achievements', 'study_sessions'].map(tombstones),
    db.prepare(`DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ? AND (scope NOT GLOB 'c:*' OR NOT EXISTS (SELECT 1 FROM marks AS m
      WHERE m.space_id = substr(items.scope, 3) AND m.item_id = items.id AND m.deleted_at IS NULL AND ${MEANINGFUL('m')}))`).bind(before),
    tombstones('quotes'),
    tombstones('courses'),
    db.prepare('DELETE FROM invites WHERE created_at < ?').bind(now - INVITE_DAYS * 24 * 60 * 60 * 1000),
    db.prepare('DELETE FROM activity WHERE at < ?').bind(now - KEEP_MS),
  ]);
  await autoKeep(db, before, now);
}

/** Soft delete. Returns false if the row does not exist for this user. */
export async function deleteRow(db, table, userId, id, now = Date.now(), revision = 0) {
  const owner = ownerCol(table), who = ownerOf(table, userId);
  const stmts = [
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE ${owner} = ? AND id = ? AND deleted_at IS NULL AND revision = ? RETURNING id`).bind(now, now, who, id, revision),
  ];
  if (table === 'courses') {
    stmts.push(
      db.prepare('UPDATE items SET course_id = NULL, updated_at = ?, revision = revision + 1 WHERE scope = ? AND course_id = ? AND changes() > 0').bind(now, who, id),
    );
  }
  // Study sessions outlive their course and item; only the link goes. The guard is the
  // delete above having happened now (changes() would only see the statement before).
  const unlink = { courses: 'course_id', items: 'item_id' }[table];
  if (unlink) {
    stmts.push(
      db.prepare(`UPDATE study_sessions SET ${unlink} = NULL, updated_at = ?, revision = revision + 1 WHERE user_id = ? AND ${unlink} = ? AND deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM ${table} WHERE ${owner} = ? AND id = ? AND deleted_at = ?)`).bind(now, userId, id, who, id, now),
    );
  }
  const results = await db.batch(stmts);
  if (results[0].results.length) return true;
  // A miss: no such row (404), already deleted (done), or a stale revision (409).
  const current = await getRow(db, table, userId, id);
  if (!current) return false;
  if (current.deletedAt) return true;
  throw new HttpError(409, { error: 'conflict', current });
}

const courseStmt = (db, userId, id) =>
  db.prepare('SELECT 1 AS x FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL').bind(personal(userId), id);

/* Whether a guard holds now: a write it refused was refused for access, not a revision. */
const passes = async (db, guard) => (await db.prepare(`SELECT ${guard.sql} AS ok`).bind(...guard.binds).first()).ok === 1;

/** A bounded page, ordered by commit sequence rather than wall-clock timestamps.
 * The metadata and page share a D1 batch transaction, including during pruning.
 * cursor=0 starts reconciliation; an expired cursor requires the same reset.
 */
export async function syncPage(db, userId, cursor, limit = 100) {
  const [state, page] = await db.batch([
    db.prepare("SELECT floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head FROM sync_state WHERE id = 1"),
    /* only the kinds a client from before Stage 4 knows (spec §16): marks and prefs never reach it */
    db.prepare(`SELECT seq, kind, payload FROM changes WHERE scope = ? AND seq > ? AND kind IN ('courses', 'items', 'quotes', 'study_sessions', 'achievements')
      ORDER BY seq LIMIT ?`).bind(personal(userId), cursor, limit + 1),
  ]);
  const { floor, head } = state.results[0];
  if (cursor && (cursor < floor || cursor > head)) return { reset: true, cursor: 0, changes: [], more: false };
  const rows = page.results.slice(0, limit);
  return {
    reset: false,
    cursor: page.results.length > limit ? rows.at(-1).seq : head,
    more: page.results.length > limit,
    changes: rows.map((r) => ({ kind: r.kind, row: rowToApi(r.kind, JSON.parse(r.payload)) })),
  };
}

// ── shared rows: a class's or a project's courses and items ─────────────────
// The scope comes from the route ('c:' or 'p:' and a space id); every statement carries a
// guard from access.js. A write at the row's revision replaces the row, as a personal one
// does. Otherwise the fields named in `changed` ({field: value before}) merge onto the
// current row when each still holds its old or its new value (spec §6). Personal rows keep
// whole-row If-Match. `updated_by` and `completed_by` come from the session.

/* Columns a shared row has beyond a personal one. */
const SHARED_EXTRA = { courses: ['scope', 'updated_by'], items: ['scope', 'updated_by', 'assignees', 'completed_by'] };
const sharedCols = (table) => `${selectCols(table)}, ${SHARED_EXTRA[table].join(', ')}`;
function sharedToApi(table, r) {
  const out = { ...rowToApi(table, r), scope: r.scope, updatedBy: r.updated_by ?? null };
  if (table === 'items') Object.assign(out, { assignees: jsonOut(r.assignees), completedBy: r.completed_by ?? null });
  return out;
}
/* What each field holds before anyone sets it: what a first write merges against. */
const DEFAULTS = {
  courses: { code: '', name: '', color: null, instructor: '', term: '', meetings: [] },
  items: { type: 'task', title: '', courseId: null, date: null, start: '', end: '', where: '', status: 'todo', weight: null, notes: '', checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: '', completedAt: null, assignees: [] },
};
/* An item's course must be a live course of the same scope (the class's one course). */
const COURSE_LIVE = '(? IS NULL OR EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL))';
/* Every assignee must be a live member of the project; "*" is everyone. */
const ASSIGNEES_LIVE = `NOT EXISTS (SELECT 1 FROM json_each(?) AS a WHERE a.value != '*'
  AND NOT EXISTS (SELECT 1 FROM members AS am WHERE am.space_id = ? AND am.user_id = a.value AND am.deleted_at IS NULL))`;
/* The checks an item write carries besides access: on the fields it writes (all, when `keys` is absent). */
function itemChecks(scope, fields, keys) {
  const out = [];
  if (!keys || keys.includes('courseId')) out.push({ sql: COURSE_LIVE, binds: [fields.courseId ?? null, scope, fields.courseId ?? null] });
  if (scope.startsWith('p:') && (!keys || keys.includes('assignees'))) out.push({ sql: ASSIGNEES_LIVE, binds: [jsonIn(fields.assignees), parseScope(scope).spaceId] });
  return out;
}
const conflict = (current, fields) =>
  new HttpError(409, { error: 'conflict', current, ...(fields ? { fields, by: current?.updatedBy ?? null } : {}) });

/** A shared row in API shape, if this person may read its space; deleted rows included. */
export async function getShared(db, table, scope, userId, id) {
  const g = memberGuard(parseScope(scope).spaceId, userId);
  const r = await db.prepare(`SELECT ${sharedCols(table)} FROM ${table} WHERE scope = ? AND id = ? AND ${g.sql}`).bind(scope, id, ...g.binds).first();
  return r ? sharedToApi(table, r) : null;
}

/* Insert or replace a whole shared row at a revision, as upsertStmt does for a personal one. */
function sharedUpsertStmt(db, table, scope, userId, id, fields, now, revision, guard) {
  const t = TABLES[table], row = t.toRow(fields), cols = Object.entries(t.cols);
  const names = ['scope', 'id', ...cols.map(([, col]) => col), 'updated_by', 'created_at', 'updated_at', 'deleted_at'];
  const values = [scope, id, ...cols.map(([field]) => row[field] ?? null), userId, now, now, null];
  const updates = [...cols.map(([, col]) => `${col} = excluded.${col}`), 'updated_by = excluded.updated_by', 'updated_at = excluded.updated_at', 'deleted_at = NULL', 'revision = revision + 1'];
  const checks = [guard];
  if (table === 'items') {
    names.push('assignees', 'completed_by');
    values.push(jsonIn(fields.assignees), scope.startsWith('p:') && fields.completedAt != null ? userId : null);
    /* whoever completed a task stays named until it is reopened */
    updates.push('assignees = excluded.assignees',
      'completed_by = CASE WHEN excluded.completed_at IS NULL THEN NULL WHEN items.completed_at IS NOT NULL THEN items.completed_by ELSE excluded.completed_by END');
    checks.push(...itemChecks(scope, fields));
    /* a new or revived task needs room in its project (spec §3); a live row always may be written */
    if (scope.startsWith('p:') && fields.type === 'task') {
      checks.push({ sql: `(EXISTS (SELECT 1 FROM items WHERE scope = ? AND id = ? AND deleted_at IS NULL)
        OR (SELECT count(*) FROM items WHERE scope = ? AND type = 'task' AND deleted_at IS NULL) < ${TASK_LIMIT})`, binds: [scope, id, scope] });
    }
  }
  return db.prepare(
    `INSERT INTO ${table} (${names.join(', ')}, revision) SELECT ${names.map(() => '?').join(', ')}, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1
     WHERE (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE scope = ? AND id = ?)) AND ${checks.map((c) => c.sql).join(' AND ')}
     ON CONFLICT (scope, id) DO UPDATE SET ${updates.join(', ')} WHERE revision = ?
     RETURNING ${sharedCols(table)}`,
  ).bind(...values, revision, scope, id, ...checks.flatMap((c) => c.binds), revision);
}

/* Write only `keys` onto the live row at `revision`. Each SET reads the row as it was. */
function sharedFieldsStmt(db, table, scope, userId, id, fields, keys, now, revision, guard) {
  const t = TABLES[table], row = t.toRow(fields), sets = [], binds = [];
  for (const f of keys) {
    if (f === 'assignees') { sets.push('assignees = ?'); binds.push(jsonIn(fields.assignees)); }
    else { sets.push(`${t.cols[f]} = ?`); binds.push(row[f] ?? null); }
  }
  if (table === 'items' && scope.startsWith('p:') && keys.includes('completedAt')) {
    sets.push('completed_by = CASE WHEN ? IS NULL THEN NULL WHEN completed_at IS NOT NULL THEN completed_by ELSE ? END');
    binds.push(fields.completedAt ?? null, userId);
  }
  sets.push('updated_by = ?', 'updated_at = ?', 'revision = revision + 1');
  binds.push(userId, now);
  const checks = [guard, ...(table === 'items' ? itemChecks(scope, fields, keys) : [])];
  return db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE scope = ? AND id = ? AND revision = ? AND deleted_at IS NULL
    AND ${checks.map((c) => c.sql).join(' AND ')} RETURNING ${sharedCols(table)}`)
    .bind(...binds, scope, id, revision, ...checks.flatMap((c) => c.binds));
}

/* Why a guarded write wrote nothing when the revision is not the reason: access (404/403),
   a course outside the class or an assignee outside the project (400). */
async function assertWritable(db, table, scope, userId, fields, need) {
  const { spaceId } = parseScope(scope);
  await assertAllowed(db, userId, spaceId, need);
  if (table !== 'items') return;
  if (fields.courseId && !(await db.prepare('SELECT 1 AS x FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL').bind(scope, fields.courseId).first())) {
    throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  }
  const ids = [...new Set((fields.assignees || []).filter((u) => u !== '*'))];
  if (scope.startsWith('p:') && ids.length) {
    const { n } = await db.prepare('SELECT count(*) AS n FROM members WHERE space_id = ? AND deleted_at IS NULL AND user_id IN (SELECT value FROM json_each(?))').bind(spaceId, JSON.stringify(ids)).first();
    if (n !== ids.length) throw new HttpError(400, { error: 'invalid', field: 'assignees' });
  }
}

/**
 * An owner's or editor's write to a shared row (spec §6 Push): the whole row at its
 * revision; else the fields in `changed` merged onto the current row, with one retry on a
 * lost race; else 409 {current, fields, by}. A create (revision 0) that meets a live row
 * merges against the table's defaults. A deleted row never merges. No `changed` (an old
 * client) is a whole-row write and a plain 409, as today.
 */
export async function upsertShared(db, table, scope, userId, id, fields, { revision = 0, changed, now = Date.now() } = {}) {
  const guard = editorGuard(parseScope(scope).spaceId, userId);
  const saved = await sharedUpsertStmt(db, table, scope, userId, id, fields, now, revision, guard).first();
  if (saved) return sharedToApi(table, saved);
  await assertWritable(db, table, scope, userId, fields, 'editor');
  /* a task not there or deleted is a new one for the limit (reviving a tombstone included) */
  const before = scope.startsWith('p:') && fields.type === 'task' ? await getShared(db, table, scope, userId, id) : undefined;
  if (before !== undefined && (!before || before.deletedAt)) {
    const { n } = await db.prepare("SELECT count(*) AS n FROM items WHERE scope = ? AND type = 'task' AND deleted_at IS NULL").bind(scope).first();
    if (n >= TASK_LIMIT) throw new HttpError(409, { error: 'limit' });
  }
  /* access lost since assertWritable answers as the routes do (404, 403), never as a conflict */
  const refused = async (current, fields) => {
    await assertAllowed(db, userId, parseScope(scope).spaceId, 'editor');
    return conflict(current, fields);
  };
  for (let attempt = 0; ; attempt++) {
    const current = await getShared(db, table, scope, userId, id);
    if (!current) throw await refused(null);
    if (current.deletedAt || !changed) throw conflict(current, changed && Object.keys(changed));
    const keys = Object.keys(changed);
    const old = (f) => (revision === 0 ? DEFAULTS[table][f] : changed[f]);
    const unsafe = keys.filter((f) => stable(current[f]) !== stable(old(f)) && stable(current[f]) !== stable(fields[f]));
    if (unsafe.length) throw conflict(current, unsafe);
    const write = keys.filter((f) => stable(current[f]) !== stable(fields[f]));
    if (!write.length) return current;
    const merged = await sharedFieldsStmt(db, table, scope, userId, id, fields, write, now, current.revision, guard).first();
    if (merged) return sharedToApi(table, merged);
    if (attempt) throw await refused(await getShared(db, table, scope, userId, id), keys);
  }
}

/**
 * A project member's write to a task (spec §5): never the body as a whole. `changed` names
 * only status/completedAt (complete or reopen a task assigned to you or to everyone),
 * assignees (claim an unassigned task, or unclaim yourself, computed from the current list),
 * or both: a claim and a completion queued together on a device go up as one write. Then
 * the status needs you on the task before or after the claim, as the two writes made one
 * after the other would. A member sets only 'todo' or 'done'; the completion time is the
 * Worker's: kept when the task was already complete, now when it becomes so, cleared on
 * reopening. Checked against the current row, written at its revision, one retry; a write
 * that changes nothing is answered with the current row, its revision unmoved.
 */
export async function memberTaskWrite(db, scope, userId, id, fields, { changed, now = Date.now() } = {}) {
  const { spaceId } = parseScope(scope);
  const keys = Object.keys(changed || {});
  const forbidden = () => new HttpError(403, { error: 'forbidden' });
  if (!keys.length || !keys.every((f) => f === 'status' || f === 'completedAt' || f === 'assignees')) throw forbidden();
  const claims = keys.includes('assignees'), finishes = keys.some((f) => f !== 'assignees');
  const guard = writerGuard(spaceId, userId);
  if (keys.includes('status') && fields.status !== 'todo' && fields.status !== 'done') throw forbidden();
  for (let attempt = 0; ; attempt++) {
    await assertAllowed(db, userId, spaceId, 'write');
    const current = await getShared(db, 'items', scope, userId, id);
    if (!current) throw new HttpError(404, { error: 'not_found' });
    if (current.deletedAt) throw conflict(current, keys);
    if (current.type !== 'task') throw forbidden();
    const sets = [], binds = [];
    let next = current.assignees;
    if (claims) {
      const mine = current.assignees.includes(userId), wants = (fields.assignees || []).includes(userId);
      if (wants && !mine) {
        /* taken since you claimed it is a lost race; taken before, it was never yours to claim */
        if (current.assignees.length) throw Array.isArray(changed.assignees) && !changed.assignees.length ? conflict(current, ['assignees']) : forbidden();
        next = [userId];
      } else if (!wants && mine) next = current.assignees.filter((u) => u !== userId);
      if (next !== current.assignees) { sets.push('assignees = ?'); binds.push(JSON.stringify(next)); }
    }
    if (finishes) {
      const on = (list) => list.includes(userId) || list.includes('*');
      if (!on(current.assignees) && !on(next)) throw forbidden();
      /* only the status is the member's; a completion time sent alone changes nothing */
      if (keys.includes('status') && current.status !== fields.status) {
        if (current.status !== changed.status) throw conflict(current, ['status']);
        const completedAt = fields.status === 'todo' ? null : current.completedAt ?? now;
        sets.push('status = ?', 'completed_at = ?', 'completed_by = CASE WHEN ? IS NULL THEN NULL WHEN completed_at IS NOT NULL THEN completed_by ELSE ? END');
        binds.push(fields.status, completedAt, completedAt, userId);
      }
    }
    if (!sets.length) return current;
    const saved = await db.prepare(`UPDATE items SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND id = ? AND revision = ? AND deleted_at IS NULL AND type = 'task' AND ${guard.sql} RETURNING ${sharedCols('items')}`)
      .bind(...binds, userId, now, scope, id, current.revision, ...guard.binds).first();
    if (saved) return sharedToApi('items', saved);
    if (attempt) throw conflict(await getShared(db, 'items', scope, userId, id), keys);
  }
}

/**
 * Soft-delete a shared row (owner or editor). False when there is no such row; true when it
 * is deleted (now or before); 409 {current, by} when it changed since `revision`.
 */
export async function deleteShared(db, table, scope, userId, id, now = Date.now(), revision = 0) {
  const { spaceId } = parseScope(scope);
  const g = editorGuard(spaceId, userId);
  const gone = await db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, updated_by = ?, revision = revision + 1
    WHERE scope = ? AND id = ? AND deleted_at IS NULL AND revision = ? AND ${g.sql} RETURNING id`)
    .bind(now, now, userId, scope, id, revision, ...g.binds).first();
  if (gone) return true;
  await assertAllowed(db, userId, spaceId, 'editor');
  const current = await getShared(db, table, scope, userId, id);
  if (!current) return false;
  if (current.deletedAt) return true;
  throw new HttpError(409, { error: 'conflict', current, by: current.updatedBy });
}

// ── sync v3: a cursor per scope (spec §6 Pull) ──────────────────────────────

/**
 * The person's live spaces (at most 20) as sync describes them, each with its member list
 * when its revision is above `sv` (all of them when sv is 0). A class is named by its
 * course, a project by its 'project' item.
 */
export async function readMemberships(db, userId, sv) {
  const [spaces, members] = await db.batch([
    db.prepare(`SELECT s.id, s.kind, s.archived, s.parent_space, s.parent_item, s.revision, m.role,
        CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
          ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END AS name
      FROM members AS m JOIN spaces AS s ON s.id = m.space_id
      WHERE m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.id LIMIT ?`).bind(userId, SPACE_LIMIT),
    db.prepare(`SELECT o.space_id, o.user_id, o.role, COALESCE(NULLIF(u.display_name, ''), u.username) AS name
      FROM members AS m JOIN spaces AS s ON s.id = m.space_id
      JOIN members AS o ON o.space_id = s.id AND o.deleted_at IS NULL JOIN users AS u ON u.id = o.user_id
      WHERE m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL AND s.revision > ?
      ORDER BY o.space_id, o.joined_at, o.user_id`).bind(userId, sv),
  ]);
  const lists = new Map();
  for (const m of members.results) lists.set(m.space_id, [...(lists.get(m.space_id) || []), { userId: m.user_id, name: m.name, role: m.role }]);
  return spaces.results.map((s) => ({
    id: s.id, scope: scopeOf(s.kind, s.id), kind: s.kind, role: s.role, archived: s.archived === 1, name: s.name ?? '',
    parent: s.parent_space ? { space: s.parent_space, item: s.parent_item } : null, revision: s.revision,
    ...(s.revision > sv ? { members: lists.get(s.id) || [] } : {}),
  }));
}

/**
 * The changes after each [scope, cursor] of `wanted`, read in one batch with the feed's
 * floor and head: a statement per scope, each capped at limit + 1 and, for a space, guarded
 * by live membership inside the statement, so a removal since readMemberships pages
 * nothing. D1 refuses a compound SELECT of more than five terms, so this is a batch rather
 * than one UNION ALL. Rows come back in sequence order, not yet cut; `lost` lists the
 * scopes the guard refused, checked in the same batch.
 */
export async function readPage(db, userId, wanted, limit = 100) {
  const guards = wanted.map(([scope]) => {
    const p = parseScope(scope);
    return p.kind === 'user' ? { sql: p.userId === userId ? '1' : '0', binds: [] } : memberGuard(p.spaceId, userId);
  });
  const [state, access, ...pages] = await db.batch([
    db.prepare("SELECT floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head FROM sync_state WHERE id = 1"),
    db.prepare(`SELECT ${guards.map((g, i) => `(${g.sql}) AS a${i}`).join(', ') || '1 AS none'}`).bind(...guards.flatMap((g) => g.binds)),
    ...wanted.map(([scope, cursor], i) =>
      db.prepare(`SELECT seq, scope, kind, payload FROM changes WHERE scope = ? AND seq > ? AND ${guards[i].sql} ORDER BY seq LIMIT ?`)
        .bind(scope, cursor, ...guards[i].binds, limit + 1)),
  ]);
  const lost = wanted.map(([scope]) => scope).filter((_, i) => !access.results[0][`a${i}`]);
  return { ...state.results[0], lost, rows: pages.flatMap((p) => p.results).sort((a, b) => a.seq - b.seq) };
}

/**
 * A v3 cursor: a sequence, or `r<seq>.<floor>` for a scope resyncing from 0 that is still
 * below the floor, naming the floor its resync began at. Returns {seq, base} (base null
 * for a plain cursor), or null when malformed.
 */
export function parseCursor(token) {
  const m = typeof token === 'number' ? [null, String(token)] : /^(?:(\d{1,16})|r(\d{1,16})\.(\d{1,16}))$/.exec(String(token));
  if (!m) return null;
  const seq = Number(m[1] ?? m[2]), base = m[3] === undefined ? null : Number(m[3]);
  if (!Number.isSafeInteger(seq) || seq < 0 || (base !== null && !Number.isSafeInteger(base))) return null;
  return { seq, base };
}

/**
 * One v3 page. `cursors` is [[scope, cursor]] as the client sent them; `sv` the highest
 * space revision it holds (0 on its first sync after opening). The Worker pages the scopes
 * it builds itself, the person's own and their spaces': a scope sent that is not among them
 * comes back in `revoked`, and one not sent starts at 0. A non-zero cursor below the floor
 * (or above the head) comes back in `reset` at 0, its rows left out, with `more` set;
 * except a resync's tagged cursor (`r<seq>.<floor>`) while the floor has not moved since
 * it began: the client wiped that scope, so a tombstone purged before then is nothing it
 * holds, and a purge since would move the floor. Each cursor moves to just below its
 * scope's first row not delivered (the head when none is left), never back; one still
 * below the floor after a resync from 0 comes back tagged.
 */
export async function syncPageV3(db, userId, cursors, sv, limit = 100) {
  const held = await readMemberships(db, userId, sv);
  const sent = new Map(cursors.map(([s, c]) => [s, parseCursor(c) || { seq: 0, base: null }]));
  const from = (s) => sent.get(s) || { seq: 0, base: null };
  const { floor, head, lost, rows: all } = await readPage(db, userId, [personal(userId), ...held.map((s) => s.scope)].map((s) => [s, from(s).seq]), limit);
  /* a space left since readMemberships pages nothing and keeps no cursor: gone, as if never read */
  const spaces = held.filter((s) => !lost.includes(s.scope));
  const scopes = [personal(userId), ...spaces.map((s) => s.scope)];
  const revoked = [...sent.keys()].filter((s) => !scopes.includes(s));
  const reset = scopes.filter((s) => {
    const { seq, base } = from(s);
    return seq > head || (seq > 0 && seq < floor && base !== floor);
  });
  const rows = all.filter((r) => !reset.includes(r.scope));
  const full = rows.length > limit, page = rows.slice(0, limit);
  const next = (s) => {
    const { seq, base } = from(s);
    const left = rows.slice(limit).find((r) => r.scope === s);
    const at = Math.max(seq, left ? left.seq - 1 : head);
    return at >= floor || at === 0 ? at : `r${at}.${base ?? floor}`;
  };
  return {
    scopes: spaces,
    cursors: Object.fromEntries(scopes.map((s) => [s, reset.includes(s) ? 0 : next(s)])),
    changes: page.map((r) => {
      const raw = JSON.parse(r.payload);
      return { scope: r.scope, kind: r.kind, row: r.scope.startsWith('u:') ? rowToApi(r.kind, raw) : sharedToApi(r.kind, raw) };
    }),
    more: full || reset.length > 0,
    reset,
    revoked,
  };
}

// ── your layer: marks and space prefs (spec §4) ────────────────────────────
// Your own rows, read and written with your user id. A mark goes only on a live item of a
// space you are a live member of (archived or not: your layer still saves), and merges field
// by field like a shared row, since two of your devices may both make it. Prefs need a live
// membership and are whole-row If-Match, like your other rows.

/* A live member of the space, on a live item of it; the binds are the space, you, the space twice, the item. */
function markGuard(spaceId, itemId, userId) {
  const g = memberGuard(spaceId, userId);
  return {
    sql: `${g.sql} AND EXISTS (SELECT 1 FROM items WHERE scope IN ('c:' || ?, 'p:' || ?) AND id = ? AND deleted_at IS NULL)`,
    binds: [...g.binds, spaceId, spaceId, itemId],
  };
}

/**
 * Your mark on `itemId` of `spaceId` (spec §6 Push): the whole mark at its revision; else the
 * fields named in `changed` merged onto the current one when each still holds its old or its
 * new value (a first write merges against MARK_DEFAULTS), with one retry on a lost race; else
 * 409 {current, fields}. 404 when you may not keep a mark there.
 */
export async function upsertMark(db, userId, spaceId, itemId, fields, { revision = 0, changed, now = Date.now() } = {}) {
  const id = spaceId + ':' + itemId, row = { ...fields, spaceId, itemId }, guard = markGuard(spaceId, itemId, userId);
  const saved = await upsertStmt(db, 'marks', userId, id, row, now, revision, guard).first();
  if (saved) return rowToApi('marks', saved);
  const t = TABLES.marks;
  for (let attempt = 0; ; attempt++) {
    if (!(await passes(db, guard))) throw new HttpError(404, { error: 'not_found' });
    const current = await getRow(db, 'marks', userId, id);
    /* a first write onto a mark you deleted revives it whole, still only where you may keep one */
    if (current?.deletedAt && revision === 0) {
      const revived = await upsertStmt(db, 'marks', userId, id, row, now, current.revision, guard).first();
      if (revived) return rowToApi('marks', revived);
      if (attempt) throw conflict(await getRow(db, 'marks', userId, id), changed && Object.keys(changed));
      continue;
    }
    if (!current || current.deletedAt || !changed) throw conflict(current, changed && Object.keys(changed));
    const keys = Object.keys(changed);
    const old = (f) => (revision === 0 ? MARK_DEFAULTS[f] : changed[f]);
    const unsafe = keys.filter((f) => stable(current[f]) !== stable(old(f)) && stable(current[f]) !== stable(row[f]));
    if (unsafe.length) throw conflict(current, unsafe);
    const write = keys.filter((f) => stable(current[f]) !== stable(row[f]));
    if (!write.length) return current;
    const values = t.toRow(row);
    const merged = await db.prepare(`UPDATE marks SET ${write.map((f) => `${t.cols[f]} = ?`).join(', ')}, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL AND ${guard.sql} RETURNING ${selectCols('marks')}`)
      .bind(...write.map((f) => values[f] ?? null), now, userId, id, current.revision, ...guard.binds).first();
    if (merged) return rowToApi('marks', merged);
    if (attempt) throw conflict(await getRow(db, 'marks', userId, id), keys);
  }
}

/** Your prefs for a space you are in, written whole at `revision`; 404 outside it. */
export function upsertPref(db, userId, spaceId, fields, now = Date.now(), revision = 0) {
  return upsertRow(db, 'space_prefs', userId, spaceId, { ...fields, spaceId }, now, revision, memberGuard(spaceId, userId));
}

// ── Spotify ─────────────────────────────────────────────────────────────────

export const spotifyTokensStmt = (db, userId) =>
  db.prepare('SELECT refresh_token, access_token, expires_at FROM spotify_tokens WHERE user_id = ?').bind(userId);

export async function getSpotifyTokens(db, userId) {
  return spotifyTokensStmt(db, userId).first();
}

export async function saveSpotifyTokens(db, userId, { refreshToken, accessToken, expiresAt }, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    )
    .bind(userId, refreshToken, accessToken, expiresAt, now)
    .run();
}

export async function deleteSpotifyTokens(db, userId) {
  await db.prepare('DELETE FROM spotify_tokens WHERE user_id = ?').bind(userId).run();
}

/** A delayed refresh must not recreate a disconnected account or overwrite a reconnect. */
export async function replaceSpotifyTokens(db, userId, previous, fresh) {
  return db.prepare(`UPDATE spotify_tokens SET refresh_token = ?, access_token = ?, expires_at = ?, updated_at = ?
    WHERE user_id = ? AND refresh_token = ? AND access_token = ? AND expires_at = ? RETURNING user_id`)
    .bind(fresh.refreshToken, fresh.accessToken, fresh.expiresAt, Date.now(), userId,
      previous.refresh_token, previous.access_token, previous.expires_at).first();
}

export async function discardSpotifyTokens(db, userId, previous) {
  await db.prepare('DELETE FROM spotify_tokens WHERE user_id = ? AND refresh_token = ? AND access_token = ? AND expires_at = ?')
    .bind(userId, previous.refresh_token, previous.access_token, previous.expires_at).run();
}
