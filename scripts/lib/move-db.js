// Copying one database into a fresh one built from migrations/0001_schema.sql.
// Shared by scripts/move-db.mjs and its test, so both read and write the same way.

/* What moves, in an order the foreign keys accept, in the shape of today's schema (each
   table's columns in the schema's own order). Throttles, request windows, OAuth attempts
   and refresh leases are short-lived, so they start empty. users comes first:
   scripts/move-db.mjs refuses a target that holds any user, so a run that failed partway
   is never continued on top of itself. */
export const TABLES = {
  users: ['id', 'username', 'password_hash', 'pw_gen', 'display_name', 'coat_name', 'coat_role', 'coat_color', 'theme', 'bg', 'term_start', 'types', 'study_flow', 'feed_gen', 'feed_off', 'study_prefs', 'school_calendar', 'leaderboard', 'is_admin', 'last_seen_day', 'hidden_sources', 'created_at', 'updated_at', 'revision', 'grading'],
  spaces: ['id', 'kind', 'archived', 'school_calendar', 'parent_space', 'parent_item', 'code_hash', 'code_expires', 'code_uses_left', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  members: ['space_id', 'user_id', 'role', 'joined_at', 'updated_at', 'deleted_at', 'revision'],
  invites: ['space_id', 'user_id', 'invited_by', 'role', 'status', 'created_at', 'expires_at'],
  courses: ['scope', 'id', 'code', 'name', 'color', 'instructor', 'term', 'archived', 'meetings', 'target', 'updated_by', 'created_at', 'updated_at', 'deleted_at', 'revision', 'credits', 'grade_categories'],
  items: ['scope', 'id', 'type', 'title', 'course_id', 'date', 'start', 'end', 'location', 'status', 'grade', 'weight', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recur_until', 'dept', 'completed_at', 'updated_by', 'class_id', 'assignees', 'completed_by', 'created_at', 'updated_at', 'deleted_at', 'revision', 'category'],
  quotes: ['user_id', 'id', 'text', 'source', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  study_sessions: ['user_id', 'id', 'course_id', 'item_id', 'space_id', 'started_at', 'study_minutes', 'rounds_done', 'note', 'manual', 'created_at', 'updated_at', 'deleted_at', 'revision', 'room_id'],
  achievements: ['user_id', 'id', 'name', 'sticker', 'rule', 'course_id', 'item_id', 'space_id', 'target', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  marks: ['user_id', 'id', 'space_id', 'item_id', 'status', 'grade', 'weight', 'notes', 'checklist', 'completed_at', 'hidden', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  space_prefs: ['user_id', 'id', 'space_id', 'color', 'target', 'term', 'archived', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  activity: ['seq', 'space_id', 'actor_id', 'verb', 'subject', 'subject_user', 'old_value', 'new_value', 'detail', 'n', 'bucket', 'at'],
  inbox_seen: ['user_id', 'seq'],
  friendships: ['user_lo', 'user_hi', 'requested_by', 'status', 'created_at', 'accepted_at', 'declined_at', 'cancelled_at'],
  friend_settings: ['user_id', 'findable', 'show_studying'],
  /* Study Buddy: the Gameplay switch and the wallet, so a move keeps everyone's coins. */
  buddy_settings: ['user_id', 'enabled', 'since', 'on_at', 'reconciled_at', 'tz', 'look', 'xp_bonus'],
  buddy_ledger: ['user_id', 'source', 'kind', 'amount', 'day', 'at'],
  rooms: ['id', 'host_id', 'flow', 'started_at', 'paused_at', 'paused_ms', 'skipped_ms', 'skipped_study_ms', 'ended_at', 'feed', 'version', 'created_at'],
  presence: ['user_id', 'course_label', 'started_at', 'ends_at'],
  room_members: ['room_id', 'user_id', 'state', 'invited_by', 'invited_at', 'joined_at', 'joined_study_ms', 'earlier_ms', 'left_at', 'last_seen', 'course_label'],
  room_messages: ['id', 'room_id', 'user_id', 'body', 'created_at'],
  /* Each device keeps its morning digest, and the day it last went out, so nobody turns
     reminders on again or gets a second digest on the day of the move. No trigger. */
  push_subscriptions: ['endpoint', 'user_id', 'tz', 'created_at', 'last_ok_at', 'last_sent_day', 'failures', 'sid'],
  spotify_tokens: ['user_id', 'refresh_token', 'access_token', 'expires_at', 'updated_at'],
  changes: ['seq', 'scope', 'kind', 'row_id', 'payload', 'deleted_at'],
  admin_log: ['id', 'at', 'admin', 'action', 'target', 'detail'],
  /* Sign-outs, kept until each session would have expired anyway, so a move does not revive them. */
  revoked_sessions: ['sid', 'expires_at'],
  /* The sessions a browser holds, copied so a move signs nobody out. */
  sessions: ['sid', 'user_id', 'gen', 'expires_at'],
};

const ORDER_BY = { users: 'id', spaces: 'id', members: 'space_id, user_id', invites: 'space_id, user_id', courses: 'scope, id', items: 'scope, id', activity: 'seq', inbox_seen: 'user_id', friendships: 'user_lo, user_hi', friend_settings: 'user_id', buddy_settings: 'user_id', buddy_ledger: 'user_id, source', rooms: 'id', room_members: 'room_id, user_id', room_messages: 'id', presence: 'user_id', push_subscriptions: 'endpoint', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id', revoked_sessions: 'sid', sessions: 'sid' };
/* Written by triggers as the rows above go in, then replaced by the source's own. */
const REBUILT = ['activity', 'changes'];

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
  return columns.filter(({ tbl, col }) => !LEFT_BEHIND.includes(tbl) && !TABLES[tbl]?.includes(col))
    .map(({ tbl, col }) => `${tbl}.${col}`);
}

/**
 * The reads that make a dump, in today's shape: one per table, plus the feed's floor and
 * head. `columns` are the source's own (COLUMNS_QUERY): a table or column TABLES names that
 * the source lacks is a mismatch between them, so it stops the move rather than reading
 * as empty.
 */
export function readQueries(columns) {
  const has = new Set(columns.map(({ tbl, col }) => `${tbl}.${col}`));
  const pick = (table, col) => {
    if (!has.has(`${table}.${col}`)) throw new Error(`${table}.${col} is not in the source database`);
    return `"${col}"`;
  };
  const out = Object.entries(TABLES).map(([table, cols]) =>
    [table, `SELECT ${cols.map((col) => pick(table, col)).join(', ')} FROM ${table} ORDER BY ${ORDER_BY[table] || 'user_id, id'}`]);
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
  /* A dump read by readQueries has every column (NULL as null); a column a hand-made row
     leaves out is left to the schema's default. */
  const insert = (table, row) => {
    const cols = TABLES[table].filter((c) => row[c] !== undefined);
    return `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')})`;
  };
  for (const table of Object.keys(TABLES)) {
    if (REBUILT.includes(table)) continue;
    for (const row of dump[table] || []) out.push(insert(table, row));
  }
  for (const table of REBUILT) {
    out.push(`DELETE FROM ${table}`);
    for (const row of dump[table] || []) out.push(insert(table, row));
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
