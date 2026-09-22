// Spotify, on behalf of one signed-in user. The browser never talks to Spotify: the
// Worker holds each user's tokens and makes every call. The refresh token is encrypted
// at rest under a key derived from SESSION_SECRET, so rotating that secret disconnects
// everyone, the way it signs everyone out.

import { HttpError } from './http.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';

async function tokenKey(env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('spotify-refresh') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** base64(iv ‖ ciphertext), a fresh iv every time. */
export async function encryptToken(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

/** Throws if the ciphertext was made under another secret or was altered. */
export async function decryptToken(env, stored) {
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await tokenKey(env), bytes.slice(12));
  return new TextDecoder().decode(plain);
}

const ACCOUNTS = 'https://accounts.spotify.com';
export const SCOPES = 'user-read-playback-state user-modify-playback-state';

const notConnected = () => new HttpError(409, { error: 'not_connected' });
const unavailable = () => new HttpError(502, { error: 'spotify_unavailable' });

export function isConfigured(env) {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({ client_id: env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, state });
  return `${ACCOUNTS}/authorize?${q}`;
}

/** POST to Spotify's token endpoint. Resolves to {status, body}; a network failure is a 502. */
async function tokenRequest(env, params) {
  let res;
  try {
    res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });
  } catch {
    throw unavailable();
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function tokensFrom(body, now) {
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now + body.expires_in * 1000 };
}

/** Trade the callback's code for tokens. Throws on any refusal. */
export async function exchangeCode(env, code, redirectUri, now = Date.now()) {
  const { status, body } = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (status !== 200 || !body.access_token || !body.refresh_token) throw new Error(`Spotify refused the code (${status})`);
  return tokensFrom(body, now);
}

/** Store tokens, encrypting the refresh token. */
export async function storeTokens(env, userId, t, now = Date.now()) {
  const refreshToken = await encryptToken(env, t.refreshToken);
  await saveSpotifyTokens(env.DB, userId, { refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt }, now);
}
