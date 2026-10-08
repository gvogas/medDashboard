// npm run ios:secrets — put the app's two server secrets on the Worker with Wrangler (you need
// `npx wrangler login` once). Nothing is written to the repo.
//
//   REVENUECAT_WEBHOOK_SECRET  made here, at random; paste it into RevenueCat's webhook settings
//   APPLE_PRIVATE_KEY          the .p8 key file of your Sign in with Apple key (optional)
//
// Usage: npm run ios:secrets [-- --p8 path/to/AuthKey_XXXXXXXXXX.p8] [-- --skip-webhook]

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const args = process.argv.slice(2);
const p8 = args.includes('--p8') ? args[args.indexOf('--p8') + 1] : null;
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');

function put(name, value) {
  const r = spawnSync(process.execPath, [wrangler, 'secret', 'put', name], { input: value, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error(`Could not set ${name}. Is Wrangler signed in? Run: npx wrangler login`); process.exit(1); }
}

if (!args.includes('--skip-webhook')) {
  const secret = randomBytes(24).toString('base64url');
  put('REVENUECAT_WEBHOOK_SECRET', secret);
  console.log('\nIn RevenueCat → Project settings → Integrations → Webhooks → Add:');
  console.log(`  Webhook URL:           ${new URL('/api/billing/revenuecat', cfg.apiBase)}`);
  console.log(`  Authorization header:  Bearer ${secret}`);
  console.log('  Environment:           Both (sandbox and production)\n');
  console.log('Copy the header value now: it is not stored anywhere else. Running this again makes a new one.\n');
}

if (p8) {
  if (!existsSync(p8)) { console.error(`No file at ${p8}`); process.exit(1); }
  const key = readFileSync(p8, 'utf8');
  if (!key.includes('BEGIN PRIVATE KEY')) { console.error(`${p8} is not a .p8 private key`); process.exit(1); }
  put('APPLE_PRIVATE_KEY', key);
  const id = /AuthKey_([A-Z0-9]{10})\.p8$/.exec(p8)?.[1];
  if (id && id !== cfg.appleKeyId) console.log(`Note: the file's key id is ${id}, but app.config.json has appleKeyId "${cfg.appleKeyId}". Make them match, then run npm run ios:configure.`);
  console.log('APPLE_PRIVATE_KEY is set.');
} else if (cfg.signInWithApple) {
  console.log('Sign in with Apple is on. To let account deletion revoke it, also run:\n  npm run ios:secrets -- --skip-webhook --p8 path/to/AuthKey_XXXXXXXXXX.p8');
}
