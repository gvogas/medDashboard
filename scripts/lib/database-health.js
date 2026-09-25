// Read-only checks shared by the CLI and D1 tests. Results contain counts only.
const trackerTables = ['courses', 'items', 'quotes', 'study_sessions'];
export const databaseChecks = [
  { name: 'SQLite integrity', sql: 'PRAGMA quick_check', kind: 'integrity' },
  { name: 'Foreign keys', sql: 'PRAGMA foreign_key_check', kind: 'rows' },
  {
    name: 'Positive integer revisions', kind: 'count',
    sql: `SELECT sum(issues) AS issues FROM (${['users', ...trackerTables].map((table) =>
      `SELECT count(*) AS issues FROM ${table} WHERE typeof(revision) != 'integer' OR revision < 1`).join(' UNION ALL ')})`,
  },
  {
    name: 'Active item course references', kind: 'count',
    sql: `SELECT count(*) AS issues FROM items AS i LEFT JOIN courses AS c ON c.user_id = i.user_id AND c.id = i.course_id
      WHERE i.deleted_at IS NULL AND i.course_id IS NOT NULL AND (c.id IS NULL OR c.deleted_at IS NOT NULL)`,
  },
  {
    name: 'Change-feed record coverage', kind: 'count',
    sql: `SELECT sum(issues) AS issues FROM (${trackerTables.map((table) => `
      SELECT count(*) AS issues FROM ${table} AS r LEFT JOIN changes AS c
        ON c.user_id = r.user_id AND c.row_id = r.id AND c.kind = '${table}'
      WHERE c.seq IS NULL OR CASE WHEN json_valid(c.payload) THEN
        json_extract(c.payload, '$.user_id') IS NOT r.user_id OR json_extract(c.payload, '$.id') IS NOT r.id OR
        json_extract(c.payload, '$.revision') IS NOT r.revision OR json_extract(c.payload, '$.deleted_at') IS NOT r.deleted_at
        ELSE 1 END
      `).join(' UNION ALL ')})`,
  },
  {
    name: 'Change-feed orphans', kind: 'count',
    sql: `SELECT count(*) AS issues FROM changes AS c WHERE c.kind NOT IN (${trackerTables.map((t) => `'${t}'`).join(', ')}) OR ${trackerTables.map((table) =>
      `(c.kind = '${table}' AND NOT EXISTS (SELECT 1 FROM ${table} AS r WHERE r.user_id = c.user_id AND r.id = c.row_id))`).join(' OR ')}`,
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
