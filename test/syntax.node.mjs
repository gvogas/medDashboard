// Every browser module must parse. Most of public/js needs a DOM, so the vitest suites
// never import it; this catches a syntax error there before it blanks the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
}

test('every public module parses', () => {
  for (const file of [...files('public/js'), 'public/sw.js']) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, file + '\n' + r.stderr);
  }
});

/* The build writes the service worker's list from the files; `npm run dev` serves the
   list as written, so a module left off it does not open offline there. */
test('the service worker lists every module and stylesheet', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  const all = (dir, ext) => readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.some((x) => e.name.endsWith(x)))
    .map((e) => '/' + join(e.parentPath ?? e.path, e.name).replaceAll('\\', '/').replace(/^public\//, ''));
  for (const path of [...all('public/js', ['.js', '.mjs']), ...all('public/css', ['.css'])]) {
    assert.ok(sw.includes("'" + path + "'"), path + ' is missing from SHELL in public/sw.js');
  }
});
