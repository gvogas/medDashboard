// Sign in with Apple, in the iPhone/Mac app and on the website (docs/IOS.md). Apple signs an
// identity token for the person; we check it here and sign in the Term account linked to that
// Apple ID. Linking happens in Settings while signed in. A new account is made only while
// SIGNUPS is "open" (wrangler.jsonc); until then Term stays invite-only.
//
// Replay: the token must carry a nonce this Worker signed in the last ten minutes
// (GET /api/login/apple/nonce), so a token copied from somewhere else is refused.
// Deletion: Apple asks apps to revoke its grant when an account is deleted. With the .p8 key
// configured (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY) the sign-in's authorization code
// is exchanged for a refresh token, kept encrypted, and revoked on deletion.

import { json, readJson, HttpError } from './http.js';
import { requireSession, signSession, sessionCookie, hex, sameString } from './auth.js';
import { limitLogin } from './limits.js';
import { getProfile } from './db.js';
import { encryptToken, decryptToken } from './spotify/tokens.js';

const ISSUER = 'https://appleid.apple.com';
const NONCE_MS = 10 * 60 * 1000;
const SKEW_S = 60;
const KEYS_MS = 60 * 60 * 1000;
const enc = new TextEncoder();

export const audiences = (env) => String(env.APPLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
export const configured = (env) => audiences(env).length > 0;
const canRevoke = (env) => !!(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);

// ── base64url and HMAC ──────────────────────────────────────────────────────

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const jsonPart = (s) => JSON.parse(new TextDecoder().decode(unb64url(s)));

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** A nonce for one sign-in: `time.random.signature`, good for ten minutes. */
export async function makeNonce(secret, now = Date.now()) {
  const body = `${now}.${hex(crypto.getRandomValues(new Uint8Array(12)))}`;
  return `${body}.${await hmac(secret, 'apple-nonce:' + body)}`;
}

async function nonceValid(secret, nonce, now = Date.now()) {
  const m = /^(\d{13})\.([0-9a-f]{24})\.([0-9a-f]{64})$/.exec(typeof nonce === 'string' ? nonce : '');
  if (!m || now - Number(m[1]) > NONCE_MS || Number(m[1]) > now + 60_000) return false;
  return sameString(await hmac(secret, `apple-nonce:${m[1]}.${m[2]}`), m[3]);
}

// ── Apple's keys and the identity token ─────────────────────────────────────

let keyCache = { at: 0, keys: [] };
async function appleKeys(now = Date.now()) {
  if (now - keyCache.at < KEYS_MS && keyCache.keys.length) return keyCache.keys;
  const res = await fetch(`${ISSUER}/auth/keys`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new HttpError(503, { error: 'apple_unavailable' });
  const { keys } = await res.json();
  keyCache = { at: now, keys: Array.isArray(keys) ? keys : [] };
  return keyCache.keys;
}

/**
 * The checked claims of an Apple identity token: Apple's signature (RS256, a published key),
 * issuer, one of our client ids as audience, not expired, and our nonce. Else a 401.
 */
export async function verifyIdentityToken(token, { keys, audiences: auds, nonce, now = Date.now() }) {
  const bad = () => new HttpError(401, { error: 'bad_apple_token' });
  const parts = typeof token === 'string' && token.length < 4000 ? token.split('.') : [];
  if (parts.length !== 3) throw bad();
  let header, claims;
  try { header = jsonPart(parts[0]); claims = jsonPart(parts[1]); } catch { throw bad(); }
  if (header.alg !== 'RS256') throw bad();
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  let sig;
  try { sig = unb64url(parts[2]); } catch { throw bad(); }
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, enc.encode(`${parts[0]}.${parts[1]}`)))) throw bad();
  const s = Math.floor(now / 1000);
  if (claims.iss !== ISSUER || !auds.includes(claims.aud) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 100) throw bad();
  if (!Number.isFinite(claims.exp) || claims.exp + SKEW_S < s || (Number.isFinite(claims.iat) && claims.iat - SKEW_S > s)) throw bad();
  if (claims.nonce !== nonce) throw bad();
  return { sub: claims.sub, aud: claims.aud, email: typeof claims.email === 'string' ? claims.email.slice(0, 200) : '' };
}

