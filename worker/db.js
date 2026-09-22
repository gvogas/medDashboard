// Every query here takes a userId and scopes to it. No exceptions.

const PROFILE_COLS =
  'id, username, display_name, coat_name, coat_role, coat_color, theme, term_start, imported_at, created_at, updated_at';

function profileFromRow(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    coat: { name: r.coat_name, role: r.coat_role, color: r.coat_color },
    theme: r.theme,
    termStart: r.term_start,
    importedAt: r.imported_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The id and stored hash for a username, or null. Only the login route reads the hash. */
export async function getUserForLogin(db, username) {
  return db.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind(username).first();
}

export async function getProfile(db, userId) {
  const row = await db.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE id = ?`).bind(userId).first();
  return row ? profileFromRow(row) : null;
}

export async function updateProfile(db, userId, p, now = Date.now()) {
  await db
    .prepare(
      'UPDATE users SET display_name = ?, coat_name = ?, coat_role = ?, coat_color = ?, theme = ?, term_start = ?, updated_at = ? WHERE id = ?',
    )
    .bind(p.displayName, p.coatName, p.coatRole, p.coatColor, p.theme, p.termStart, now, userId)
    .run();
  return getProfile(db, userId);
}

// ── user-owned rows ─────────────────────────────────────────────────────────
// Each table: `cols` maps API field → column, `toRow`/`fromRow` convert values
// (JSON columns, booleans, the where/location rename).

const jsonIn = (v) => JSON.stringify(v ?? []);
const jsonOut = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? []);

export const TABLES = {
  courses: {
    cols: { code: 'code', name: 'name', color: 'color', instructor: 'instructor', term: 'term', archived: 'archived', meetings: 'meetings' },
    toRow: (c) => ({ ...c, archived: c.archived ? 1 : 0, meetings: jsonIn(c.meetings) }),
    fromRow: (r) => ({ archived: r.archived === 1, meetings: jsonOut(r.meetings) }),
  },
  items: {
    cols: {
      type: 'type', title: 'title', courseId: 'course_id', date: 'date', start: 'start', end: 'end', where: 'location',
      status: 'status', grade: 'grade', weight: 'weight', notes: 'notes', checklist: 'checklist', links: 'links',
      recur: 'recur', weekday: 'weekday', recurUntil: 'recur_until', dept: 'dept', completedAt: 'completed_at',
    },
    toRow: (i) => ({ ...i, checklist: jsonIn(i.checklist), links: jsonIn(i.links) }),
    fromRow: (r) => ({ checklist: jsonOut(r.checklist), links: jsonOut(r.links) }),
  },
  quotes: {
    cols: { text: 'text', source: 'source' },
    toRow: (q) => q,
    fromRow: () => ({}),
  },
};

function rowToApi(table, r) {
  const t = TABLES[table];
  const out = { id: r.id };
  for (const [field, col] of Object.entries(t.cols)) out[field] = r[col];
  Object.assign(out, t.fromRow(r));
  out.createdAt = r.created_at;
  out.updatedAt = r.updated_at;
  out.deletedAt = r.deleted_at ?? null;
  return out;
}

function selectCols(table) {
  return ['id', ...Object.values(TABLES[table].cols), 'created_at', 'updated_at', 'deleted_at'].join(', ');
}

export async function getRow(db, table, userId, id) {
  const r = await db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE user_id = ? AND id = ?`).bind(userId, id).first();
  return r ? rowToApi(table, r) : null;
}

/** A prepared insert-or-update. createdAt is kept on update; a deleted row is revived. */
export function upsertStmt(db, table, userId, id, fields, now) {
  const t = TABLES[table];
  const row = t.toRow(fields);
  const cols = Object.entries(t.cols);
  const names = ['user_id', 'id', ...cols.map(([, col]) => col), 'created_at', 'updated_at', 'deleted_at'];
  const values = [userId, id, ...cols.map(([field]) => row[field] ?? null), now, now, null];
  const updates = [...cols.map(([, col]) => `${col} = excluded.${col}`), 'updated_at = excluded.updated_at', 'deleted_at = NULL'];
  return db
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})
       ON CONFLICT (user_id, id) DO UPDATE SET ${updates.join(', ')}`,
    )
    .bind(...values);
}

export async function upsertRow(db, table, userId, id, fields, now = Date.now()) {
  await upsertStmt(db, table, userId, id, fields, now).run();
  return getRow(db, table, userId, id);
}

/**
 * The prototype's data in one transaction: profile, courses, items, quotes.
 * Returns false if this user has already imported.
 */
export async function importAll(db, userId, { profile, courses, items, quotes }, now = Date.now()) {
  const me = await db.prepare('SELECT imported_at FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.imported_at !== null) return false;
  const stmts = [
    db
      .prepare(
        'UPDATE users SET display_name = ?, coat_name = ?, coat_role = ?, coat_color = ?, theme = ?, term_start = ?, imported_at = ?, updated_at = ? WHERE id = ? AND imported_at IS NULL',
      )
      .bind(profile.displayName, profile.coatName, profile.coatRole, profile.coatColor, profile.theme, profile.termStart, now, now, userId),
    ...courses.map(({ id, ...fields }) => upsertStmt(db, 'courses', userId, id, fields, now)),
    ...items.map(({ id, ...fields }) => upsertStmt(db, 'items', userId, id, fields, now)),
    ...quotes.map(({ id, ...fields }) => upsertStmt(db, 'quotes', userId, id, fields, now)),
  ];
  await db.batch(stmts);
  return true;
}

/** Hard-delete rows soft-deleted before `before`. Items first, so course rows go last. */
export async function purgeTombstones(db, before) {
  await db.batch(
    ['items', 'quotes', 'courses'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`).bind(before),
    ),
  );
}

/** Soft delete. Returns false if the row does not exist for this user. */
export async function deleteRow(db, table, userId, id, now = Date.now()) {
  const exists = await db.prepare(`SELECT 1 AS x FROM ${table} WHERE user_id = ? AND id = ?`).bind(userId, id).first();
  if (!exists) return false;
  const stmts = [
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL`).bind(now, now, userId, id),
  ];
  if (table === 'courses') {
    stmts.push(
      db.prepare('UPDATE items SET course_id = NULL, updated_at = ? WHERE user_id = ? AND course_id = ?').bind(now, userId, id),
    );
  }
  await db.batch(stmts);
  return true;
}

export async function courseExists(db, userId, id) {
  const r = await db.prepare('SELECT 1 AS x FROM courses WHERE user_id = ? AND id = ? AND deleted_at IS NULL').bind(userId, id).first();
  return !!r;
}

/** Every row changed after `since`; deleted rows collapse to {id, deletedAt}. */
export async function syncSince(db, userId, since) {
  const now = Date.now();
  const out = { now };
  for (const table of Object.keys(TABLES)) {
    const { results } = await db
      .prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE user_id = ? AND updated_at > ? ORDER BY updated_at, id`)
      .bind(userId, since)
      .all();
    out[table] = results.map((r) => (r.deleted_at ? { id: r.id, deletedAt: r.deleted_at } : rowToApi(table, r)));
  }
  return out;
}
