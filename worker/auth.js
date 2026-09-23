// Sessions: a signed cookie `userId.gen.expiresAt.signature`, HMAC-SHA256 with
// SESSION_SECRET. `gen` is the user's password generation: a reset or "sign out
// everywhere" bumps it and every older cookie stops working. No sessions table;
// rotating the secret signs everyone out.

import { HttpError } from './http.js';
import { limitUser } from './limits.js';

const COOKIE = 'rounds_session';
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

// Imported once per isolate rather than on every request; keyed by the secret so a
// rotated SESSION_SECRET is picked up.
let cachedKey = null;
async function hmacKey(secret) {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signature(payload, secret) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload)));
}

export async function signSession(userId, gen, secret, now = Date.now()) {
  const expiresAt = now + SESSION_MS;
  const payload = `${userId}.${gen}.${expiresAt}`;
  return `${payload}.${await signature(payload, secret)}`;
}

/** {userId, gen, expiresAt} for a valid, unexpired token, else null. */
async function readSession(token, secret, now = Date.now()) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [userId, gen, expiresAt, sig] = parts;
  if (!/^[0-9]+$/.test(gen) || !/^[0-9]+$/.test(expiresAt) || Number(expiresAt) < now) return null;
  const expected = await signature(`${userId}.${gen}.${expiresAt}`, secret);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { userId, gen: Number(gen), expiresAt: Number(expiresAt) } : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function secureFlag(url) {
  return url.protocol === 'https:' ? '; Secure' : '';
}

export function sessionCookie(token, url) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secureFlag(url)}`;
}

export function clearCookie(url) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(url)}`;
}

/** The session behind the request, checked against the user's current generation, or a 401. */
export async function requireSession(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  const session = await readSession(token, env.SESSION_SECRET);
  if (!session) throw new HttpError(401, { error: 'unauthenticated' });
  const expectedUser = request.headers.get('x-rounds-user');
  if (expectedUser && expectedUser !== session.userId) throw new HttpError(401, { error: 'account_changed' });
  const row = await env.DB.prepare('SELECT pw_gen FROM users WHERE id = ?').bind(session.userId).first();
  if (!row || row.pw_gen !== session.gen) throw new HttpError(401, { error: 'unauthenticated' });
  await limitUser(request, env, session.userId);
  return session;
}

/** The signed-in user id, or a 401. */
export async function requireUser(request, env) {
  return (await requireSession(request, env)).userId;
}
