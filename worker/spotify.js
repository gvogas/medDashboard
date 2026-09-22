// Spotify: the OAuth round trip, token storage, and a proxy for the player calls.
// The browser never talks to Spotify; every call goes through here with the
// signed-in user's own tokens. See docs/superpowers/specs/2026-09-22-spotify-player-design.md.

import { HttpError } from './http.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
export const SCOPES = 'user-read-playback-state user-modify-playback-state';
const REFRESH_WITHIN_MS = 60 * 1000;

export const ACTIONS = {
  play: ['PUT', '/me/player/play'],
  pause: ['PUT', '/me/player/pause'],
  next: ['POST', '/me/player/next'],
  previous: ['POST', '/me/player/previous'],
  restart: ['PUT', '/me/player/seek?position_ms=0'],
};

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
// AES-GCM under a key derived from SESSION_SECRET. Rotating the secret makes every
// stored refresh token unreadable, which the refresh path treats as "not connected".

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

const unavailable = () => new HttpError(502, { error: 'spotify_unavailable' });

async function tokenRequest(env, params) {
  let res;
  try {
    res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw unavailable();
  }
  const body = await res.json().catch(() => ({}));
  if (res.status >= 500) throw unavailable();
  if (!res.ok) throw new HttpError(400, { error: body.error === 'invalid_grant' ? 'invalid_grant' : 'spotify_rejected' });
  return body;
}

const fromTokenBody = (body, now) => ({
  accessToken: body.access_token,
  refreshToken: body.refresh_token,
  expiresAt: now + (Number(body.expires_in) || 3600) * 1000,
});

export async function exchangeCode(env, code, redirectUri, now = Date.now()) {
  return fromTokenBody(await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }), now);
}

export async function refreshAccessToken(env, refreshToken, now = Date.now()) {
  return fromTokenBody(await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken }), now);
}

// ── the user's access token ─────────────────────────────────────────────────

const notConnected = () => new HttpError(409, { error: 'not_connected' });

/** Refresh, store, and return the new access token; drops the row if Spotify revoked it. */
async function refreshFor(env, userId, row) {
  const refreshToken = await decryptToken(env.SESSION_SECRET, row.refresh_token);
  if (!refreshToken) { await deleteSpotifyTokens(env.DB, userId); throw notConnected(); }
  let fresh;
  try {
    fresh = await refreshAccessToken(env, refreshToken);
  } catch (e) {
    if (e instanceof HttpError && e.body.error === 'invalid_grant') { await deleteSpotifyTokens(env.DB, userId); throw notConnected(); }
    throw e;
  }
  await saveSpotifyTokens(env.DB, userId, {
    refreshToken: fresh.refreshToken ? await encryptToken(env.SESSION_SECRET, fresh.refreshToken) : row.refresh_token,
    accessToken: fresh.accessToken,
    expiresAt: fresh.expiresAt,
  });
  return fresh.accessToken;
}

/** A usable access token for this user, refreshed when it is about to expire. */
export async function freshAccessToken(env, userId, now = Date.now()) {
  const row = await getSpotifyTokens(env.DB, userId);
  if (!row) throw notConnected();
  if (row.expires_at - now > REFRESH_WITHIN_MS) return { token: row.access_token, row };
  return { token: await refreshFor(env, userId, row), row };
}

/**
 * Call api.spotify.com as this user. A 401 gets one refresh and one retry; 429 and
 * 5xx are mapped so the UI can explain them. Returns the Response for the caller
 * to map 2xx/403/404 itself.
 */
async function spotifyFetch(env, userId, method, path) {
  const { token, row } = await freshAccessToken(env, userId);
  const call = async (bearer) => {
    try {
      return await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${bearer}` } });
    } catch {
      throw unavailable();
    }
  };
  let res = await call(token);
  if (res.status === 401) res = await call(await refreshFor(env, userId, row));
  if (res.status === 401) throw notConnected();
  if (res.status === 429) {
    const wait = res.headers.get('retry-after') || '30';
    throw new HttpError(429, { error: 'rate_limited', retryAfter: Number(wait) || 30 }, { 'retry-after': wait });
  }
  if (res.status >= 500) throw unavailable();
  return res;
}

// ── the player ──────────────────────────────────────────────────────────────

function compactTrack(item, progressMs) {
  if (!item) return null;
  const images = item.album?.images || [];
  const art = images.find((i) => i.width === 300) || images[1] || images[0] || null;
  return {
    title: item.name || '',
    artists: (item.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    album: item.album?.name || '',
    art: art ? art.url : null,
    url: item.external_urls?.spotify || null,
    durationMs: Number(item.duration_ms) || 0,
    progressMs: Number(progressMs) || 0,
  };
}

/** `{ connected: false }`, or `{ connected: true, playing, track, device }`. */
export async function playerState(env, userId) {
  if (!(await getSpotifyTokens(env.DB, userId))) return { connected: false };
  let res;
  try {
    res = await spotifyFetch(env, userId, 'GET', '/me/player');
  } catch (e) {
    if (e instanceof HttpError && e.body.error === 'not_connected') return { connected: false };
    throw e;
  }
  if (res.status === 204) return { connected: true, playing: false, track: null, device: null };
  const body = await res.json().catch(() => ({}));
  return {
    connected: true,
    playing: !!body.is_playing,
    track: compactTrack(body.item, body.progress_ms),
    device: body.device?.name || null,
  };
}

/** One of ACTIONS. Resolves on success; throws a mapped HttpError otherwise. */
export async function control(env, userId, action) {
  const [method, path] = ACTIONS[action];
  const res = await spotifyFetch(env, userId, method, path);
  if (res.status === 404) throw new HttpError(404, { error: 'no_device' });
  if (res.status === 403) throw new HttpError(403, { error: 'premium_required' });
  if (!res.ok) throw unavailable();
}
