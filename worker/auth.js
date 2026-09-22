// Sessions: a signed cookie `userId.expiresAt.signature`, HMAC-SHA256 with SESSION_SECRET.
// No sessions table; rotating the secret signs everyone out.

import { HttpError } from './http.js';

export const COOKIE = 'rounds_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signature(payload, secret) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload)));
}

export async function signSession(userId, secret, now = Date.now()) {
  const expiresAt = now + SESSION_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${await signature(payload, secret)}`;
}

/** Returns the userId for a valid, unexpired token, else null. */
export async function readSession(token, secret, now = Date.now()) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresAt, sig] = parts;
  if (!/^[0-9]+$/.test(expiresAt) || Number(expiresAt) < now) return null;
  const expected = await signature(`${userId}.${expiresAt}`, secret);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function secureFlag(url) {
  return url.protocol === 'https:' ? '; Secure' : '';
}

export function sessionCookie(token, url) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secureFlag(url)}`;
}

export function clearCookie(url) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(url)}`;
}

/** The signed-in user id, or a 401. */
export async function requireUser(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  const userId = await readSession(token, env.SESSION_SECRET);
  if (!userId) throw new HttpError(401, { error: 'unauthenticated' });
  return userId;
}
