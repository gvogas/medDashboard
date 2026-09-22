// Spotify: the OAuth round trip, token storage, and a proxy for the player calls.
// The browser never talks to Spotify; every call goes through here with the
// signed-in user's own tokens. See docs/superpowers/specs/2026-09-22-spotify-player-design.md.

import { HttpError } from './http.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
export const SCOPES = 'user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read streaming user-read-email user-read-private user-read-recently-played';
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

/** Refresh, store, and return `{ accessToken, expiresAt }`; drops the row if Spotify revoked it. */
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
  return fresh;
}

/** A usable access token for this user and when it expires, refreshed when it is about to. */
export async function freshAccessToken(env, userId, now = Date.now()) {
  const row = await getSpotifyTokens(env.DB, userId);
  if (!row) throw notConnected();
  if (row.expires_at - now > REFRESH_WITHIN_MS) return { token: row.access_token, expiresAt: row.expires_at, row };
  const fresh = await refreshFor(env, userId, row);
  return { token: fresh.accessToken, expiresAt: fresh.expiresAt, row };
}

/**
 * Call api.spotify.com as this user. A 401 gets one refresh and one retry; 429 and
 * 5xx are mapped so the UI can explain them. Returns the Response for the caller
 * to map 2xx/403/404 itself.
 */
