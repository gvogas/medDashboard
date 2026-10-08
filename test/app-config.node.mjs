// app.config.json → the files that repeat its values (scripts/lib/app-config.mjs), on the real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILES, applyConfig, problems, missing, viteEnv, pbxproj, wrangler } from '../scripts/lib/app-config.mjs';

const root = new URL('../', import.meta.url);
const read = (key) => readFileSync(new URL(FILES[key], root), 'utf8');
const shipped = JSON.parse(readFileSync(new URL('app.config.json', root), 'utf8'));
const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const full = { ...shipped, bundleId: 'com.example.study', teamId: 'ABCDE12345', appGroup: 'group.com.example.study', build: 7,
  revenueCatIosKey: 'appl_abcDEF123', signInWithApple: true, appleServicesId: 'com.example.study.web', appleKeyId: 'KEY9876543', paywall: true, sandboxPurchases: true };

test('the shipped config is valid, and the repo already matches it', () => {
  assert.deepEqual(problems(shipped), []);
  const out = applyConfig(shipped, read, version);
  for (const [key, text] of Object.entries(out)) assert.equal(text, read(key), `${FILES[key]} is out of step: run npm run ios:configure`);
});

test('bad values are named', () => {
  const p = problems({ ...shipped, bundleId: 'term', teamId: 'abc', appGroup: 'net.x', build: 0, revenueCatIosKey: 'sk_123', appleKeyId: 'x', paywall: 'yes' });
  assert.equal(p.length, 7);
});

test('a filled-in config reaches every file', () => {
  const out = applyConfig(full, read, version);
  assert.match(out.capacitor, /appId: 'com\.example\.study'/);
  assert.equal((out.pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.example\.study;/g) || []).length, 2);
  /* the app's two configurations and the widget's two */
  assert.equal((out.pbxproj.match(/DEVELOPMENT_TEAM = ABCDE12345;/g) || []).length, 4);
  assert.equal((out.pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.example\.study\.widget;/g) || []).length, 2);
  assert.match(out.pbxproj, /CURRENT_PROJECT_VERSION = 7;/);
  assert.match(out.pbxproj, new RegExp(`MARKETING_VERSION = ${version.replace(/\./g, '\\.')};`));
  for (const k of ['appEntitlements', 'widgetEntitlements']) assert.match(out[k], /<string>group\.com\.example\.study<\/string>/);
  for (const k of ['pluginSwift', 'widgetSwift']) assert.match(out[k], /static let group = "group\.com\.example\.study"/);
  assert.match(out.wrangler, /"APPLE_CLIENT_IDS": "com\.example\.study,com\.example\.study\.web"/);
  assert.match(out.wrangler, /"APPLE_TEAM_ID": "ABCDE12345"/);
  assert.match(out.wrangler, /"PAYWALL": "on"/);
  assert.match(out.wrangler, /"BILLING_SANDBOX": "on"/);
  /* running it twice changes nothing more */
  const again = applyConfig(full, (k) => out[k], version);
  for (const k of Object.keys(out)) assert.equal(again[k], out[k]);
  assert.deepEqual(Object.values(missing(full)).flat(), []);
});

test('a widget target gets the app id plus .widget, and clearing the team removes it', () => {
  const pbx = 'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tDEVELOPMENT_TEAM = OLD1234567;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = net.vogas.term.widget;\nMARKETING_VERSION = 1.0;\nCURRENT_PROJECT_VERSION = 1;';
  const out = pbxproj(pbx, { ...full, teamId: '' }, '2.0.0');
  assert.match(out, /PRODUCT_BUNDLE_IDENTIFIER = com\.example\.study\.widget;/);
  assert.doesNotMatch(out, /DEVELOPMENT_TEAM/);
});

test('Sign in with Apple off clears its Worker settings and the build values', () => {
  const off = { ...full, signInWithApple: false };
  assert.match(wrangler(read('wrangler'), off), /"APPLE_CLIENT_IDS": ""/);
  assert.deepEqual(viteEnv(off, true), { VITE_API_BASE: full.apiBase, VITE_REVENUECAT_IOS_KEY: 'appl_abcDEF123', VITE_APPLE_APP_ID: '' });
  assert.deepEqual(viteEnv(full, false), { VITE_APPLE_WEB_CLIENT_ID: 'com.example.study.web' });
});
