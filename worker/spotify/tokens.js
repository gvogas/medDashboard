import { HttpError } from '../http.js';
import { getSpotifyTokens, replaceSpotifyTokens, discardSpotifyTokens } from '../db.js';
import { upstreamFetch, unavailable, bodyOf } from './transport.js';
const ACCOUNTS = 'https://accounts.spotify.com';
const REFRESH_WITHIN_MS = 60000;
const SCOPES = 'user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read streaming user-read-email user-read-private user-read-recently-played';
export function configured(env) {
  return !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

export function authorizeUrl(env, redirectUri, state) {
  const u = new URL(`${ACCOUNTS}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.SPOTIFY_CLIENT_ID);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

// ── refresh tokens at rest ──────────────────────────────────────────────────
// AES-GCM primitives used by the versioned keyring below and the legacy reader.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function aesKey(secret) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('rounds'), info: enc.encode('spotify-refresh') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptToken(secret, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64(out);
}

/** The plaintext, or null when the ciphertext was made under another secret. */
export async function decryptToken(secret, stored) {
  try {
    const bytes = unb64(stored);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await aesKey(secret), bytes.slice(12));
    return dec.decode(plain);
  } catch {
    return null;
  }
}

// ── accounts.spotify.com ────────────────────────────────────────────────────


// One JSON secret: {"current":"v1","keys":{"v1":"a long random secret"}}.
// Retain prior key IDs until their tokens have been refreshed under the current key.
function keyring(env) {
  let ring;
  try { ring = JSON.parse(env.SPOTIFY_TOKEN_KEYS); } catch { throw new Error('SPOTIFY_TOKEN_KEYS is not configured'); }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(ring.current) || typeof ring.keys?.[ring.current] !== 'string' || ring.keys[ring.current].length < 32) throw new Error('Invalid Spotify encryption keyring');
  return ring;
}
export async function sealToken(env, token) {
  const ring = keyring(env);
  return `${ring.current}.${await encryptToken(ring.keys[ring.current], token)}`;
}
export async function openToken(env, stored) {
  const separator = stored.indexOf('.');
  if (separator < 0) return decryptToken(env.SPOTIFY_LEGACY_TOKEN_SECRET || env.SESSION_SECRET, stored);
  const ring = keyring(env), key = ring.keys[stored.slice(0, separator)];
  if (!key) throw new Error('Spotify token key is unavailable');
  return decryptToken(key, stored.slice(separator + 1));
}
async function tokenRequest(env, params) {
  let res;
  try {
    res = await upstreamFetch(env, 'accounts', `${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unavailable();
  }
  if (res.status >= 500) throw unavailable();
  const body = await bodyOf(res);
  if (!res.ok) throw new HttpError(400, { error: body.error === 'invalid_grant' ? 'invalid_grant' : 'spotify_rejected' });
  if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) throw unavailable();
  if (!Number.isSafeInteger(Date.now() + Number(body.expires_in) * 1000)) throw unavailable();
  if (body.refresh_token != null && (typeof body.refresh_token !== 'string' || !body.refresh_token)) throw unavailable();
  return body;
}

const fromTokenBody = (body, now) => ({
  accessToken: body.access_token,
  refreshToken: body.refresh_token,
  expiresAt: now + Number(body.expires_in) * 1000,
});

export async function exchangeCode(env, code, redirectUri, now = Date.now()) {
  const body = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw unavailable();
  return fromTokenBody(body, now);
}

async function refreshAccessToken(env, refreshToken, now = Date.now()) {
  return fromTokenBody(await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken }), now);
}

// ── the user's access token ─────────────────────────────────────────────────

export const notConnected = () => new HttpError(409, { error: 'not_connected' });

/** Refresh, store, and return `{ accessToken, expiresAt, row }` (row as now stored); drops the row if Spotify revoked it. */
export async function refreshFor(env, userId, previous) {
  if (!previous) throw notConnected();
  const owner = crypto.randomUUID();
  const deadline = Date.now() + 12_000;
  while (true) {
    const now = Date.now();
    const lease = await env.DB.prepare(`INSERT INTO spotify_refresh_locks (user_id, owner, expires_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
      WHERE expires_at <= ? RETURNING owner`).bind(userId, owner, now + 15_000, now).first();
    if (lease) break;
    if (now >= deadline) throw new HttpError(503, { error: 'spotify_unavailable' }, { 'retry-after': '1' });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    const current = await getSpotifyTokens(env.DB, userId);
    if (!current) throw notConnected();
    // Another request may have refreshed or reconnected while this one waited.
    if (current.access_token !== previous.access_token || current.refresh_token !== previous.refresh_token || current.expires_at !== previous.expires_at) {
      return stored(current);
    }
    return await refreshLocked(env, userId, current);
  } finally {
    await env.DB.prepare('DELETE FROM spotify_refresh_locks WHERE user_id = ? AND owner = ?').bind(userId, owner).run();
  }
}

async function refreshLocked(env, userId, row) {
  const refreshToken = await openToken(env, row.refresh_token);
  if (!refreshToken) { await discardSpotifyTokens(env.DB, userId, row); throw notConnected(); }
  let fresh;
  try {
    fresh = await refreshAccessToken(env, refreshToken);
  } catch (e) {
    if (e instanceof HttpError && e.body.error === 'invalid_grant') {
      await discardSpotifyTokens(env.DB, userId, row);
      const current = await getSpotifyTokens(env.DB, userId);
      if (current) return stored(current);
      throw notConnected();
    }
    throw e;
  }
  const next = { refresh_token: await sealToken(env, fresh.refreshToken || refreshToken), access_token: fresh.accessToken, expires_at: fresh.expiresAt };
  const saved = await replaceSpotifyTokens(env.DB, userId, row, { refreshToken: next.refresh_token, accessToken: next.access_token, expiresAt: next.expires_at });
  if (!saved) {
    const current = await getSpotifyTokens(env.DB, userId);
    if (!current) throw notConnected();
    return stored(current);
  }
  // What was just written, so the caller need not read it back.
  return stored(next);
}

const stored = (row) => ({ accessToken: row.access_token, expiresAt: row.expires_at, row });

/** A usable access token for this user and when it expires, refreshed when it is about to. */
export async function freshAccessToken(env, userId, now = Date.now()) {
  const row = await getSpotifyTokens(env.DB, userId);
  if (!row) throw notConnected();
  if (row.expires_at - now > REFRESH_WITHIN_MS) return { token: row.access_token, expiresAt: row.expires_at, row };
  const fresh = await refreshFor(env, userId, row);
  return { token: fresh.accessToken, expiresAt: fresh.expiresAt, row: fresh.row };
}

