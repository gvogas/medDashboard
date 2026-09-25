#!/usr/bin/env node
// Copy every account, course, item, quote, Spotify connection and the change feed
// from one D1 database into a fresh one built from migrations/0001_schema.sql, then
// read both back and compare. The source is only read.
//
//   node scripts/move-db.mjs --from rounds --to rounds-v2 [--remote]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQueries, copyStatements } from './lib/move-db.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const from = flag('--from'), to = flag('--to'), remote = args.includes('--remote');
if (!from || !to || from === to) {
  console.error('Usage: node scripts/move-db.mjs --from <database> --to <fresh database> [--remote]');
  process.exit(1);
}

// Run the local wrangler with this same Node, no shell, and judge by its JSON: on
// Windows it sometimes trips an assertion while shutting down, after the work is done.
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function d1(db, ...rest) {
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', db, remote ? '--remote' : '--local', '--json', '-y', ...rest], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const rows = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')));
    if (rows.every((r) => r.success !== false)) return rows;
  } catch {}
  throw new Error(`wrangler d1 execute ${db} failed:\n${(result.stderr || result.stdout || '').trim()}`);
}

function dump(db) {
  const out = {};
  for (const [name, sql] of readQueries()) {
    const rows = d1(db, '--command', sql)[0].results;
    out[name] = name === 'state' ? rows[0] : rows;
  }
  return out;
}

try {
  const where = remote ? 'remote' : 'local';
  const fresh = d1(to, '--command', 'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM changes) AS changes')[0].results[0];
  if (fresh.users || fresh.changes) throw new Error(`${to} (${where}) already holds data; the copy only goes into a fresh database.`);

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
  const bad = Object.keys(source).filter((k) => JSON.stringify(source[k]) !== JSON.stringify(copied[k]));
  console.table(Object.fromEntries(Object.keys(source).filter((k) => k !== 'state')
    .map((k) => [k, { [from]: source[k].length, [to]: copied[k].length }])));
  console.log('Change feed', { floor: source.state.floor, head: source.state.head }, '→', { floor: copied.state.floor, head: copied.state.head });
  if (bad.length) throw new Error('These differ after the copy: ' + bad.join(', '));
  console.log(`Done: ${to} matches ${from}. ${from} was not changed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
