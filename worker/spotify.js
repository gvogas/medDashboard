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

const API = 'https://api.spotify.com/v1';
const REFRESH_WITHIN_MS = 60 * 1000;

/** A new access token. A revoked refresh token is not_connected; Spotify may send a new refresh token too. */
export async function refreshAccessToken(env, refreshToken, now = Date.now()) {
  const { status, body } = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (status === 400 && body.error === 'invalid_grant') throw notConnected();
  if (status !== 200 || !body.access_token) throw unavailable();
  return tokensFrom(body, now);
}

/** A usable access token for this user; `force` refreshes even one that looks fresh. */
export async function freshAccessToken(env, userId, force = false, now = Date.now()) {
  const row = await getSpotifyTokens(env.DB, userId);
  if (!row) throw notConnected();
  if (!force && row.expiresAt - now > REFRESH_WITHIN_MS) return row.accessToken;
  let refreshToken;
  try {
    refreshToken = await decryptToken(env, row.refreshToken);
  } catch {
    await deleteSpotifyTokens(env.DB, userId);   // SESSION_SECRET was rotated
    throw notConnected();
  }
  let t;
  try {
    t = await refreshAccessToken(env, refreshToken, now);
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) await deleteSpotifyTokens(env.DB, userId);
    throw e;
  }
  await storeTokens(env, userId, { ...t, refreshToken: t.refreshToken || refreshToken }, now);
  return t.accessToken;
}

/** One Web API call as this user, refreshing and retrying once on a 401. */
async function call(env, userId, method, path) {
  const send = async (token) => {
    try {
      return await fetch(API + path, {
        method,
        headers: { authorization: `Bearer ${token}` },
        body: method === 'GET' ? undefined : '',
      });
    } catch {
      throw unavailable();
    }
  };
  let res = await send(await freshAccessToken(env, userId));
  if (res.status === 401) res = await send(await freshAccessToken(env, userId, true));
  return res;
}

/** A rate limit passes through with its wait; anything else unexpected is Spotify's trouble. */
function failure(res) {
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 30;
    return new HttpError(429, { error: 'rate_limited', retryAfter: wait }, { 'retry-after': String(wait) });
  }
  return unavailable();
}

function artOf(images = []) {
  const img = images.find((i) => i.width === 300) || images[0];
  return img ? img.url : null;
}

/** What is playing, in the compact shape the strip draws. */
export async function playerState(env, userId) {
  const res = await call(env, userId, 'GET', '/me/player');
  if (res.status === 204) return { connected: true, playing: false, track: null, device: null };
  if (res.status !== 200) throw failure(res);
  const p = await res.json();
  const it = p.item;
  return {
    connected: true,
    playing: Boolean(p.is_playing),
    device: p.device?.name ?? null,
    track: it
      ? {
          title: it.name,
          artists: (it.artists || []).map((a) => a.name).join(', ') || it.show?.name || '',
          album: it.album?.name || it.show?.name || '',
          art: artOf(it.album?.images || it.images),
          url: it.external_urls?.spotify || null,
          durationMs: it.duration_ms,
          progressMs: p.progress_ms ?? 0,
        }
      : null,
  };
}
