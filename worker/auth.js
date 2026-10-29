// Sessions: a signed cookie `userId.gen.expiresAt.signature`, HMAC-SHA256 with
// SESSION_SECRET. `gen` is the user's password generation: a reset or "sign out
// everywhere" bumps it and every older cookie stops working. Sign-outs are the one
// exception: `revoked_sessions` keeps a signed-out session id until no copy of it could
// still be valid. Rotating the secret signs everyone out.

import { HttpError } from './http.js';
import { limitUser } from './limits.js';
import { DAY_MS } from './time.js';

const COOKIE = 'rounds_session';
const SESSION_MS = 30 * DAY_MS;
const RENEW_WITHIN_MS = 7 * DAY_MS;
// A session ends this long after sign-in, however often it is renewed.
const ABSOLUTE_MS = 90 * DAY_MS;

// Imported once per isolate rather than on every request; keyed by the secret so a
// rotated SESSION_SECRET is picked up.
let cachedKey = null;
async function hmacKey(secret) {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    cachedKey = { secret, key };
    // A failed import (a missing secret) must not stay cached for the isolate's life.
    key.catch(() => { if (cachedKey?.key === key) cachedKey = null; });
  }
  return cachedKey.key;
}

export function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signature(payload, secret) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload)));
}

export async function signSession(userId, gen, secret, now = Date.now(), prior = {}) {
  const issuedAt = prior.issuedAt ?? now;
  const sid = prior.sid ?? hex(crypto.getRandomValues(new Uint8Array(12)));
  const expiresAt = Math.min(now + SESSION_MS, issuedAt + ABSOLUTE_MS);
  const payload = `${userId}.${gen}.${issuedAt}.${expiresAt}.${sid}`;
  return `${payload}.${await signature(payload, secret)}`;
}

/** A session for a sign-in or a renewal: its cookie, and its registry row at the expiry it now has. */
export async function issueSession(env, userId, gen, now = Date.now(), prior = {}) {
  const token = await signSession(userId, gen, env.SESSION_SECRET, now, prior);
  const { sid, expiresAt } = await readSession(token, env.SESSION_SECRET, now);
  await env.DB.prepare(`INSERT INTO sessions (sid, user_id, gen, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (sid) DO UPDATE SET expires_at = excluded.expires_at`).bind(sid, userId, gen, expiresAt).run();
  return token;
}

/** {userId, gen, issuedAt, expiresAt, sid} for a valid, unexpired token, else null. */
async function readSession(token, secret, now = Date.now()) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 6) return null;
  const [userId, gen, issuedAt, expiresAt, sid, sig] = parts;
  if (!/^[0-9]+$/.test(gen) || !/^[0-9]+$/.test(issuedAt) || !/^[0-9]+$/.test(expiresAt) || !/^[0-9a-f]{24}$/.test(sid) || Number(expiresAt) < now) return null;
  const expected = await signature(`${userId}.${gen}.${issuedAt}.${expiresAt}.${sid}`, secret);
  return sameString(expected, sig) ? { userId, gen: Number(gen), issuedAt: Number(issuedAt), expiresAt: Number(expiresAt), sid } : null;
}

export function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Trusted devices: a browser that has signed in as a name gets `rounds_device=nonce.sig`,
// signed over the name. Sign-ins from it are throttled on their own, so failures from
// anywhere else cannot lock its owner out (see worker/throttle.js).
const DEVICE_COOKIE = 'rounds_device';
const DEVICE_MS = 365 * DAY_MS;

export async function deviceCookie(username, secret, url) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
  const sig = await signature(`device:${username}:${nonce}`, secret);
  return `${DEVICE_COOKIE}=${nonce}.${sig}; Path=/api/login; HttpOnly; SameSite=Strict; Max-Age=${DEVICE_MS / 1000}${secureFlag(url)}`;
}

/** The device's nonce when the request carries a valid device cookie for this name, else null. */
export async function trustedDevice(request, username, secret) {
  const [nonce, sig] = (parseCookies(request.headers.get('cookie'))[DEVICE_COOKIE] || '').split('.');
  if (!/^[0-9a-f]{24}$/.test(nonce || '') || !sig) return null;
  return sameString(await signature(`device:${username}:${nonce}`, secret), sig) ? nonce : null;
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
  // One round trip: the sign-out check, the generation check and the rate limit share a D1 read or batch.
  if (!(await limitUser(request, env, session))) throw new HttpError(401, { error: 'unauthenticated' });
  return session;
}

/** A re-issued cookie for a session in its last week, or null. Never extends past the absolute lifetime. */
export async function renewedCookie(env, session, url, now = Date.now()) {
  if (session.expiresAt - now >= RENEW_WITHIN_MS) return null;
  if (Math.min(now + SESSION_MS, session.issuedAt + ABSOLUTE_MS) <= session.expiresAt) return null;
  return sessionCookie(await issueSession(env, session.userId, session.gen, now, session), url);
}

/** Sign out this browser's session. Its id stays revoked until the absolute lifetime from its first sign-in has passed, so no renewed copy can outlive the revocation. */
export async function revokeSession(request, env) {
  const session = await readSession(parseCookies(request.headers.get('cookie'))[COOKIE], env.SESSION_SECRET);
  if (session) await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO revoked_sessions (sid, expires_at) VALUES (?, ?)').bind(session.sid, session.issuedAt + ABSOLUTE_MS),
    env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(session.sid),
  ]);
}

/** Whether a request carries a session cookie at all, valid or not. */
export const hasSessionCookie = (request) => Boolean(parseCookies(request.headers.get('cookie'))[COOKIE]);

/** Who a request says it is, from the cookie alone (no D1 read): for the error log, not access. */
export async function sessionUserId(request, env) {
  try {
    return (await readSession(parseCookies(request.headers.get('cookie'))[COOKIE], env.SESSION_SECRET))?.userId ?? null;
  } catch {
    return null;
  }
}

/** The signed-in user id, or a 401. */
export async function requireUser(request, env) {
  return (await requireSession(request, env)).userId;
}
