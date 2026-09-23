#!/usr/bin/env node
// Inspect the existing database without changing records or printing credentials.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { databaseChecks, databaseCountsSql, summarizeDatabase } from './lib/database-health.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--remote', '--json'].includes(arg))) {
  console.error('Usage: npm run db:check -- [--remote] [--json]');
  process.exit(1);
}
const remote = args.includes('--remote');
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const sql = [...databaseChecks.map((check) => check.sql), databaseCountsSql].join(';\n') + ';';
const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'rounds', remote ? '--remote' : '--local', '--json', '--command', sql], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
});
try {
  if (result.error) throw new Error(`Could not start the database check: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Could not inspect the database. Check Wrangler access and apply pending migrations first.\n${result.stderr.trim()}`);
  const report = { target: remote ? 'production' : 'local', ...summarizeDatabase(JSON.parse(result.stdout)) };
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Rounds database: ${report.target}`);
    for (const check of report.checks) console.log(`${check.issues ? 'FAIL' : 'OK'}  ${check.name}${check.issues ? ` (${check.issues} issues)` : ''}`);
    console.table(report.tables);
    console.log(report.ok ? 'All checks passed. No records were changed.' : 'Integrity issues found. No records were changed.');
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
