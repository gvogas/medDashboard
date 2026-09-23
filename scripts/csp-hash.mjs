// Prints the CSP hash of the inline script in public/index.html, for public/_headers.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const inline = html.match(/<script>(.*?)<\/script>/s)[1];
const hash = "'sha256-" + createHash('sha256').update(inline, 'utf8').digest('base64') + "'";

if (process.argv.includes('--write')) {
  const file = new URL('../public/_headers', import.meta.url);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/'sha256-[^']+'/g, hash));
}
console.log(hash);
