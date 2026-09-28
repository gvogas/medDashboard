// The service worker is plain JavaScript served as it is, outside Vite and the type
// check, so this catches a syntax error there before it stops the app from loading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('the service worker parses', () => {
  const r = spawnSync(process.execPath, ['--check', 'public/sw.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'public/sw.js\n' + r.stderr);
});
