// npm run ios:doctor — is everything in place to test the app? Checks app.config.json, that the
// files match it, the native plugins and the web build, the widget target, and the live Worker
// (deployed with this code, secrets set). Prints what to do for each ✗. docs/IOS-TESTING.md.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FILES, applyConfig, problems } from './lib/app-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const at = (p) => path.join(root, p);
const cfg = JSON.parse(readFileSync(at('app.config.json'), 'utf8'));
const version = JSON.parse(readFileSync(at('package.json'), 'utf8')).version;
let failed = 0;
const ok = (msg) => console.log('  ✓ ' + msg);
const bad = (msg, fix) => { failed++; console.log('  ✗ ' + msg + (fix ? '\n      → ' + fix : '')); };
const skip = (msg) => console.log('  · ' + msg);

console.log('\nSettings (app.config.json)');
const p = problems(cfg);
if (p.length) p.forEach((x) => bad(x)); else ok(`valid: ${cfg.bundleId}, version ${version} build ${cfg.build}`);
cfg.teamId ? ok('teamId set') : bad('teamId is empty: Xcode cannot sign the app for a phone', 'developer.apple.com → Membership → Team ID');
cfg.revenueCatIosKey ? ok('RevenueCat key set') : bad('revenueCatIosKey is empty: Term Pro cannot be bought', 'RevenueCat → Project → API keys → Apple (appl_…)');
if (cfg.signInWithApple) {
  ok('Sign in with Apple on');
  cfg.appleServicesId ? ok('website Services ID set') : skip('no appleServicesId: the website shows no Apple button (the app still does)');
  cfg.appleKeyId ? ok('Apple key id set') : skip('no appleKeyId: deleting an account will not revoke Apple sign-in (Apple asks for it before release)');
} else skip('Sign in with Apple off (set signInWithApple: true to test it)');
console.log(`  · paywall ${cfg.paywall ? 'ON (free plan limited in the app)' : 'off (everyone has everything)'}, sandbox purchases ${cfg.sandboxPurchases ? 'counted' : 'NOT counted'}`);
if (!cfg.sandboxPurchases) skip('set sandboxPurchases: true to test buying Pro from Xcode or TestFlight');

console.log('\nFiles');
const read = (key) => (existsSync(at(FILES[key])) ? readFileSync(at(FILES[key]), 'utf8') : null);
const out = applyConfig(cfg, read, version);
const stale = Object.keys(out).filter((k) => out[k] !== read(k)).map((k) => FILES[k]);
stale.length ? bad('out of step with app.config.json: ' + stale.join(', '), 'npm run ios:configure') : ok('every file matches app.config.json');
for (const pkg of ['@capacitor/ios', '@revenuecat/purchases-capacitor', '@capawesome/capacitor-apple-sign-in', '@capacitor/local-notifications', 'term-widgets']) {
  if (!existsSync(at('node_modules/' + pkg))) { bad(pkg + ' is not installed', 'npm install'); break; }
}
existsSync(at('ios/App/App/public/index.html')) ? ok('the app has a web build in it') : bad('the app has no web build yet', 'npm run ios:sync');
const pbx = read('pbxproj') || '';
/\/\* TermWidget \*\/ = \{\s*isa = PBXNativeTarget/.test(pbx) ? ok('widget target is in the Xcode project') : bad('no widget target yet', 'npm run ios:widget (or the steps in docs/IOS.md → Widgets)');

console.log('\nThe Worker (' + cfg.apiBase + ')');
async function status(method, route) {
  try { return (await fetch(new URL(route, cfg.apiBase), { method, signal: AbortSignal.timeout(8000) })).status; } catch { return 0; }
}
const plan = await status('GET', '/api/plan');
if (plan === 0) bad('cannot reach it', 'check apiBase and your connection');
else if (plan === 404) bad('it does not have this code yet (/api/plan is missing)', 'npm run db:remote, then merge and push to main');
else {
  ok('reachable, with this code deployed');
  const hook = await status('POST', '/api/billing/revenuecat');
  hook === 401 ? ok('RevenueCat webhook secret is set') : hook === 503 ? bad('RevenueCat webhook secret is not set', 'npm run ios:secrets') : bad(`webhook answered ${hook}`);
  const nonce = await status('GET', '/api/login/apple/nonce');
  if (cfg.signInWithApple) nonce === 200 ? ok('Sign in with Apple is on at the Worker') : bad('Sign in with Apple is off at the Worker', 'npm run ios:configure, then commit and push wrangler.jsonc');
  else skip(`Sign in with Apple at the Worker: ${nonce === 200 ? 'on' : 'off'}`);
}
const list = spawnSync(process.execPath, [at('node_modules/wrangler/bin/wrangler.js'), 'secret', 'list', '--format', 'json'], { encoding: 'utf8' });
if (list.status === 0) {
  try {
    const names = new Set(JSON.parse(list.stdout).map((s) => s.name));
    if (cfg.signInWithApple && cfg.appleKeyId) names.has('APPLE_PRIVATE_KEY') ? ok('APPLE_PRIVATE_KEY is set') : bad('APPLE_PRIVATE_KEY is not set', 'npm run ios:secrets -- --skip-webhook --p8 path/to/AuthKey.p8');
  } catch { skip('could not read the secret list'); }
} else skip('Wrangler is not signed in here, so the secrets list was not checked (npx wrangler login)');

console.log(failed ? `\n${failed} thing${failed > 1 ? 's' : ''} to fix. See docs/IOS-TESTING.md.\n` : '\nReady to test. npm run ios:open and press Run.\n');
process.exit(failed ? 1 : 0);
