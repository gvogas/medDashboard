// Team projects (spec §10): one 'project' item and its tasks in a 'p:' scope. Making one,
// linking it to a class assignment, leaving it or being removed (no copy: the rows are the
// team's), and deleting it. Tasks themselves are ordinary shared writes (worker/db.js), whose
// member rules have been there since Stage 2. Admins only until Stage 10.
import { HttpError } from './http.js';
import { memberGuard } from './access.js';
import { MY_SPACES, NEXT_ROW_REVISION, NEXT_SPACE_REVISION, SPACE_LIMIT, joinPrefs, randomId, spaceSummary } from './spaces.js';

/** Projects are for admins until Stage 10 opens them (Stage 8 plan, Decision 1). */
export const PROJECTS_ADMINS_ONLY = true;
/** The most live tasks a project holds (spec §3 Limits). */
export const TASK_LIMIT = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SPACE_ID = /^[a-z0-9]{12}$/;
const bad = (field) => new HttpError(400, { error: 'invalid', field });

export const isAdmin = async (db, userId) => (await db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first())?.is_admin === 1;
/** 403 not_admin for a project while they are admins only; `kind` is the space's. */
export async function assertProjectsOpen(db, userId, kind) {
  if (kind === 'project' && PROJECTS_ADMINS_ONLY && !(await isAdmin(db, userId))) throw new HttpError(403, { error: 'not_admin' });
}

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
