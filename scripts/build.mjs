import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'public');
const output = path.join(root, '.build', 'site');
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(dir, entry.name), rel + '/'));
    else result.push(rel);
  }
  return result.sort();
}
const names = await files(source);
const contents = new Map(await Promise.all(names.map(async (name) => [name, await readFile(path.join(source, name))])));
const html = contents.get('index.html').toString();
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!inline) throw new Error('Expected the inline theme script');
const cspHash = 'sha256-' + createHash('sha256').update(inline).digest('base64');
const headers = contents.get('_headers').toString();
if (!headers.includes(cspHash)) throw new Error('Theme script CSP hash is stale. Run npm run csp:update.');
for (const [name, value] of contents) if (/\.(js|html)$/.test(name) && /\bstyle\s*=\s*["']/.test(value.toString())) throw new Error(`Inline style in ${name}`);
const hash = createHash('sha256');
for (const [name, value] of contents) hash.update(name).update(value);
const version = hash.digest('hex').slice(0, 16);
const prefix = `/releases/${version}/`;
// Only this fixed, generated workspace directory is removed.
if (path.relative(root, output) !== path.join('.build', 'site')) throw new Error('Unsafe output path');
await mkdir(output, { recursive: true });
for (const entry of await readdir(output)) {
  const target = path.resolve(output, entry);
  if (path.dirname(target) !== output) throw new Error('Unsafe generated asset path');
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
const assets = names.filter((name) => !['index.html', '_headers', 'sw.js'].includes(name));
for (const name of assets) {
  const target = path.join(output, prefix, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents.get(name));
}
const builtHtml = html.replace(/(["'])\/(js|css)\//g, `$1${prefix}$2/`).replace(/(["'])\/(icon\.svg|manifest\.webmanifest)/g, `$1${prefix}$2`);
await writeFile(path.join(output, 'index.html'), builtHtml);
await writeFile(path.join(output, '_headers'), headers);
// Keep stable manifest/icon URLs for installed apps from previous releases.
for (const name of ['manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png']) await writeFile(path.join(output, name), contents.get(name));
const shell = ['/', '/index.html', ...assets.map((name) => prefix + name)];
const sw = contents.get('sw.js').toString()
  .replace(/const CACHE = [^;]+;/, `const CACHE = CACHE_PREFIX + '${version}';`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(shell, null, 2)};`);
await writeFile(path.join(output, 'sw.js'), sw);
await writeFile(path.join(root, '.build', 'manifest.json'), JSON.stringify({ version, assets: shell, cspHash }, null, 2));
console.log(`Built ${assets.length} versioned assets (${version}); CSP verified.`);
