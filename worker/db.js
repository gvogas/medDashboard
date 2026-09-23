// Every query here takes a userId and scopes to it. No exceptions.
import { HttpError } from './http.js';

const PROFILE_COLS =
  'id, username, display_name, coat_name, coat_role, coat_color, theme, term_start, created_at, updated_at, revision';

function profileFromRow(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    coat: { name: r.coat_name, role: r.coat_role, color: r.coat_color },
    theme: r.theme,
    termStart: r.term_start,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
  };
}

/** The id and stored hash for a username, or null. Only the login route reads the hash. */
export async function getUserForLogin(db, username) {
  return db.prepare('SELECT id, password_hash, pw_gen FROM users WHERE username = ?').bind(username).first();
}

/** Invalidate every session of this user; returns the new generation. */
export async function bumpPasswordGen(db, userId) {
  return (await db.prepare('UPDATE users SET pw_gen = pw_gen + 1 WHERE id = ? RETURNING pw_gen').bind(userId).first())?.pw_gen;
}

export async function getProfile(db, userId) {
  const row = await db.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE id = ?`).bind(userId).first();
  return row ? profileFromRow(row) : null;
}

export async function updateProfile(db, userId, p, now = Date.now(), revision) {
  const saved = await db
    .prepare(
      `UPDATE users SET display_name = ?, coat_name = ?, coat_role = ?, coat_color = ?, theme = ?, term_start = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING ${PROFILE_COLS}`,
    )
    .bind(p.displayName, p.coatName, p.coatRole, p.coatColor, p.theme, p.termStart, now, userId, revision ?? -1)
    .first();
  if (!saved) throw new HttpError(409, { error: 'conflict', current: await getProfile(db, userId) });
  return profileFromRow(saved);
}

// ── user-owned rows ─────────────────────────────────────────────────────────
// Each table: `cols` maps API field → column, `toRow`/`fromRow` convert values
// (JSON columns, booleans, the where/location rename).

const jsonIn = (v) => JSON.stringify(v ?? []);
const jsonOut = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? []);

const TABLES = {
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
  out.revision = r.revision;
  return out;
}

function selectCols(table) {
  return ['id', ...Object.values(TABLES[table].cols), 'created_at', 'updated_at', 'deleted_at', 'revision'].join(', ');
}

export async function getRow(db, table, userId, id) {
  const r = await db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE user_id = ? AND id = ?`).bind(userId, id).first();
  return r ? rowToApi(table, r) : null;
}

/** Insert or update. createdAt is kept on update; a deleted row is revived. */
function upsertStmt(db, table, userId, id, fields, now, revision) {
  const t = TABLES[table];
  const row = t.toRow(fields);
  const cols = Object.entries(t.cols);
  const names = ['user_id', 'id', ...cols.map(([, col]) => col), 'created_at', 'updated_at', 'deleted_at'];
  const values = [userId, id, ...cols.map(([field]) => row[field] ?? null), now, now, null];
  const updates = [...cols.map(([, col]) => `${col} = excluded.${col}`), 'updated_at = excluded.updated_at', 'deleted_at = NULL', 'revision = revision + 1'];
  const courseGuard = table === 'items' ? ' AND (? IS NULL OR EXISTS (SELECT 1 FROM courses WHERE user_id = ? AND id = ? AND deleted_at IS NULL))' : '';
  const courseBindings = table === 'items' ? [fields.courseId ?? null, userId, fields.courseId ?? null] : [];
  return db
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}, revision) SELECT ${names.map(() => '?').join(', ')}, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1 WHERE (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE user_id = ? AND id = ?))${courseGuard}
       ON CONFLICT (user_id, id) DO UPDATE SET ${updates.join(', ')} WHERE revision = ?
       RETURNING ${selectCols(table)}`,
    )
    .bind(...values, revision, userId, id, ...courseBindings, revision);
}

/** The saved row in API shape, read back in the same statement. */
export async function upsertRow(db, table, userId, id, fields, now = Date.now(), revision = 0) {
  const saved = await upsertStmt(db, table, userId, id, fields, now, revision).first();
  if (!saved) throw new HttpError(409, { error: 'conflict', current: await getRow(db, table, userId, id) });
  return rowToApi(table, saved);
}

/** Hard-delete rows soft-deleted before `before`. Items first, so course rows go last. */
export async function purgeTombstones(db, before) {
  await db.batch(
    [db.prepare('UPDATE sync_state SET floor = MAX(floor, COALESCE((SELECT MAX(seq) FROM changes WHERE deleted_at < ?), 0)) WHERE id = 1').bind(before),
    db.prepare('DELETE FROM changes WHERE deleted_at < ?').bind(before),
    ...['items', 'quotes', 'courses'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`).bind(before),
    )],
  );
}

/** Soft delete. Returns false if the row does not exist for this user. */
export async function deleteRow(db, table, userId, id, now = Date.now(), revision = 0) {
  const exists = await getRow(db, table, userId, id);
  if (!exists) return false;
  if (exists.deletedAt) return true;
  const stmts = [
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE user_id = ? AND id = ? AND deleted_at IS NULL AND revision = ? RETURNING id`).bind(now, now, userId, id, revision),
  ];
  if (table === 'courses') {
    stmts.push(
      db.prepare('UPDATE items SET course_id = NULL, updated_at = ?, revision = revision + 1 WHERE user_id = ? AND course_id = ? AND changes() > 0').bind(now, userId, id),
    );
  }
  const results = await db.batch(stmts);
  if (!results[0].results.length) throw new HttpError(409, { error: 'conflict', current: await getRow(db, table, userId, id) });
  return true;
}

export async function courseExists(db, userId, id) {
  const r = await db.prepare('SELECT 1 AS x FROM courses WHERE user_id = ? AND id = ? AND deleted_at IS NULL').bind(userId, id).first();
  return !!r;
}

/** Every row changed after `since`; deleted rows collapse to {id, deletedAt}. One round trip. */
export async function syncSince(db, userId, since) {
  const now = Date.now();
  const tables = Object.keys(TABLES);
  const pages = await db.batch(
    tables.map((table) =>
      db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE user_id = ? AND updated_at > ? ORDER BY updated_at, id`).bind(userId, since),
    ),
  );
  const out = { now };
  tables.forEach((table, i) => {
    out[table] = pages[i].results.map((r) => (r.deleted_at ? { id: r.id, deletedAt: r.deleted_at } : rowToApi(table, r)));
  });
  return out;
}

/** A bounded page, ordered by commit sequence rather than wall-clock timestamps.
 * The metadata and page share a D1 batch transaction, including during pruning.
 * cursor=0 starts reconciliation; an expired cursor requires the same reset.
 */
export async function syncPage(db, userId, cursor, limit = 100) {
  const [state, page] = await db.batch([
    db.prepare("SELECT floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head FROM sync_state WHERE id = 1"),
    db.prepare('SELECT seq, kind, payload FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?').bind(userId, cursor, limit + 1),
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

// ── Spotify ─────────────────────────────────────────────────────────────────

export async function getSpotifyTokens(db, userId) {
  return db.prepare('SELECT refresh_token, access_token, expires_at FROM spotify_tokens WHERE user_id = ?').bind(userId).first();
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
