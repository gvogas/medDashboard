// The Spotify view's data: what it fetched through the Worker, cached for the session,
// and the loads, pane changes and search that fill that cache.

import { api, ApiError, retryDelayMs, spotifyRetryAt } from '../api.js';
import { ui } from '../state.js';

export const cache = {
  me: null,                 /* { id, name } of the Spotify account, to tell its playlists from others' */
  playlists: null,          /* { items, total, next } once loaded */
  tracks: {},               /* list key → { items, total, next }: a playlist id, 'liked' or 'album:<id>' */
  albums: {},               /* album id → { uri, name, artists, art, count }, from search and artist pages */
  artists: {},              /* artist id → { uri, name, art } */
  artistAlbums: {},         /* artist id → { items, total, next } */
  queue: null,              /* { current, queue } */
  results: null,            /* { q, tracks, artists, albums, playlists, more } */
  recent: null,             /* { items } */
  recentBlocked: false,     /* the connection predates the recently-played scope */
  devices: null,            /* [{ id, name, type, active, restricted }] while the picker is open */
  names: { liked: 'Liked Songs' },
};
const retryAt = {};         /* a load that failed is not retried by a redraw before this */
export const busy = new Set();     /* what is being fetched: guards each load, and the empty states */
export let note = null;     /* a short line under the top row: { text, ok } */
let noteTimer = null;
let typeTimer = null;
export let rerender = () => {};

export function onChange(fn) { rerender = fn; }

/* A load starts while the view is being drawn; redrawing right there would draw inside
   the draw and start the next load, over and over. Redraw once the draw is done. */
let redrawQueued = false;
function redraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  queueMicrotask(() => { redrawQueued = false; rerender(); });
}

const MESSAGES = {
  no_device: 'Open Spotify somewhere, or use a desktop browser, then try again.',
  premium_required: 'That needs Spotify Premium.',
  not_allowed: 'Spotify would not do that right now.',
  spotify_unavailable: 'Spotify is not answering right now.',
  rate_limited: 'Spotify asked us to slow down. Try again in a moment.',
  not_connected: 'Spotify is not connected. Connect it in Settings.',
  not_found: 'That is not on Spotify any more.',
  reconnect_needed: 'Spotify needs a fresh connection for this. Reconnect in Settings › Spotify.',
  playlist_forbidden: 'Spotify only lets Rounds open playlists you made or collaborate on.',
  offline: 'You seem to be offline.',
};

export function explain(e) {
  if (!(e instanceof ApiError)) return MESSAGES.offline;
  if (e.status === 429) return cooldownMessage(spotifyRetryAt() || Date.now() + retryDelayMs(e));
  return MESSAGES[e.body?.error] || MESSAGES.spotify_unavailable;
}

export function cooldownMessage(until) {
  const time = new Date(until).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return 'Spotify requests are paused. Try again after ' + time + '. You can keep listening in Spotify.';
}

export function say(text, ms = 4000, ok = false) {
  note = { text, ok };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = null; rerender(); }, ms);
  rerender();
}

export const due = (what) => Date.now() >= (retryAt[what] || 0);

/** `quiet(e)` may take a failure itself and return true, so no note is shown. */
export async function load(what, fn, quiet = () => false) {
  busy.add(what);
  redraw();
  try {
    await fn();
    delete retryAt[what];
  } catch (e) {
    /* The redraw below would ask again at once; a refusal would then loop and keep
       the app over Spotify's rate limit. Wait before a redraw may ask again. */
    retryAt[what] = Date.now() + retryDelayMs(e);
    if (!quiet(e)) say(explain(e), 6000);
  } finally {
    busy.delete(what);
    rerender();
  }
}

function go(pane, fields = {}) {
  if (pane !== ui.spotify.pane || Object.keys(fields).some((k) => ui.spotify[k] !== fields[k])) ui.spotify.filter = '';
  Object.assign(ui.spotify, { pane }, fields);
}

/* ── loaders ── */

let meAsked = false;       /* a redraw while /me is out must not ask again */
export function ensureMe() {
  if (cache.me || meAsked || busy.size || !due('me')) return;
  meAsked = true;
  /* Only for hiding "open" on others' playlists: a failure just leaves it showing. */
  api.spotifyMe().then((m) => { cache.me = m; rerender(); }, (e) => { retryAt.me = Date.now() + Math.max(retryDelayMs(e), 60000); })
    .finally(() => { meAsked = false; });
}

export function ensurePlaylists() {
  if (cache.playlists || busy.has('playlists') || !due('playlists')) return;
  load('playlists', async () => {
    cache.playlists = await api.spotifyPlaylists(0);
    cache.playlists.items.forEach((p) => { cache.names[p.id] = p.name; });
  });
}

export function ensureRecent() {
  if (cache.recent || cache.recentBlocked || busy.has('recent') || !due('recent')) return;
  load('recent', async () => { cache.recent = await api.spotifyRecent(); },
    (e) => { if (e instanceof ApiError && e.body?.error === 'reconnect_needed') { cache.recentBlocked = true; return true; } return false; });
}

function morePlaylists() {
  const pl = cache.playlists;
  if (!pl || !pl.next || busy.has('playlists') || !due('playlists')) return;
  load('playlists', async () => {
    const page = await api.spotifyPlaylists(pl.nextOffset);
    pl.items.push(...page.items); pl.next = page.next; pl.nextOffset = page.nextOffset; pl.total = page.total;
    page.items.forEach((p) => { cache.names[p.id] = p.name; });
  });
}

