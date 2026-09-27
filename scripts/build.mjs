// Runs after `vite build`: checks what Vite made, then gives the service worker its list.
// Vite has already put every script and stylesheet under /assets/ with a content hash in
// its name, so a URL there never changes its content (_headers caches it for a year).

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const client = path.join(root, 'dist', 'client');

async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(dir, entry.name), rel + '/'));
    else result.push(rel);
  }
  return result.sort();
}

// 1. The inline theme script is the only inline script, and the CSP allows it by hash.
const html = await readFile(path.join(client, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const inline = scripts.filter(([, attrs]) => !/\bsrc=/.test(attrs));
if (inline.length !== 1) throw new Error(`Expected one inline script (the theme), found ${inline.length}`);
const cspHash = 'sha256-' + createHash('sha256').update(inline[0][2]).digest('base64');
const headers = await readFile(path.join(client, '_headers'), 'utf8');
if (!headers.includes(cspHash)) throw new Error('Theme script CSP hash is stale. Run npm run csp:update.');

// 2. No inline style attributes: the CSP has style-src-attr 'none'. React's style={...}
//    is set through the DOM, which the CSP allows; a style="..." string is not.
for (const name of ['index.html', ...(await files(path.join(root, 'src'), 'src/')).filter((f) => /\.(js|ts|tsx)$/.test(f))]) {
  if (/\bstyle\s*=\s*["']/.test(await readFile(path.join(root, name), 'utf8'))) throw new Error(`Inline style in ${name}`);
}

// 3. The service worker precaches the whole release, and its cache is named after it.
const served = (await files(client)).filter((name) => !name.startsWith('.') && name !== '_headers' && name !== 'sw.js');
const hash = createHash('sha256');
for (const name of served) hash.update(name).update(await readFile(path.join(client, name)));
const version = hash.digest('hex').slice(0, 16);
const shell = ['/', ...served.map((name) => '/' + name)];
const sw = (await readFile(path.join(client, 'sw.js'), 'utf8'))
  .replace(/const CACHE = [^;]+;/, `const CACHE = CACHE_PREFIX + '${version}';`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(shell, null, 2)};`);
if (!sw.includes(version)) throw new Error('Could not write the service worker cache name');
for (const name of served) if (!sw.includes(`"/${name}"`)) throw new Error(`/${name} is missing from the service worker`);
await writeFile(path.join(client, 'sw.js'), sw);

console.log(`Service worker lists ${shell.length} files (${version}); CSP verified.`);
