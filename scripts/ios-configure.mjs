// npm run ios:configure — copy app.config.json into every file that repeats one of its values:
// the Capacitor config, the Xcode project (bundle ids, team, version, build), the entitlements,
// the App Group in the Swift code, and the Worker's vars in wrangler.jsonc. Safe to run again.
// The front end reads the same file at build time (vite.config.ts). See docs/IOS-TESTING.md.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FILES, applyConfig, problems, missing } from './lib/app-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const bad = problems(cfg);
if (bad.length) {
  console.error('app.config.json needs fixing:\n' + bad.map((p) => '  ✗ ' + p).join('\n'));
  process.exit(1);
}

const read = (key) => { const f = path.join(root, FILES[key]); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
const next = applyConfig(cfg, read, version);
let changed = 0;
for (const [key, text] of Object.entries(next)) {
  if (text === read(key)) continue;
  writeFileSync(path.join(root, FILES[key]), text);
  console.log('  updated ' + FILES[key]);
  changed++;
}
console.log(changed ? `Configured for ${cfg.bundleId} (version ${version}, build ${cfg.build}).` : 'Everything already matches app.config.json.');

const gaps = Object.entries(missing(cfg)).filter(([, v]) => v.length);
if (gaps.length) {
  console.log('\nStill to fill in before everything can be tested (docs/IOS-TESTING.md):');
  const what = { signing: 'running on a phone', purchases: 'Term Pro purchases', signInWithApple: 'Sign in with Apple', signInWithAppleWeb: 'Sign in with Apple on the website', appleRevoke: 'revoking Apple sign-ins on account deletion' };
  for (const [k, v] of gaps) console.log(`  · ${what[k]}: ${v.join(', ')}`);
}
console.log('\nNext: npm run ios:sync, then npm run ios:open. Commit and push wrangler.jsonc so the Worker gets its settings.');
