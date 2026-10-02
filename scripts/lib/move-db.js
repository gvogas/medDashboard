// Copying one database into a fresh one built from migrations/0001_schema.sql.
// Shared by scripts/move-db.mjs and its test, so both read and write the same way.

/* What moves, in an order the foreign keys accept. Throttles, request windows,
   OAuth attempts and refresh leases are short-lived, so they start empty. */
export const TABLES = {
  users: ['id', 'username', 'password_hash', 'pw_gen', 'display_name', 'coat_name', 'coat_role', 'coat_color', 'theme', 'bg', 'term_start', 'types', 'study_flow', 'feed_gen', 'study_prefs', 'school_calendar', 'leaderboard', 'is_admin', 'last_seen_day', 'created_at', 'updated_at', 'revision'],
  courses: ['user_id', 'id', 'code', 'name', 'color', 'instructor', 'term', 'archived', 'meetings', 'target', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  items: ['user_id', 'id', 'type', 'title', 'course_id', 'date', 'start', 'end', 'location', 'status', 'grade', 'weight', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recur_until', 'dept', 'completed_at', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  quotes: ['user_id', 'id', 'text', 'source', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  study_sessions: ['user_id', 'id', 'course_id', 'item_id', 'started_at', 'study_minutes', 'rounds_done', 'note', 'manual', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  achievements: ['user_id', 'id', 'name', 'sticker', 'rule', 'course_id', 'item_id', 'target', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  spotify_tokens: ['user_id', 'refresh_token', 'access_token', 'expires_at', 'updated_at'],
  changes: ['seq', 'user_id', 'kind', 'row_id', 'payload', 'deleted_at'],
  admin_log: ['id', 'at', 'admin', 'action', 'target', 'detail'],
};

const ORDER_BY = { users: 'id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };
/* Short-lived, or filled by the fresh schema itself. The error log, the announcement and
   the cron's last run start fresh too. */
const LEFT_BEHIND = ['error_log', 'app_meta', 'login_throttle', 'request_limits', 'spotify_oauth_states', 'spotify_refresh_locks', 'sync_state', 'd1_migrations'];

/** Every column of the database's own tables, as rows of {tbl, col}. */
export const COLUMNS_QUERY = `SELECT m.name AS tbl, p.name AS col FROM sqlite_master AS m, pragma_table_info(m.name) AS p
  WHERE m.type = 'table' AND substr(m.name, 1, 7) != 'sqlite_' AND substr(m.name, 1, 4) != '_cf_' ORDER BY m.name, p.cid`;

/**
 * `table.column` for each source column the copy would silently leave behind: a table or
 * column added since TABLES was last extended. The comparison after the copy cannot see
 * these, since it reads back only what TABLES names.
 */
export function uncopied(columns) {
  return columns.filter(({ tbl, col }) => !LEFT_BEHIND.includes(tbl) && !TABLES[tbl]?.includes(col)).map(({ tbl, col }) => `${tbl}.${col}`);
}

/** The reads that make a dump: one per table, plus the feed's floor and head. */
export function readQueries() {
  const out = Object.entries(TABLES).map(([table, cols]) =>
    [table, `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY ${ORDER_BY[table] || 'user_id, id'}`]);
  out.push(['state', "SELECT (SELECT floor FROM sync_state WHERE id = 1) AS floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head"]);
  return out;
}

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Cannot copy the number ' + v);
    return String(v);
  }
  if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
  throw new Error('Cannot copy a ' + typeof v);
}

/**
 * The statements that fill a fresh database from a dump ({table: rows, state}).
 * Rows go in first; their triggers write a change feed of their own, which is then
 * replaced by the old one with its sequence numbers, so every device's cursor still
 * points at the same place. The feed's counter is put back to the old head by
 * writing a row at that number and removing it.
 */
export function copyStatements(dump) {
  const out = [];
  for (const [table, cols] of Object.entries(TABLES)) {
    if (table === 'changes') continue;
    for (const row of dump[table] || []) {
      out.push(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')})`);
    }
  }
  out.push('DELETE FROM changes');
  for (const row of dump.changes || []) {
    out.push(`INSERT INTO changes (${TABLES.changes.join(', ')}) VALUES (${TABLES.changes.map((c) => literal(row[c])).join(', ')})`);
  }
  const { floor = 0, head = 0 } = dump.state || {};
  const top = Math.max(0, ...(dump.changes || []).map((c) => c.seq));
  const someone = (dump.users || [])[0];
  if (head > top && someone) {
    out.push(`INSERT INTO changes (seq, user_id, kind, row_id, payload) VALUES (${literal(head)}, ${literal(someone.id)}, 'move', 'move', '{}')`);
    out.push("DELETE FROM changes WHERE kind = 'move' AND row_id = 'move'");
  }
  out.push(`UPDATE sync_state SET floor = ${literal(floor || 0)} WHERE id = 1`);
  return out;
}