/** The checked claims of the token in `body`, with its nonce. */
async function claimsOf(env, body) {
  if (!configured(env)) throw new HttpError(503, { error: 'apple_not_configured' });
  if (!(await nonceValid(env.SESSION_SECRET, body.nonce))) throw new HttpError(401, { error: 'bad_apple_token' });
  return verifyIdentityToken(body.idToken, { keys: await appleKeys(), audiences: audiences(env), nonce: body.nonce });
}

/** The account linked to the Apple ID in a fresh token, for confirming a deletion. */
export async function appleUserOf(env, body) {
  const { sub } = await claimsOf(env, body);
  return (await env.DB.prepare('SELECT user_id FROM apple_accounts WHERE sub = ?').bind(sub).first())?.user_id ?? null;
}

// ── revoking Apple's grant ──────────────────────────────────────────────────

/* The client secret Apple's token endpoint wants: a JWT signed with our .p8 key (ES256). */
async function clientSecret(env, clientId, now = Date.now()) {
  const pem = String(env.APPLE_PRIVATE_KEY).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', unb64url(pem.replace(/\+/g, '-').replace(/\//g, '_')),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID })));
  const body = b64url(enc.encode(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat, exp: iat + 300, aud: ISSUER, sub: clientId })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

const tokenKey = (env) => `${env.SESSION_SECRET}:apple`;

async function appleForm(env, path, clientId, fields) {
  const form = new URLSearchParams({ client_id: clientId, client_secret: await clientSecret(env, clientId), ...fields });
  return fetch(`${ISSUER}${path}`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(5000) });
}

/* The sign-in's authorization code for a refresh token, sealed; null when it cannot be had. */
async function refreshTokenFor(env, clientId, code) {
  if (!canRevoke(env) || typeof code !== 'string' || !code || code.length > 1000) return null;
  try {
    const res = await appleForm(env, '/auth/token', clientId, { code, grant_type: 'authorization_code' });
    const token = res.ok ? (await res.json()).refresh_token : null;
    return typeof token === 'string' ? await encryptToken(tokenKey(env), token) : null;
  } catch (e) { console.error('apple token:', e?.message || e); return null; }
}

/** Before an account is deleted: revoke Apple's grant, if there is one. Never throws. */
export async function revokeApple(env, userId) {
  try {
    const row = await env.DB.prepare('SELECT client_id, refresh_token FROM apple_accounts WHERE user_id = ?').bind(userId).first();
    if (!row?.refresh_token || !canRevoke(env)) return;
    const token = await decryptToken(tokenKey(env), row.refresh_token);
    if (token) await appleForm(env, '/auth/revoke', row.client_id, { token, token_type_hint: 'refresh_token' });
  } catch (e) { console.error('apple revoke:', e?.message || e); }
}

// ── accounts ────────────────────────────────────────────────────────────────

/* A username for a new account: their first name (or "student") and four digits. */
function usernameFrom(givenName) {
  const base = String(givenName || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 20);
  return (base.length >= 2 ? base : 'student') + String(1000 + Math.floor(Math.random() * 9000));
}

async function newAccount(env, claims, body, refresh, now) {
  const display = [body.givenName, body.familyName].filter((s) => typeof s === 'string' && s.trim()).join(' ').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60);
  for (let tries = 0; tries < 5; tries++) {
    const id = crypto.randomUUID(), username = usernameFrom(body.givenName);
    try {
      /* "apple" is no password hash, so no password signs in to it (worker/password.js) */
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'apple', ?, ?, ?)").bind(id, username, display, now, now),
        env.DB.prepare('INSERT INTO apple_accounts (sub, user_id, email, client_id, refresh_token, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(claims.sub, id, claims.email, claims.aud, refresh, now),
      ]);
      return id;
    } catch (e) {
      if (/UNIQUE.*users\.username/i.test(e?.message || '')) continue;
      if (/UNIQUE.*apple_accounts/i.test(e?.message || '')) throw new HttpError(409, { error: 'apple_linked' });
      throw e;
    }
  }
  throw new HttpError(503, { error: 'try_again' });
}

