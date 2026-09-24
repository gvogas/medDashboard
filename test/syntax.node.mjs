// Every browser module must parse. Most of public/js needs a DOM, so the vitest suites
// never import it; this catches a syntax error there before it blanks the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
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
