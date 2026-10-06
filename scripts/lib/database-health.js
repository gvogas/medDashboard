// Read-only checks shared by the CLI and D1 tests. Results contain counts only.
// Per-table counts are added as scalar subqueries: D1 refuses a compound SELECT of
// more than five terms, and there are more tables than that.
const trackerTables = ['courses', 'items', 'quotes', 'study_sessions', 'achievements'];
/* Courses and items carry their scope; the other tables a user, whose feed is 'u:' || user_id. */
const scoped = (table) => table === 'courses' || table === 'items';
const feedOf = (table, r) => (scoped(table) ? `${r}.scope` : `'u:' || ${r}.user_id`);
const ownerMatches = (table) => (scoped(table)
  ? "json_extract(c.payload, '$.scope') IS NOT r.scope"
  : "json_extract(c.payload, '$.user_id') IS NOT r.user_id");
export const databaseChecks = [
  { name: 'SQLite integrity', sql: 'PRAGMA quick_check', kind: 'integrity' },
  { name: 'Foreign keys', sql: 'PRAGMA foreign_key_check', kind: 'rows' },
  {
    name: 'Positive integer revisions', kind: 'count',
    sql: `SELECT ${['users', ...trackerTables].map((table) =>
      `(SELECT count(*) FROM ${table} WHERE typeof(revision) != 'integer' OR revision < 1)`).join(' + ')} AS issues`,
  },
  {
    name: 'Active item course references', kind: 'count',
    sql: `SELECT count(*) AS issues FROM items AS i LEFT JOIN courses AS c ON c.scope = i.scope AND c.id = i.course_id
      WHERE i.deleted_at IS NULL AND i.course_id IS NOT NULL AND (c.id IS NULL OR c.deleted_at IS NOT NULL)`,
  },
  {
    name: 'Change-feed record coverage', kind: 'count',
    sql: `SELECT ${trackerTables.map((table) => `
      (SELECT count(*) FROM ${table} AS r LEFT JOIN changes AS c
        ON c.scope = ${feedOf(table, 'r')} AND c.row_id = r.id AND c.kind = '${table}'
      WHERE c.seq IS NULL OR CASE WHEN json_valid(c.payload) THEN
        ${ownerMatches(table)} OR json_extract(c.payload, '$.id') IS NOT r.id OR
        json_extract(c.payload, '$.revision') IS NOT r.revision OR json_extract(c.payload, '$.deleted_at') IS NOT r.deleted_at
        ELSE 1 END)
      `).join(' + ')} AS issues`,
  },
  {
    name: 'Change-feed orphans', kind: 'count',
    sql: `SELECT count(*) AS issues FROM changes AS c WHERE c.kind NOT IN (${trackerTables.map((t) => `'${t}'`).join(', ')}) OR ${trackerTables.map((table) =>
      `(c.kind = '${table}' AND NOT EXISTS (SELECT 1 FROM ${table} AS r WHERE ${feedOf(table, 'r')} = c.scope AND r.id = c.row_id))`).join(' OR ')}`,
  },
  {
    // A person's own scope has no foreign key to users; this stands in for one.
    name: 'Personal rows with an account', kind: 'count',
    sql: `SELECT ${['courses', 'items', 'changes'].map((table) =>
      `(SELECT count(*) FROM ${table} WHERE scope GLOB 'u:*' AND substr(scope, 3) NOT IN (SELECT id FROM users))`).join(' + ')} AS issues`,
  },
];

const countedTables = ['users', ...trackerTables, 'changes', 'login_throttle', 'request_limits', 'spotify_tokens', 'spotify_oauth_states', 'spotify_refresh_locks'];
// Scalar subqueries avoid D1's limit on terms in a compound SELECT.
export const databaseCountsSql = 'SELECT ' + countedTables
  .map((table) => `(SELECT count(*) FROM ${table}) AS ${table}`).join(', ');

export function summarizeDatabase(results) {
  if (!Array.isArray(results) || results.length !== databaseChecks.length + 1
    || results.some((result) => !result.success || !Array.isArray(result.results))) {
    throw new Error(`Database checks returned an incomplete result (expected ${databaseChecks.length + 1} successful query results).`);
  }
  const checks = databaseChecks.map((check, index) => {
    const rows = results[index].results;
    const issues = check.kind === 'integrity' ? (rows.length === 1 && rows[0].quick_check === 'ok' ? 0 : Math.max(1, rows.length))
      : check.kind === 'rows' ? rows.length : rows[0]?.issues;
    if (!Number.isSafeInteger(issues) || issues < 0) throw new Error(`Invalid result for ${check.name}.`);
    return { name: check.name, issues };
  });
  const counts = results.at(-1).results;
  if (counts.length !== 1 || countedTables.some((name) => !Number.isSafeInteger(counts[0][name]) || counts[0][name] < 0)) {
    throw new Error('Database checks returned invalid table counts.');
  }
  return { ok: checks.every((check) => check.issues === 0), checks,
    tables: countedTables.map((name) => ({ name, rows: counts[0][name] })) };
}