async function session(env, url, userId, app) {
  const [profile, row] = await Promise.all([getProfile(env.DB, userId), env.DB.prepare('SELECT pw_gen FROM users WHERE id = ?').bind(userId).first()]);
  if (!profile || !row) throw new HttpError(401, { error: 'unauthenticated' });
  const token = await signSession(userId, row.pw_gen, env.SESSION_SECRET);
  return app ? json({ ...profile, token }) : json(profile, 200, { 'set-cookie': sessionCookie(token, url) });
}

/**
 * POST /api/login/apple {idToken, nonce, authorizationCode?, givenName?, familyName?, client?, link?}.
 * Signs in the linked account; with `link: true` and a session, links this Apple ID to it;
 * with SIGNUPS open, makes a new account. Else 403 no_account.
 */
async function appleLogin({ request, env, url }) {
  await limitLogin(request, env);
  const body = await readJson(request);
  if (body.client !== undefined && body.client !== 'app') throw new HttpError(400, { error: 'invalid', field: 'client' });
  const claims = await claimsOf(env, body);
  const now = Date.now();
  const linked = await env.DB.prepare('SELECT user_id FROM apple_accounts WHERE sub = ?').bind(claims.sub).first();
  if (body.link === true) {
    const { userId } = await requireSession(request, env);
    if (linked) {
      if (linked.user_id !== userId) throw new HttpError(409, { error: 'apple_linked' });
      return json({ linked: true, email: claims.email });
    }
    const refresh = await refreshTokenFor(env, claims.aud, body.authorizationCode);
    try {
      await env.DB.prepare('INSERT INTO apple_accounts (sub, user_id, email, client_id, refresh_token, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(claims.sub, userId, claims.email, claims.aud, refresh, now).run();
    } catch (e) {
      if (/UNIQUE/i.test(e?.message || '')) throw new HttpError(409, { error: 'apple_linked' });
      throw e;
    }
    return json({ linked: true, email: claims.email });
  }
  if (linked) return session(env, url, linked.user_id, body.client === 'app');
  if (env.SIGNUPS !== 'open') throw new HttpError(403, { error: 'no_account' });
  const userId = await newAccount(env, claims, body, await refreshTokenFor(env, claims.aud, body.authorizationCode), now);
  return session(env, url, userId, body.client === 'app');
}

/** GET /api/apple: whether Sign in with Apple is set up, the Apple ID linked to me, and
    whether I have a password (an account made with Apple has none). */
async function appleStatus({ request, env }) {
  const { userId } = await requireSession(request, env);
  const row = await env.DB.prepare(`SELECT a.email, substr(u.password_hash, 1, 7) = 'pbkdf2$' AS password
    FROM users AS u LEFT JOIN apple_accounts AS a ON a.user_id = u.id WHERE u.id = ?`).bind(userId).first();
  return json({ available: configured(env), linked: row?.email != null, email: row?.email ?? '', password: row?.password === 1 });
}

export const appleRoutes = [
  ['GET', /^\/api\/login\/apple\/nonce$/, async ({ env }) => {
    if (!configured(env)) throw new HttpError(503, { error: 'apple_not_configured' });
    return json({ nonce: await makeNonce(env.SESSION_SECRET), signups: env.SIGNUPS === 'open' });
  }],
  ['POST', /^\/api\/login\/apple$/, appleLogin],
  ['GET', /^\/api\/apple$/, appleStatus],
];
