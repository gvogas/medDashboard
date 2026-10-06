// Check names only; Wrangler never returns secret values here.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'secret', 'list', '--format', 'json'], { encoding: 'utf8' });
if (result.error || result.status !== 0) throw new Error('Could not verify deployment secrets. Check Wrangler authentication.');
let secrets;
try { secrets = new Set(JSON.parse(result.stdout).map((s) => s.name)); } catch { throw new Error('Unexpected secret list response; deployment stopped.'); }
const required = ['SESSION_SECRET'];
const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
if (/"SPOTIFY_CLIENT_ID"\s*:\s*"[^"]+"/.test(config)) required.push('SPOTIFY_CLIENT_SECRET', 'SPOTIFY_TOKEN_KEYS');
const missing = required.filter((name) => !secrets.has(name));
if (missing.length) throw new Error('Set these Worker secrets before deploying: ' + missing.join(', ') + '. See docs/DEPLOYING.md (Spotify).');
console.log('Required deployment secrets are present.');
