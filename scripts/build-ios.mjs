// Runs after `vite build --mode ios`: makes dist-ios/ what the iPhone/Mac app carries in its
// bundle (docs/IOS.md). The app has no service worker and no Cloudflare headers, so the
// security policy that public/_headers gives the website goes into the page as a <meta>.

import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../dist-ios/', import.meta.url));
/* the Worker the app talks to: app.config.json's apiBase, as vite.config.ts gives the app */
const config = JSON.parse(await readFile(fileURLToPath(new URL('../app.config.json', import.meta.url)), 'utf8'));
const api = new URL(process.env.VITE_API_BASE || config.apiBase).origin;

for (const name of ['sw.js', '_headers']) await rm(path.join(out, name), { force: true });

const file = path.join(out, 'index.html');
let html = await readFile(file, 'utf8');
const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs]) => !/\bsrc=/.test(attrs));
if (inline.length !== 1) throw new Error(`Expected one inline script (the theme), found ${inline.length}`);
const hash = 'sha256-' + createHash('sha256').update(inline[0][2]).digest('base64');
/* as public/_headers, less what a <meta> cannot say (frame-ancestors) and the Spotify SDK the app does not load */
const csp = [
  "default-src 'self'", `script-src 'self' '${hash}'`, "style-src 'self'", "style-src-attr 'none'", "font-src 'self'",
  "img-src 'self' data: https://i.scdn.co https://mosaic.scdn.co", `connect-src ${api}`, "worker-src 'self'",
  "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join('; ');
if (html.includes('Content-Security-Policy')) throw new Error('index.html already has a CSP meta');
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
if (!html.includes(hash)) throw new Error('Could not add the CSP to index.html');
await writeFile(file, html);
console.log(`dist-ios ready for Capacitor; API ${api}.`);
