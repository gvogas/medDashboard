#!/usr/bin/env node
// Create an account: `npm run user:add -- <username> [--remote] [--name "Display Name"]`
// Prompts for the password without echoing it, hashes it exactly as the Worker does,
// and inserts the row with wrangler. --remote targets production; otherwise the
// local dev database.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword, normalizeUsername } from '../worker/password.js';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const nameIx = args.indexOf('--name');
const displayName = nameIx >= 0 ? args[nameIx + 1] || '' : '';
const rawUser = args.find((a, i) => !a.startsWith('--') && (nameIx < 0 || i !== nameIx + 1));

const username = normalizeUsername(rawUser);
if (!username) {
  console.error('Usage: npm run user:add -- <username> [--remote] [--name "Display Name"]');
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

const password = await ask(`Password for ${username}: `);
if (password.length < 8) { console.error('Use at least 8 characters.'); process.exit(1); }
if (password !== await ask('Again: ')) { console.error('They did not match.'); process.exit(1); }

const hash = await hashPassword(password);
const now = Date.now();
const id = crypto.randomUUID();
const sql = `INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ('${id}', '${username}', '${hash}', '${displayName.replace(/'/g, "''")}', ${now}, ${now});`;

// Judge by wrangler's JSON result, not its exit code: on Windows it sometimes trips an
// assertion while shutting down, after the statement has already run.
// Run the local wrangler with this same Node, no shell, and without handing it our
// stdin (a consumed pipe makes it crash on Windows).
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const result = spawnSync(
  process.execPath, [wranglerBin, 'd1', 'execute', 'rounds', remote ? '--remote' : '--local', '--json', '--command', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
let ok = false;
try {
  const start = result.stdout.indexOf('[');
  ok = start >= 0 && JSON.parse(result.stdout.slice(start)).every((r) => r.success);
} catch {}
if (!ok) {
  console.error(result.stderr || result.stdout);
  console.error('Could not create the account. If the username already exists, pick another.');
  process.exit(1);
}
console.log(`Created ${username} on the ${remote ? 'production' : 'local'} database.`);