function fetchList(key, offset) {
  if (key.startsWith('album:')) {
    const id = key.slice(6), meta = cache.albums[id] || {};
    return api.spotifyAlbumTracks(id, offset).then((page) => {
      page.items.forEach((t) => { t.art = t.art || meta.art || null; t.album = t.album || meta.name || ''; });
      return page;
    });
  }
  return api.spotifyPlaylistTracks(key, offset);
}

function loadList(key) {
  load('tracks', async () => {
    const page = await fetchList(key, 0);
    cache.tracks[key] = page;
  });
}

export function openHome() {
  go('home');
  rerender();
}

export function openPlaylist(id, name) {
  if (name) cache.names[id] = name;
  go('playlist', { playlistId: id });
  if (cache.tracks[id]) { rerender(); return; }
  loadList(id);
}

export function openAlbum(id) {
  go('album', { albumId: id });
  if (cache.tracks['album:' + id]) { rerender(); return; }
  loadList('album:' + id);
}

export function openArtist(id) {
  go('artist', { artistId: id });
  if (cache.artistAlbums[id]) { rerender(); return; }
  load('artist', async () => {
    const page = await api.spotifyArtistAlbums(id, 0);
    page.items.forEach((a) => { cache.albums[a.id] = a; });
    cache.artistAlbums[id] = page;
  });
}

function listKey() {
  const s = ui.spotify;
  return s.pane === 'playlist' ? s.playlistId : s.pane === 'album' ? 'album:' + s.albumId : null;
}

export function more(what) {
  if (what === 'playlists') return morePlaylists();
  if (what.startsWith('search:')) return searchMore(what.slice(7));
  if (what === 'artist') {
    const id = ui.spotify.artistId, a = cache.artistAlbums[id];
    if (!a || !a.next || busy.has('artist') || !due('artist')) return;
    return load('artist', async () => {
      const page = await api.spotifyArtistAlbums(id, a.nextOffset);
      page.items.forEach((x) => { cache.albums[x.id] = x; });
      a.items.push(...page.items); a.next = page.next; a.nextOffset = page.nextOffset; a.total = page.total;
    });
  }
  const key = listKey(), t = key && cache.tracks[key];
  if (!t || !t.next || busy.has('tracks') || !due('tracks')) return;
  load('tracks', async () => {
    const page = await fetchList(key, t.nextOffset);
    t.items.push(...page.items); t.next = page.next; t.nextOffset = page.nextOffset; t.total = page.total;
  });
}

export function openQueue(refresh = false) {
  go('queue');
  if (cache.queue && !refresh) { rerender(); return; }
  load('queue', async () => { cache.queue = await api.spotifyQueue(); });
}

/** A refresh button: the playlist list, the open list, the queue, or recently played. */
export function refresh(what) {
  // Keep the visible cache while the shared request gate is waiting out a 429.
  if (spotifyRetryAt()) { rerender(); return; }
  if (what === 'playlists') { cache.playlists = null; delete retryAt.playlists; ensurePlaylists(); return; }
  if (what === 'queue') { openQueue(true); return; }
  if (what === 'recent') { cache.recent = null; delete retryAt.recent; ensureRecent(); return; }
  const key = listKey();
  if (key) { delete cache.tracks[key]; loadList(key); }
}

function remember(r) {
  r.albums.forEach((a) => { cache.albums[a.id] = a; });
  r.artists.forEach((a) => { cache.artists[a.id] = a; });
  r.playlists.forEach((p) => { cache.names[p.id] = p.name; });
}

export function search(q, typed = false) {
  q = (q || '').trim();
  ui.spotify.q = q;
  if (!q) return;
  if (typed && (!due('search') || busy.has('search'))) { catchUp(); return; }
  go('search', { q });
  if (cache.results && cache.results.q === q) { rerender(); return; }
  lastAsked = q;
  load('search', async () => {
    const r = await api.spotifySearch(q);
    remember(r);
    cache.results = { q, ...r };
  }).then(catchUp);
}

/* Text typed while a search is out, or while Spotify has asked us to wait, is searched
   once the way is clear, so the list never stays on "Searching…" for it. */
let lastAsked = null, catchUpTimer = null;
function catchUp() {
  clearTimeout(catchUpTimer);
  if (busy.has('search')) return;   /* the search that is out calls this when it ends */
  const q = ui.spotify.q;
  if (!q || q === lastAsked || (cache.results && cache.results.q === q)) return;
  catchUpTimer = setTimeout(() => {
    /* someone who has moved on to an album or playlist is not pulled back to results */
    if (ui.spotify.pane === 'search' && ui.spotify.q === q) search(q);
  }, Math.max(0, (retryAt.search || 0) - Date.now()));
}

/** Search as the user types: after a pause, and only for two characters or more. */
export function typed(value) {
  clearTimeout(typeTimer);
  const q = (value || '').trim();
  if (q.length < 2) return;
  typeTimer = setTimeout(() => { if (ui.spotify.pane !== 'search' || ui.spotify.q !== q) search(q, true); }, 450);
}

const SEARCH_TYPE = { tracks: 'track', artists: 'artist', albums: 'album', playlists: 'playlist' };

function searchMore(kind) {
  const r = cache.results;
  if (!r || !r.more[kind] || !SEARCH_TYPE[kind] || busy.has('search') || !due('search')) return;
  load('search', async () => {
    const page = await api.spotifySearch(r.q, SEARCH_TYPE[kind], r.nextOffsets[kind]);
    remember(page);
    r[kind].push(...page[kind]);
    r.more[kind] = page.more[kind];
    r.nextOffsets[kind] = page.nextOffsets[kind];
  });
}
