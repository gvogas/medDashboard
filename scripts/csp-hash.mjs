// Prints the CSP hash of the inline script in public/index.html, for public/_headers.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const inline = html.match(/<script>(.*?)<\/script>/s)[1];
console.log("'sha256-" + createHash('sha256').update(inline, 'utf8').digest('base64') + "'");