async function spotifyFetch(env, userId, method, path, body) {
  const { token, row } = await freshAccessToken(env, userId);
  const call = async (bearer) => {
    const headers = { authorization: `Bearer ${bearer}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw unavailable();
    }
  };
  let res = await call(token);
  if (res.status === 401) res = await call((await refreshFor(env, userId, row)).accessToken);
  if (res.status === 401) throw notConnected();
  if (res.status === 429) {
    const wait = res.headers.get('retry-after') || '30';
    throw new HttpError(429, { error: 'rate_limited', retryAfter: Number(wait) || 30 }, { 'retry-after': wait });
  }
  if (res.status >= 500) throw unavailable();
  return res;
}

// ── the player ──────────────────────────────────────────────────────────────

function pickArt(images, size) {
  const list = images || [];
  return (list.find((i) => i.width === size) || (size <= 64 ? list[list.length - 1] : list[1]) || list[0] || {}).url || null;
}

/* The badge renders this as a link, so only a Spotify web address gets through. */
function spotifyLink(url) {
  return typeof url === 'string' && url.startsWith('https://open.spotify.com/') ? url : null;
}

function compactTrack(item, progressMs, artSize = 300) {
  if (!item) return null;
  const art = pickArt(item.album?.images, artSize);
  return {
    uri: item.uri || null,
    title: item.name || '',
    artists: (item.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    album: item.album?.name || '',
    art,
    url: spotifyLink(item.external_urls?.spotify),
    durationMs: Number(item.duration_ms) || 0,
    progressMs: Number(progressMs) || 0,
  };
}

const REPEAT = ['off', 'context', 'track'];

/** `{ connected: false }`, or `{ connected: true, playing, track, device, deviceId, volume, supportsVolume, shuffle, repeat }`. */
export async function playerState(env, userId) {
  if (!(await getSpotifyTokens(env.DB, userId))) return { connected: false };
  let res;
  try {
    res = await spotifyFetch(env, userId, 'GET', '/me/player');
  } catch (e) {
    if (e instanceof HttpError && e.body.error === 'not_connected') return { connected: false };
    throw e;
  }
  if (res.status === 204) return { connected: true, playing: false, track: null, device: null, deviceId: null, volume: null, supportsVolume: false, shuffle: false, repeat: 'off' };
  const body = await res.json().catch(() => ({}));
  return {
    connected: true,
    playing: !!body.is_playing,
    track: compactTrack(body.item, body.progress_ms),
    device: body.device?.name || null,
    deviceId: body.device?.id || null,
    volume: typeof body.device?.volume_percent === 'number' ? body.device.volume_percent : null,
    supportsVolume: !!body.device && body.device.supports_volume !== false,
    shuffle: !!body.shuffle_state,
    repeat: REPEAT.includes(body.repeat_state) ? body.repeat_state : 'off',
  };
}

/**
 * A refused player command. 404 is no active device. A 403 is Premium only when Spotify
 * says so; otherwise the command did not fit the moment (pausing what is paused).
 */
async function controlError(res) {
  if (res.status === 404) return new HttpError(404, { error: 'no_device' });
  const err = (await res.json().catch(() => ({}))).error || {};
  if (res.status === 403) return new HttpError(403, { error: err.reason === 'PREMIUM_REQUIRED' ? 'premium_required' : 'not_allowed' });
  console.error('spotify refused a command', res.status, err.message || '');
  return unavailable();
}

/** Append Spotify's device_id to a player path when one is given. */
function withDevice(path, deviceId) {
  return deviceId ? `${path}${path.includes('?') ? '&' : '?'}device_id=${encodeURIComponent(deviceId)}` : path;
}

/** One of ACTIONS, on the active device or the one named. Throws a mapped HttpError on failure. */
export async function control(env, userId, action, deviceId = null) {
  const [method, path] = ACTIONS[action];
  const res = await spotifyFetch(env, userId, method, withDevice(path, deviceId));
  if (!res.ok) throw await controlError(res);
}

/** Move playback to this device; `play` false leaves it paused there. */
export async function transfer(env, userId, deviceId, play = true) {
  const res = await spotifyFetch(env, userId, 'PUT', '/me/player', { device_ids: [deviceId], play });
  if (!res.ok) throw await controlError(res);
}

/** The devices Spotify can play on right now. A restricted one takes no commands. */
export async function devices(env, userId) {
  const res = await spotifyFetch(env, userId, 'GET', '/me/player/devices');
  if (!res.ok) throw await readFailure(res, 'devices');
  const b = await bodyOf(res);
  return (b.devices || []).filter((d) => d && d.id).map((d) => ({
    id: d.id, name: d.name || 'Unnamed device', type: d.type || '',
    active: !!d.is_active, restricted: !!d.is_restricted,
  }));
}

export async function setShuffle(env, userId, on) {
  const res = await spotifyFetch(env, userId, 'PUT', `/me/player/shuffle?state=${on ? 'true' : 'false'}`);
  if (!res.ok) throw await controlError(res);
}

/** One of off, context (the playlist or album), track. */
export async function setRepeat(env, userId, mode) {
  const res = await spotifyFetch(env, userId, 'PUT', `/me/player/repeat?state=${mode}`);
  if (!res.ok) throw await controlError(res);
}

// ── the Spotify view: search, playlists, queue, volume ──────────────────────

const LIST_LIMIT = 50;
// Playlists come five at a time, and More asks for the next five: opening the view
// stays one small request, well inside a development-mode app's rate limit.
const PLAYLIST_LIMIT = 5;

function compactAlbum(a) {
  return {
    uri: a.uri, id: a.id, name: a.name || '',
    artists: (a.artists || []).map((x) => x.name).filter(Boolean).join(', '),
    art: pickArt(a.images, 64), count: Number(a.total_tracks) || 0,
  };
}

function compactArtist(a) {
  return { uri: a.uri, id: a.id, name: a.name || '', art: pickArt(a.images, 64) };
}

function compactPlaylist(p) {
  return {
    uri: p.uri, id: p.id, name: p.name || '',
    owner: p.owner?.display_name || '', ownerId: p.owner?.id || null, collaborative: !!p.collaborative,
    /* `tracks` before February 2026; neither for a playlist the user does not own, so unknown */
    art: pickArt(p.images, 64), count: typeof (p.items || p.tracks)?.total === 'number' ? (p.items || p.tracks).total : null,
  };
}

const page = (body, offset, mapped) => ({ items: mapped, total: Number(body.total) || mapped.length, next: !!body.next, offset });

async function bodyOf(res) {
  return res.json().catch(() => ({}));
}

/**
 * A read Spotify refused. A token granted before a scope was added to SCOPES is told
 * to reconnect; anything else is logged with Spotify's own words and reported as
 * Spotify being unavailable. `forbidden` is the error for any other 403.
 */
async function readFailure(res, what, forbidden = null) {
  const message = String((await bodyOf(res)).error?.message || '');
  if (res.status === 403 && /scope/i.test(message)) return new HttpError(403, { error: 'reconnect_needed' });
  if (res.status === 403 && forbidden) return new HttpError(403, { error: forbidden });
  console.error('spotify refused', what, res.status, message);
  return unavailable();
}

export const SEARCH_TYPES = ['track', 'artist', 'album', 'playlist'];
const SEARCH_LIMIT = 10;       /* Spotify's most for a development-mode app */

/**
 * Tracks, artists, albums and playlists matching `q`, ten of each; or, with `type`, the
 * next ten of that one kind from `offset`. `more` says which kinds have further pages.
 */
export async function search(env, userId, q, type = null, offset = 0) {
  const types = type ? [type] : SEARCH_TYPES;
  const res = await spotifyFetch(env, userId, 'GET', `/search?type=${types.join(',')}&limit=${SEARCH_LIMIT}&offset=${offset}&q=${encodeURIComponent(q)}`);
  if (!res.ok) throw await readFailure(res, 'search');
  const b = await bodyOf(res);
  const list = (key, map) => (b[key]?.items || []).filter(Boolean).map(map);
  return {
    tracks: list('tracks', (t) => compactTrack(t, 0, 64)),
    artists: list('artists', compactArtist),
    albums: list('albums', compactAlbum),
    playlists: list('playlists', compactPlaylist),
    more: Object.fromEntries(['tracks', 'artists', 'albums', 'playlists'].map((k) => [k, !!b[k]?.next])),
  };
}

/** Who the connected account is, so the view can tell the user's own playlists from others'. */
export async function me(env, userId) {
  const res = await spotifyFetch(env, userId, 'GET', '/me');
  if (!res.ok) throw await readFailure(res, 'me');
  const b = await bodyOf(res);
  return { id: b.id || null, name: b.display_name || '' };
}

/** An album's tracks. Spotify leaves the album off each one; the view already knows it. */
export async function albumTracks(env, userId, id, offset = 0) {
  const res = await spotifyFetch(env, userId, 'GET', `/albums/${id}/tracks?limit=${LIST_LIMIT}&offset=${offset}`);
  if (res.status === 404 || res.status === 400) throw new HttpError(404, { error: 'not_found' });
  if (!res.ok) throw await readFailure(res, 'album tracks');
  const b = await bodyOf(res);
  return page(b, offset, (b.items || []).filter((t) => t && t.uri && !t.is_local).map((t) => compactTrack(t, 0, 64)));
}

/** An artist's albums and singles, newest first as Spotify gives them. */
export async function artistAlbums(env, userId, id, offset = 0) {
  const res = await spotifyFetch(env, userId, 'GET', `/artists/${id}/albums?include_groups=album,single&limit=${SEARCH_LIMIT}&offset=${offset}`);
  if (res.status === 404 || res.status === 400) throw new HttpError(404, { error: 'not_found' });
  if (!res.ok) throw await readFailure(res, 'artist albums');
  const b = await bodyOf(res);
  return page(b, offset, (b.items || []).filter(Boolean).map(compactAlbum));
}

/** What the user played lately, each track once, most recent first. */
export async function recent(env, userId) {
  const res = await spotifyFetch(env, userId, 'GET', '/me/player/recently-played?limit=50');
  if (!res.ok) throw await readFailure(res, 'recently played');
  const b = await bodyOf(res);
  const seen = new Set();
  const tracks = (b.items || []).map((i) => i && i.track).filter((t) => t && t.uri && !seen.has(t.uri) && seen.add(t.uri));
  return { items: tracks.slice(0, 20).map((t) => compactTrack(t, 0, 64)) };
}

/** The user's playlists, a page at a time. */
export async function playlists(env, userId, offset = 0) {
  const res = await spotifyFetch(env, userId, 'GET', `/me/playlists?limit=${PLAYLIST_LIMIT}&offset=${offset}`);
  if (!res.ok) throw await readFailure(res, 'playlists');
  const b = await bodyOf(res);
  return page(b, offset, (b.items || []).filter(Boolean).map(compactPlaylist));
}

/**
 * A playlist's tracks, or the user's Liked Songs for id `liked`. Local files and episodes
 * are skipped. Since February 2026 a playlist's entries come from /items with the track
 * under `item`, and a development-mode app may only open playlists the user owns or
 * collaborates on (a 403 otherwise). Liked Songs entries still carry `track`.
 */
export async function playlistTracks(env, userId, id, offset = 0) {
  const path = id === 'liked' ? `/me/tracks?limit=${LIST_LIMIT}&offset=${offset}` : `/playlists/${id}/items?limit=${LIST_LIMIT}&offset=${offset}`;
  const res = await spotifyFetch(env, userId, 'GET', path);
  if (res.status === 404) throw new HttpError(404, { error: 'not_found' });
  if (!res.ok) throw await readFailure(res, id === 'liked' ? 'liked' : 'playlist items', id === 'liked' ? null : 'playlist_forbidden');
  const b = await bodyOf(res);
  const tracks = (b.items || [])
    .filter((i) => i && !i.is_local)
    .map((i) => i.item || i.track)
    .filter((t) => t && t.type !== 'episode' && !t.is_local && t.uri);
  return page(b, offset, tracks.map((t) => compactTrack(t, 0, 64)));
}

/** What is playing and what comes next. Spotify offers no way to remove from or reorder the queue. */
export async function queue(env, userId) {
  const res = await spotifyFetch(env, userId, 'GET', '/me/player/queue');
  if (!res.ok) throw await readFailure(res, 'queue');
  const b = await bodyOf(res);
  return {
    current: compactTrack(b.currently_playing, 0, 64),
    queue: (b.queue || []).filter(Boolean).map((t) => compactTrack(t, 0, 64)),
  };
}

export async function addToQueue(env, userId, uri) {
  const res = await spotifyFetch(env, userId, 'POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`);
  if (!res.ok) throw await controlError(res);
}

/**
 * Start a track, a track inside a playlist or album, a whole playlist or album, or a
 * list of tracks (Liked Songs has no context Spotify will play) from `uri` in it.
 */
export async function play(env, userId, { uri, contextUri, uris = null, deviceId = null }) {
  const body = contextUri ? { context_uri: contextUri, ...(uri ? { offset: { uri } } : {}) }
    : uris ? { uris, ...(uri ? { offset: { uri } } : {}) }
    : { uris: [uri] };
  const res = await spotifyFetch(env, userId, 'PUT', withDevice('/me/player/play', deviceId), body);
  if (!res.ok) throw await controlError(res);
}

export async function setVolume(env, userId, percent) {
  const res = await spotifyFetch(env, userId, 'PUT', `/me/player/volume?volume_percent=${percent}`);
  if (!res.ok) throw await controlError(res);
}
