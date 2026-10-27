// Spotify playback and library operations. The SDK also talks directly to Spotify.
import { HttpError } from './http.js';
import { spotifyFetch } from './spotify/client.js';
import { bodyOf, unavailable } from './spotify/transport.js';
import { compactTrack, compactAlbum, compactArtist, compactPlaylist, nextPageOffset, page } from './spotify/mapping.js';
export { configured, authorizeUrl, encryptToken, decryptToken, sealToken, openToken, exchangeCode, freshAccessToken } from './spotify/tokens.js';
const ACTIONS = {
  play: ['PUT', '/me/player/play'],
  pause: ['PUT', '/me/player/pause'],
  next: ['POST', '/me/player/next'],
  previous: ['POST', '/me/player/previous'],
  restart: ['PUT', '/me/player/seek?position_ms=0'],
};

const REPEAT = ['off', 'context', 'track'];

/** `{ connected: false }`, or `{ connected: true, playing, track, device, deviceId, volume, supportsVolume, shuffle, repeat }`. */
export async function playerState(env, userId) {
  // No pre-check for a row: spotifyFetch reads it anyway and throws not_connected.
  let res;
  try {
    res = await spotifyFetch(env, userId, 'GET', '/me/player');
  } catch (e) {
    if (e instanceof HttpError && e.body.error === 'not_connected') return { connected: false };
    throw e;
  }
  if (res.status === 204) return { connected: true, playing: false, track: null, device: null, deviceId: null, volume: null, supportsVolume: false, shuffle: false, repeat: 'off' };
  if (!res.ok) throw await readFailure(res, 'player');
  const body = await bodyOf(res);
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

/**
 * A read Spotify refused. A 400 is a request it would not take (a paging offset past
 * its end), passed on as one. A token granted before a scope was added to SCOPES is told
 * to reconnect; anything else is logged with Spotify's own words and reported as
 * Spotify being unavailable. `forbidden` is the error for any other 403.
 */
async function readFailure(res, what, forbidden = null) {
  if (res.status === 400) return new HttpError(400, { error: 'spotify_rejected' });
  const message = String((await bodyOf(res).catch(() => ({}))).error?.message || '');
  if (res.status === 403 && /scope/i.test(message)) return new HttpError(403, { error: 'reconnect_needed' });
  if (res.status === 403 && forbidden) return new HttpError(403, { error: forbidden });
  console.error('spotify refused', what, res.status, message);
  return unavailable();
}

export const SEARCH_TYPES = ['track', 'artist', 'album', 'playlist'];
const KINDS = SEARCH_TYPES.map((t) => t + 's');
const PAGE_SIZE = 10;       /* Spotify's most for a development-mode app */
/* Spotify pages search results no further than 1000 in, offset plus limit. */
export const SEARCH_MAX_OFFSET = 1000 - PAGE_SIZE;

/**
 * Tracks, artists, albums and playlists matching `q`, ten of each; or, with `type`, the
 * next ten of that one kind from `offset`. `more` says which kinds have further pages.
 */
export async function search(env, userId, q, type = null, offset = 0) {
  const types = type ? [type] : SEARCH_TYPES;
  const res = await spotifyFetch(env, userId, 'GET', `/search?type=${types.join(',')}&limit=${PAGE_SIZE}&offset=${offset}&q=${encodeURIComponent(q)}`);
  if (!res.ok) throw await readFailure(res, 'search');
  const b = await bodyOf(res);
  const list = (key, map) => (b[key]?.items || []).filter(Boolean).map(map);
  const next = (key) => {
    const at = b[key]?.next ? nextPageOffset(b[key], offset) : null;
    return at !== null && at <= SEARCH_MAX_OFFSET ? at : null;
  };
  return {
    tracks: list('tracks', (t) => compactTrack(t, 0, 64)),
    artists: list('artists', compactArtist),
    albums: list('albums', compactAlbum),
    playlists: list('playlists', compactPlaylist),
    more: Object.fromEntries(KINDS.map((k) => [k, next(k) !== null])),
    nextOffsets: Object.fromEntries(KINDS.map((k) => [k, next(k)])),
  };
}

/** Who the connected account is, so the view can tell the user's own playlists from others'. */
export async function me(env, userId) {
  const res = await spotifyFetch(env, userId, 'GET', '/me');
  if (!res.ok) throw await readFailure(res, 'me');
  const b = await bodyOf(res);
  return { id: b.id || null, name: b.display_name || '' };
}

/** Not there: a 404, or the 400 Spotify gives an id that cannot be one. Reads a clone. */
async function missing(res) {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  return /invalid (base62 )?id/i.test(String((await bodyOf(res.clone()).catch(() => ({}))).error?.message || ''));
}

/** An album's tracks. Spotify leaves the album off each one; the view already knows it. */
export async function albumTracks(env, userId, id, offset = 0) {
  const res = await spotifyFetch(env, userId, 'GET', `/albums/${id}/tracks?limit=${LIST_LIMIT}&offset=${offset}`);
  if (await missing(res)) throw new HttpError(404, { error: 'not_found' });
  if (!res.ok) throw await readFailure(res, 'album tracks');
  const b = await bodyOf(res);
  return page(b, offset, (b.items || []).filter((t) => t && t.uri && !t.is_local).map((t) => compactTrack(t, 0, 64)));
}

/** An artist's albums and singles, newest first as Spotify gives them. */
export async function artistAlbums(env, userId, id, offset = 0) {
  const res = await spotifyFetch(env, userId, 'GET', `/artists/${id}/albums?include_groups=album,single&limit=${PAGE_SIZE}&offset=${offset}`);
  if (await missing(res)) throw new HttpError(404, { error: 'not_found' });
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
