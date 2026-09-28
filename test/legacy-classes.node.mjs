// Until the legacy UI is gone, its CSS shares the page with Tailwind, and Tailwind's
// utilities sit in a later cascade layer, so they win. A legacy class that is also a
// utility name (the table view's "fixed" was one) gets the utility's styles as soon as
// any React code uses that utility. This keeps the two sets of names apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'tailwindcss';

const files = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? (e.name === 'vendor' ? [] : files(join(d, e.name))) : [join(d, e.name)]);

/* The same meaning in both: visually hidden, still read aloud. */
const SAME_MEANING = new Set(['sr-only']);

function legacyClassNames() {
  const names = new Set();
  /* the markup that still carries legacy class names */
  const markup = ['index.html', 'src/components/app.tsx', 'src/components/shell.tsx'].filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const m of markup.matchAll(/class(?:Name)?\s*=\s*\\?["'`]([^"'`\\]*)/g)) for (const t of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(t)) names.add(t);
  for (const m of markup.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([\w-]+)['"]/g)) names.add(m[1]);
  /* el.className = cond ? 'a b' : 'c': the strings it is set to, not those it is compared with */
  for (const m of markup.matchAll(/className\s*=([^;\n]*)/g)) {
    for (const v of m[1].matchAll(/(?:^|[?:+]|\s=)\s*['"]([a-z][\w -]*)['"]/g)) for (const t of v[1].split(/\s+/)) if (t) names.add(t);
  }
  for (const f of files('src/legacy/css')) for (const m of readFileSync(f, 'utf8').matchAll(/\.([a-z][\w-]*)/g)) names.add(m[1]);
  return names;
}

test('no legacy class name is also a Tailwind utility', async () => {
  const content = readFileSync('node_modules/tailwindcss/utilities.css', 'utf8');
  const clashes = [];
  for (const name of legacyClassNames()) {
    if (SAME_MEANING.has(name)) continue;
    const tw = await compile('@import "tailwindcss/utilities.css";', { base: process.cwd(), loadStylesheet: async (id, base) => ({ base, path: id, content }) });
    const css = tw.build([name]);
    if (css.includes('.' + name + ' {') || css.includes('.' + name + '{')) clashes.push(name);
  }
  assert.deepEqual(clashes.sort(), [], 'Rename these legacy classes: ' + clashes.join(', '));
});
