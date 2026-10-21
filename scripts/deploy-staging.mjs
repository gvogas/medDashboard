#!/usr/bin/env node
// `npm run deploy:staging`: put the current code on the test copy of the site, rounds-staging
// (wrangler.jsonc env.staging), with its own database and secrets. The live site is not touched.
//
// In order: the staging database id is filled in, the code typechecks, the staging secrets
// are there, the staging database gets any new migrations, Vite builds for staging, and
// Wrangler deploys that build. Last, the build's pointer (.wrangler/deploy/config.json) is
// removed, so no later Wrangler command follows it to staging by mistake.

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './lib/target.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

function step(title, cmd, args, env = {}) {
  console.log('\n— ' + title);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error('Stopped: ' + title + ' failed. Nothing after it ran.');
}
const node = (title, file, args = [], env) => step(title, process.execPath, [file, ...args], env);

if (readFileSync(CONFIG, 'utf8').includes(PLACEHOLDER)) {
  console.error([
    'The staging database is not set up yet. Once:',
    '  npx wrangler d1 create rounds-staging',
    '  → put the database_id it prints in wrangler.jsonc, env.staging (in place of ' + PLACEHOLDER + ')',
    '  npx wrangler secret put SESSION_SECRET --env staging      (a long random value, not the live one)',
    'Then run npm run deploy:staging again. docs/DEPLOYING.md, "Staging", has the rest.',
  ].join('\n'));
  process.exit(1);
}

try {
  step('Typecheck', process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--noEmit']);
  node('Staging secrets', 'scripts/check-secrets.mjs', ['--staging']);
  node('Migrations on the staging database', wrangler, ['d1', 'migrations', 'apply', 'DB', '--config', CONFIG, '--env', 'staging', '--remote']);
  node('Build for staging', fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), ['build'], { CLOUDFLARE_ENV: 'staging' });
  node('Service worker list and CSP check', 'scripts/build.mjs');
  /* no --config: Wrangler deploys what Vite just built, which names rounds-staging */
  node('Deploy to rounds-staging', wrangler, ['deploy']);
  console.log('\nStaging is live at https://rounds-staging.termanitor07.workers.dev');
  console.log('Make an account there with: npm run user:add -- <username> --staging');
} catch (e) {
  console.error('\n' + e.message);
  process.exitCode = 1;
} finally {
  /* the build for staging also stays in dist/; npm run build makes the live one again */
  rmSync(new URL('../.wrangler/deploy/config.json', import.meta.url), { force: true });
}
