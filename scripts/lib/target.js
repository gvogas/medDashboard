// Which database a script works on: `--remote` the live one, `--staging` the test copy
// (wrangler.jsonc's env.staging, `npm run deploy:staging`), neither the local dev one.
//
// wrangler.jsonc is always named. Without it, Wrangler follows .wrangler/deploy/config.json
// to whatever Vite built last, so after a staging build a "--remote" command would quietly
// work on the staging database instead of the live one.

import { fileURLToPath } from 'node:url';

export const CONFIG = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url));

/** { remote, staging, label, args }: `args` are Wrangler's for a `d1` or `secret` command. */
export function target(argv) {
  const staging = argv.includes('--staging');
  const remote = staging || argv.includes('--remote');
  return {
    remote, staging,
    label: staging ? 'staging' : remote ? 'production' : 'local',
    args: ['--config', CONFIG, ...(staging ? ['--env', 'staging'] : []), ...(remote ? ['--remote'] : ['--local'])],
  };
}
