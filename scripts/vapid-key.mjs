// Provision a VAPID key pair for push reminders (worker/push.js) without displaying the
// private key. Locally it goes into .dev.vars; with --print-public it only prints the public
// half of what .dev.vars holds. For the live site, run `npx wrangler secret put` for each of
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (see docs/DEPLOYING.md).
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
const file = new URL('../.dev.vars', import.meta.url);
let text;
try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; text = ''; }
if (/^VAPID_PRIVATE_KEY\s*=/m.test(text)) {
  console.log('VAPID keys already exist; left unchanged.');
} else {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  const subject = /^VAPID_SUBJECT\s*=/m.test(text) ? '' : 'VAPID_SUBJECT=mailto:you@example.com\n';
  await writeFile(file, text.trimEnd() + `\nVAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${jwk.d}\n${subject}`, { mode: 0o600 });
  console.log('Created a local VAPID key pair for push reminders. Set VAPID_SUBJECT in .dev.vars to a mailto: address of yours.');
}
