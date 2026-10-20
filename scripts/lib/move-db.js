// Copying one database into a fresh one built from migrations/0001_schema.sql.
// Shared by scripts/move-db.mjs and its test, so both read and write the same way.

/* What moves, in an order the foreign keys accept, in the shape of today's schema.
   Throttles, request windows, OAuth attempts and refresh leases are short-lived, so they
   start empty. users comes first: scripts/move-db.mjs refuses a target that holds any
   user, so a run that failed partway is never continued on top of itself. */
export const TABLES = {
  users: ['id', 'username', 'password_hash', 'pw_gen', 'display_name', 'coat_name', 'coat_role', 'coat_color', 'theme', 'bg', 'term_start', 'types', 'study_flow', 'feed_gen', 'study_prefs', 'school_calendar', 'leaderboard', 'is_admin', 'last_seen_day', 'hidden_sources', 'grading', 'created_at', 'updated_at', 'revision'],
  spaces: ['id', 'kind', 'archived', 'school_calendar', 'parent_space', 'parent_item', 'code_hash', 'code_expires', 'code_uses_left', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  members: ['space_id', 'user_id', 'role', 'joined_at', 'updated_at', 'deleted_at', 'revision'],
  invites: ['space_id', 'user_id', 'invited_by', 'role', 'status', 'created_at', 'expires_at'],
  courses: ['scope', 'id', 'code', 'name', 'color', 'instructor', 'term', 'archived', 'meetings', 'target', 'credits', 'grade_categories', 'updated_by', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  items: ['scope', 'id', 'type', 'title', 'course_id', 'date', 'start', 'end', 'location', 'status', 'grade', 'weight', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recur_until', 'dept', 'completed_at', 'updated_by', 'class_id', 'category', 'assignees', 'completed_by', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  quotes: ['user_id', 'id', 'text', 'source', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  study_sessions: ['user_id', 'id', 'course_id', 'item_id', 'space_id', 'started_at', 'study_minutes', 'rounds_done', 'note', 'manual', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  achievements: ['user_id', 'id', 'name', 'sticker', 'rule', 'course_id', 'item_id', 'space_id', 'target', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  marks: ['user_id', 'id', 'space_id', 'item_id', 'status', 'grade', 'weight', 'notes', 'checklist', 'completed_at', 'hidden', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  space_prefs: ['user_id', 'id', 'space_id', 'color', 'target', 'term', 'archived', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  activity: ['seq', 'space_id', 'actor_id', 'verb', 'subject', 'subject_user', 'old_value', 'new_value', 'detail', 'n', 'bucket', 'at'],
  inbox_seen: ['user_id', 'seq'],
  spotify_tokens: ['user_id', 'refresh_token', 'access_token', 'expires_at', 'updated_at'],
  changes: ['seq', 'scope', 'kind', 'row_id', 'payload', 'deleted_at'],
  admin_log: ['id', 'at', 'admin', 'action', 'target', 'detail'],
};

/* Tables added after rounds-v7's first schema (0002_spaces.sql … 0005_activity.sql): a
   database made before them has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members', 'invites', 'marks', 'space_prefs', 'activity', 'inbox_seen']);
const ORDER_BY = { users: 'id', spaces: 'id', members: 'space_id, user_id', invites: 'space_id, user_id', courses: 'scope, id', items: 'scope, id', activity: 'seq', inbox_seen: 'user_id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };
/* Written by triggers as the rows above go in, then replaced by the source's own. */
const REBUILT = ['activity', 'changes'];

/* Reading rounds-v6 or older, whose courses, items and change feed name a user: the owner
   becomes the scope of that person's own rows, a course's or item's change names the
   scope in its payload too, and columns the old schema lacks read as today's defaults. */
const SCOPE_FROM_USER = `'u:' || "user_id" AS "scope"`;
const PAYLOAD_FROM_USER = `CASE WHEN kind IN ('courses', 'items') AND json_valid(payload) AND json_type(payload, '$.user_id') = 'text'
  THEN json_set(json_remove(payload, '$.user_id'), '$.scope', 'u:' || json_extract(payload, '$.user_id')) ELSE payload END AS "payload"`;
const DEFAULTS = { assignees: "'[]'", hidden_sources: "'[]'", grade_categories: "'[]'", grading: "'{}'" };
/* Columns added since rounds-v6, by v7's first schema or a later migration (0007_grades.sql). */
const ADDED_IN_V7 = new Set(['hidden_sources', 'updated_by', 'class_id', 'assignees', 'completed_by', 'space_id', 'credits', 'grade_categories', 'category', 'grading']);
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
  return columns.filter(({ tbl, col }) => !LEFT_BEHIND.includes(tbl) && !TABLES[tbl]?.includes(col)
    && !(col === 'user_id' && TABLES[tbl]?.includes('scope')))
    .map(({ tbl, col }) => `${tbl}.${col}`);
}

/**
 * The reads that make a dump, in today's shape: one per table, plus the feed's floor and
 * head. `columns` are the source's own (COLUMNS_QUERY), so an older database is adapted.
 */
export function readQueries(columns) {
  const has = new Set(columns.map(({ tbl, col }) => `${tbl}.${col}`));
  const tables = new Set(columns.map(({ tbl }) => tbl));
  const pick = (table, col) => {
    if (has.has(`${table}.${col}`)) return `"${col}"`;
    if (col === 'scope' && has.has(`${table}.user_id`)) return SCOPE_FROM_USER;
    /* Only the columns rounds-v7 added may be missing from the source; any other gap is a
       mismatch between TABLES and the source, and reading it as NULL would hide it. */
    if (!ADDED_IN_V7.has(col)) throw new Error(`${table}.${col} is not in the source database`);
    return `${DEFAULTS[col] ?? 'NULL'} AS "${col}"`;
  };
  const out = Object.entries(TABLES).map(([table, cols]) => {
    if (ADDED_TABLES.has(table) && !tables.has(table)) return [table, `SELECT ${cols.map((col) => `NULL AS "${col}"`).join(', ')} WHERE 0`];
    const list = cols.map((col) => (table === 'changes' && col === 'payload' && has.has('changes.user_id') ? PAYLOAD_FROM_USER : pick(table, col)));
    return [table, `SELECT ${list.join(', ')} FROM ${table} ORDER BY ${ORDER_BY[table] || 'user_id, id'}`];
  });
  out.push(['state', `SELECT (SELECT floor FROM sync_state WHERE id = 1) AS floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head,
    COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'activity'), 0) AS activity_head`]);
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
 * Rows go in first; their triggers write a change feed and activity of their own, which
 * are then replaced by the old ones with their sequence numbers. Each counter is put back
 * to the old head (for activity, at least every read marker) by writing a row at that
 * number and removing it, so every device's cursor still points at the same place and no
 * row written after the move reuses a number someone has already read past.
 */
export function copyStatements(dump) {
  const out = [];
  /* a column a row leaves out (a dump made before it was added) takes its default, as readQueries gives it */
  const value = (row, c) => (row[c] === undefined && DEFAULTS[c] ? DEFAULTS[c] : literal(row[c]));
  for (const [table, cols] of Object.entries(TABLES)) {
    if (REBUILT.includes(table)) continue;
    for (const row of dump[table] || []) {
      out.push(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => value(row, c)).join(', ')})`);
    }
  }
  for (const table of REBUILT) {
    out.push(`DELETE FROM ${table}`);
    for (const row of dump[table] || []) {
      out.push(`INSERT INTO ${table} (${TABLES[table].map((c) => `"${c}"`).join(', ')}) VALUES (${TABLES[table].map((c) => literal(row[c])).join(', ')})`);
    }
  }
  const { floor = 0, head = 0 } = dump.state || {};
  const top = Math.max(0, ...(dump.changes || []).map((c) => c.seq));
  const someone = (dump.users || [])[0];
  if (head > top && someone) {
    out.push(`INSERT INTO changes (seq, scope, kind, row_id, payload) VALUES (${literal(head)}, ${literal('u:' + someone.id)},'move', 'move', '{}')`);
    out.push("DELETE FROM changes WHERE kind = 'move' AND row_id = 'move'");
  }
  const activityHead = Math.max(dump.state?.activity_head || 0, ...(dump.inbox_seen || []).map((r) => r.seq));
  const activityTop = Math.max(0, ...(dump.activity || []).map((a) => a.seq));
  if (activityHead > activityTop) {
    out.push(`INSERT INTO activity (seq, space_id, actor_id, verb, subject, bucket, at) VALUES (${literal(activityHead)}, 'move00000000', 'move', 'space.deleted', 'move', 0, 0)`);
    out.push("DELETE FROM activity WHERE space_id = 'move00000000' AND actor_id = 'move' AND subject = 'move'");
  }
  out.push(`UPDATE sync_state SET floor = ${literal(floor || 0)} WHERE id = 1`);
  return out;
}

/**
 * The parts of a dump that differ after the copy, as a list of keys ([] when it matches).
 * Rows and the change feed's floor and head must be the same. The activity counter may end
 * higher: rows the triggers wrote while copying shared items, or a read marker above the
 * newest kept row, move it on.
 */
export function differences(source, copied) {
  return Object.keys(source).filter((k) => {
    if (k !== 'state') return JSON.stringify(source[k]) !== JSON.stringify(copied[k]);
    const a = source.state || {}, b = copied.state || {};
    return a.floor !== b.floor || a.head !== b.head || !((b.activity_head ?? 0) >= (a.activity_head ?? 0));
  });
}
