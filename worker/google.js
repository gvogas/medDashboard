// Verifies a Google ID token from the "Sign in with Google" button:
// signature against Google's published keys, issuer, audience, expiry, verified email.

import { HttpError } from './http.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CACHE_MS = 6 * 60 * 60 * 1000;

let cache = { keys: [], at: 0 };

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function googleKeys(force = false) {
  if (!force && cache.keys.length && Date.now() - cache.at < CACHE_MS) return cache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new HttpError(503, { error: 'google_unavailable' });
  const body = await res.json();
  cache = { keys: Array.isArray(body.keys) ? body.keys : [], at: Date.now() };
  return cache.keys;
}

/** Resolves to {email, name, sub} for a valid token, else throws a 401. */
export async function verifyGoogleToken(token, clientId) {
  const bad = () => new HttpError(401, { error: 'bad_token' });
  if (typeof token !== 'string') throw bad();
  const parts = token.split('.');
  if (parts.length !== 3) throw bad();

  let header, payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    throw bad();
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw bad();

  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);   // keys rotate
  if (!jwk) throw bad();

  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw bad();

  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(payload.iss)) throw bad();
  if (payload.aud !== clientId) throw bad();
  if (typeof payload.exp !== 'number' || payload.exp < now) throw bad();
  if (payload.email_verified !== true || typeof payload.email !== 'string') throw bad();

  return { email: payload.email, name: typeof payload.name === 'string' ? payload.name : '', sub: payload.sub };
}

/** ALLOWED_EMAILS: empty means open sign-up; otherwise a comma-separated allowlist. */
export function emailAllowed(email, list) {
  const set = (list || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return set.length === 0 || set.includes(String(email).toLowerCase());
}
