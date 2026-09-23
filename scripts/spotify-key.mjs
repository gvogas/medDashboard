// Provision a separate local key without displaying its value. Existing keys stay intact.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const file = new URL('../.dev.vars', import.meta.url);
let text;
try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; text = ''; }
if (/^SPOTIFY_TOKEN_KEYS\s*=/m.test(text)) {
  console.log('SPOTIFY_TOKEN_KEYS already exists; left unchanged.');
} else {
  const value = JSON.stringify({ current: 'v1', keys: { v1: randomBytes(32).toString('base64url') } });
  await writeFile(file, text.trimEnd() + "\nSPOTIFY_TOKEN_KEYS='" + value + "'\n", { mode: 0o600 });
  console.log('Created the separate local Spotify encryption key (v1).');
}
