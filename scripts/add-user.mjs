#!/usr/bin/env node
// Create an account: `npm run user:add -- <username> [--remote] [--name "Display Name"]`
// Change a password:  `npm run user:add -- <username> --reset [--remote]`
// Delete an account:  `npm run user:add -- <username> --delete [--remote]` (and all its data)
// Make an admin:      `npm run user:add -- <username> --admin [--remote]` (opens the Admin page;
//                     `--admin --off` takes it away). After the first, the page does the rest.
// Prompts for the password without echoing it, hashes it exactly as the Worker does,
// and inserts the row with wrangler. --remote targets production; otherwise the
// local dev database.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword, normalizeUsername } from '../worker/password.js';
import { throttleRowsFor } from '../worker/throttle.js';
import { ACCOUNT_TABLES } from '../worker/accounts.js';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const reset = args.includes('--reset');
const remove = args.includes('--delete');
const admin = args.includes('--admin');
const off = args.includes('--off');
const nameIx = args.indexOf('--name');
const displayName = (nameIx >= 0 ? args[nameIx + 1] || '' : '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60);
const rawUser = args.find((a, i) => !a.startsWith('--') && (nameIx < 0 || i !== nameIx + 1));

const username = normalizeUsername(rawUser);
if (!username) {
  console.error('Usage: npm run user:add -- <username> [--remote] [--name "Display Name"]');
  console.error('       npm run user:add -- <username> --reset [--remote]   (change the password)');
  console.error('       npm run user:add -- <username> --delete [--remote]  (remove the account and its data)');
  console.error('       npm run user:add -- <username> --admin [--off] [--remote]  (give or take the Admin page)');
  console.error('Usernames: 3–32 characters, letters, digits, dot, dash, underscore.');
  process.exit(1);
}

// Piped input (a file, a CI step) is read as lines; a terminal gets a hidden prompt.
let piped = null;
async function ask(prompt) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    if (piped === null) {
      let text = '';
      stdin.setEncoding('utf8');
      for await (const chunk of stdin) text += chunk;
      piped = text.split(/\r?\n/);
    }
    return piped.shift() ?? '';
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '') process.exit(1);
        if (ch === '' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

let sql;
if (admin) {
  sql = `UPDATE users SET is_admin = ${off ? 0 : 1} WHERE username = '${username}';`;
} else if (remove) {
  const typed = await ask(`This deletes ${username} and every course, item, quote, study session and achievement it owns. Type the username to confirm: `);
  if (typed.trim().toLowerCase() !== username) { console.error('Not deleted.'); process.exit(1); }
  const owned = `user_id IN (SELECT id FROM users WHERE username = '${username}')`;
  sql = `${ACCOUNT_TABLES.map((t) => `DELETE FROM ${t} WHERE ${owned};`).join(' ')}
         DELETE FROM users WHERE username = '${username}';
         DELETE FROM login_throttle WHERE ${throttleRowsFor(username)};`;
} else {
  const password = await ask(`Password for ${username}: `);
  if (password.length < 8) { console.error('Use at least 8 characters.'); process.exit(1); }
  if (password !== await ask('Again: ')) { console.error('They did not match.'); process.exit(1); }
  const hash = await hashPassword(password);
  const now = Date.now();
  const id = crypto.randomUUID();
  sql = reset
    // A new password also lifts any sign-in lock on the name.
    ? `UPDATE users SET password_hash = '${hash}', pw_gen = pw_gen + 1, updated_at = ${now} WHERE username = '${username}';
       DELETE FROM login_throttle WHERE ${throttleRowsFor(username)};`
    : `INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ('${id}', '${username}', '${hash}', '${displayName.replace(/'/g, "''")}', ${now}, ${now});`;
}

// Judge by wrangler's JSON result, not its exit code: on Windows it sometimes trips an
// assertion while shutting down, after the statement has already run.
// Run the local wrangler with this same Node, no shell, and without handing it our
// stdin (a consumed pipe makes it crash on Windows).
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function run(statement) {
  const result = spawnSync(
    process.execPath, [wranglerBin, 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--json', '--command', statement],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    const start = result.stdout.indexOf('[');
    const rows = JSON.parse(result.stdout.slice(start));
    if (rows.every((r) => r.success)) return rows;
  } catch {}
  console.error(result.stderr || result.stdout);
  return null;
}

if (reset || remove || admin) {
  const found = run(`SELECT 1 AS x FROM users WHERE username = '${username}';`);
  if (!found || found[0].results.length !== 1) { console.error(`No account called ${username}.`); process.exit(1); }
}
const ok = run(sql);
if (!ok) {
  console.error(admin ? 'Could not change admin access.' : remove ? 'Could not delete the account.' : reset ? 'Could not change the password.' : 'Could not create the account. If the username already exists, pick another.');
  process.exit(1);
}
console.log(`${admin ? (off ? 'Admin removed from' : 'Admin given to') : remove ? 'Deleted' : reset ? 'Password changed for' : 'Created'} ${username} on the ${remote ? 'production' : 'local'} database.`);
