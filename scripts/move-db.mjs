#!/usr/bin/env node
// Copy every table in TABLES (scripts/lib/move-db.js), the change feed and activity included,
// from one D1 database into a fresh one built from migrations/0001_schema.sql, then
// read both back and compare. The source is only read.
//
//   node scripts/move-db.mjs --from rounds-v7 --to rounds-v8 [--remote]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQueries, copyStatements, COLUMNS_QUERY, uncopied, differences } from './lib/move-db.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const from = flag('--from'), to = flag('--to'), remote = args.includes('--remote');
if (!from || !to || from === to) {
  console.error('Usage: node scripts/move-db.mjs --from <database> --to <fresh database> [--remote]');
  process.exit(1);
}

// Run the local wrangler with this same Node, no shell, and judge by its JSON: on
// Windows it sometimes trips an assertion while shutting down, after the work is done,
// and now and then before it has printed anything. A read (--command, always a SELECT
// here) is then run again; the write (--file) never is.
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function d1(db, ...rest) {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', db, remote ? '--remote' : '--local', '--json', '-y', ...rest], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
    });
    try {
      const rows = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')));
      if (rows.every((r) => r.success !== false)) return rows;
    } catch {}
    if (rest[0] === '--command' && !result.stdout.trim() && attempt < 3) continue;
    const how = result.error ? result.error.message : result.signal ? `killed by ${result.signal}` : `exit ${result.status}`;
    throw new Error(`wrangler d1 execute ${db} failed (${how}):\n${(result.stderr || result.stdout || '').trim()}`);
  }
}

function dump(db) {
  const out = {};
  const columns = d1(db, '--command', COLUMNS_QUERY)[0].results;
  for (const [name, sql] of readQueries(columns)) {
    const rows = d1(db, '--command', sql)[0].results;
    out[name] = name === 'state' ? rows[0] : rows;
  }
  return out;
}

try {
  const where = remote ? 'remote' : 'local';
  const fresh = d1(to, '--command', 'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM changes) AS changes')[0].results[0];
  if (fresh.users || fresh.changes) throw new Error(`${to} (${where}) already holds data; the copy only goes into a fresh database.`);

  const left = uncopied(d1(from, '--command', COLUMNS_QUERY)[0].results);
  if (left.length) throw new Error(`${from} has data the copy would drop; add it to TABLES in scripts/lib/move-db.js first: ${left.join(', ')}`);

  console.log(`Reading ${from} (${where})…`);
  const source = dump(from);
  const statements = copyStatements(source);
  const dir = mkdtempSync(path.join(tmpdir(), 'rounds-move-'));
  const file = path.join(dir, 'copy.sql');
  writeFileSync(file, statements.join(';\n') + ';\n');
  console.log(`Writing ${statements.length} statements into ${to}…`);
  d1(to, '--file', file);
  rmSync(dir, { recursive: true, force: true });

  console.log('Comparing…');
  const copied = dump(to);
  const bad = differences(source, copied);
  console.table(Object.fromEntries(Object.keys(source).filter((k) => k !== 'state')
    .map((k) => [k, { [from]: source[k].length, [to]: copied[k].length }])));
  const heads = ({ floor, head, activity_head }) => ({ floor, head, activityHead: activity_head });
  console.log('Change feed', heads(source.state), '→', heads(copied.state));
  if (bad.length) throw new Error('These differ after the copy: ' + bad.join(', '));
  console.log(`Done: ${to} matches ${from}. ${from} was not changed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
