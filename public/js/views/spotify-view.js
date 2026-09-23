import { setHTML } from '../dom.js';
// The Spotify view: search, playlists, albums, artists, the queue, devices and volume.
// Data is fetched through the Worker and cached here for the session; the badge's
// poller owns "now playing", and this view follows it without redrawing the page.

import { api, ApiError, retryDelayMs, spotifyRetryAt } from '../api.js';
import { ui } from '../state.js';
import { state as player, poll, onRoundsIfIdle } from '../spotify.js';
import { state as web } from '../web-player.js';
import { esc, $ } from '../dom.js';
import { SPOTIFY_MARK } from './player.js';

const cache = {
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
const busy = new Set();     /* what is being fetched: guards each load, and the empty states */
let note = null;            /* a short line under the top row: { text, ok } */
let noteTimer = null;
let typeTimer = null;
let lastUri;                /* the track the poller last reported, to notice a change */
let rerender = () => {};

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

function explain(e) {
  if (!(e instanceof ApiError)) return MESSAGES.offline;
  if (e.status === 429) return cooldownMessage(spotifyRetryAt() || Date.now() + retryDelayMs(e));
  return MESSAGES[e.body?.error] || MESSAGES.spotify_unavailable;
}

function cooldownMessage(until) {
  const time = new Date(until).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return 'Spotify requests are paused. Try again after ' + time + '. You can keep listening in Spotify.';
}

function say(text, ms = 4000, ok = false) {
  note = { text, ok };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = null; rerender(); }, ms);
  rerender();
}

const due = (what) => Date.now() >= (retryAt[what] || 0);

/** `quiet(e)` may take a failure itself and return true, so no note is shown. */
async function load(what, fn, quiet = () => false) {
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

/** Which list is open, so a redraw of the same one keeps its scroll. */
export function paneKey() {
  const s = ui.spotify;
  return s.pane + ':' + (s.pane === 'playlist' ? s.playlistId : s.pane === 'album' ? s.albumId : s.pane === 'artist' ? s.artistId : s.pane === 'search' ? s.q : '');
}

function go(pane, fields = {}) {
  if (pane !== ui.spotify.pane || Object.keys(fields).some((k) => ui.spotify[k] !== fields[k])) ui.spotify.filter = '';
  Object.assign(ui.spotify, { pane }, fields);
}

/* ── loaders ── */

let meAsked = false;       /* a redraw while /me is out must not ask again */
function ensureMe() {
  if (cache.me || meAsked || busy.size || !due('me')) return;
  meAsked = true;
  /* Only for hiding "open" on others' playlists: a failure just leaves it showing. */
  api.spotifyMe().then((m) => { cache.me = m; rerender(); }, (e) => { retryAt.me = Date.now() + Math.max(retryDelayMs(e), 60000); })
    .finally(() => { meAsked = false; });
}

function ensurePlaylists() {
  if (cache.playlists || busy.has('playlists') || !due('playlists')) return;
  load('playlists', async () => {
    cache.playlists = await api.spotifyPlaylists(0);
    cache.playlists.items.forEach((p) => { cache.names[p.id] = p.name; });
  });
}

function ensureRecent() {
  if (cache.recent || cache.recentBlocked || busy.has('recent') || !due('recent')) return;
  load('recent', async () => { cache.recent = await api.spotifyRecent(); },
    (e) => { if (e instanceof ApiError && e.body?.error === 'reconnect_needed') { cache.recentBlocked = true; return true; } return false; });
}

export function morePlaylists() {
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
  if (typed && (!due('search') || busy.has('search'))) return;
  go('search', { q });
  if (cache.results && cache.results.q === q) { rerender(); return; }
  load('search', async () => {
    const r = await api.spotifySearch(q);
    remember(r);
    cache.results = { q, ...r };
  });
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

/* ── commands ── */

/**
 * Play a track, a context, or a track within a list Spotify has no context for
 * (Liked Songs, recently played): then the loaded tracks from that one onward.
 */
export async function play(uri, contextUri, list) {
  let uris = null;
  if (list && !contextUri) {
    const items = (list === 'recent' ? cache.recent?.items : cache.tracks[list]?.items) || [];
    const from = uri ? Math.max(0, items.findIndex((t) => t.uri === uri)) : 0;
    uris = items.slice(from, from + 100).map((t) => t.uri);
    if (!uris.length) uris = null;
  }
  try {
    await onRoundsIfIdle((deviceId) => api.spotifyPlay({
      uri: uri || null, contextUri: contextUri || null, ...(uris ? { uris } : {}), ...(deviceId ? { deviceId } : {}),
    }));
    say('Playing.', 1500, true);
    setTimeout(poll, 300);                       /* the badge catches up; Spotify lags a command */
  } catch (e) { say(explain(e)); }
}

export async function queueAdd(uri, btn) {
  try {
    await api.spotifyQueueAdd(uri);
    if (btn) { btn.textContent = '✓'; btn.disabled = true; setTimeout(() => { btn.textContent = '+'; btn.disabled = false; }, 1500); }
    if (ui.spotify.pane === 'queue') openQueue(true);
    else cache.queue = null;                     /* stale now; reloaded when the pane is opened */
  } catch (e) { say(explain(e)); }
}

export async function toggleShuffle() {
  const was = player.shuffle;
  player.shuffle = !was;
  syncControls();
  try {
    await api.spotifyShuffle(!was);
    setTimeout(poll, 300);
  } catch (e) { player.shuffle = was; syncControls(); say(explain(e)); }
}

const NEXT_REPEAT = { off: 'context', context: 'track', track: 'off' };

export async function cycleRepeat() {
  const was = player.repeat, next = NEXT_REPEAT[was] || 'off';
  player.repeat = next;
  syncControls();
  try {
    await api.spotifyRepeat(next);
    setTimeout(poll, 300);
  } catch (e) { player.repeat = was; syncControls(); say(explain(e)); }
}

export function toggleDevices() {
  if (cache.devices) { cache.devices = null; rerender(); return; }
  cache.devices = [];
  load('devices', async () => { cache.devices = (await api.spotifyDevices()).devices; },
    (e) => { cache.devices = null; return false; });
}

/** Move playback to a device, keeping it playing or paused as it was. */
export async function pickDevice(id) {
  const d = (cache.devices || []).find((x) => x.id === id);
  cache.devices = null;
  rerender();
  if (!d || d.active) return;
  try {
    await api.spotifyTransfer(id, player.playing);
    say('Moved to ' + (id === web.deviceId ? 'this tab' : d.name) + '.', 2000, true);
    setTimeout(poll, 500);
  } catch (e) { say(explain(e)); }
}

let volumeTimer = null;
let volumePending = null;
/** Debounced: the slider fires constantly while dragged; Spotify gets the last value. */
export function setVolume(percent) {
  volumePending = percent;
  player.volume = percent;
  const label = document.querySelector('[data-spot-vol-label]');
  if (label) label.textContent = percent;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(async () => {
    const v = volumePending; volumePending = null;
    try { await api.spotifyVolume(v); } catch (e) { say(explain(e)); }
  }, 250);
}

/** Called on every poll: keep the slider honest unless the user is holding it. */
export function syncVolume() {
  const s = document.querySelector('[data-spot-vol]');
  if (!s || document.activeElement === s || volumePending !== null) return;
  if (player.volume != null) { s.value = player.volume; const l = document.querySelector('[data-spot-vol-label]'); if (l) l.textContent = player.volume; }
  s.disabled = !player.supportsVolume;
}

/* ── the filter inside a list ── */

export function setFilter(value) {
  ui.spotify.filter = value;
  applyFilter();
}

function matches(row, f) {
  return !f || (row.dataset.find || '').includes(f);
}

function applyFilter() {
  const root = $('viewRoot'), f = (ui.spotify.filter || '').trim().toLowerCase();
  if (!root) return;
  let shown = 0, all = 0;
  root.querySelectorAll('.spot-main .spot-list .trk').forEach((row) => {
    all++;
    const ok = matches(row, f);
    row.hidden = !ok;
    if (ok) shown++;
  });
  const count = root.querySelector('[data-spot-filter-count]');
  if (count) count.textContent = f ? shown + ' of ' + all + ' loaded' : '';
}

/* ── html ── */

function mmss(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const art = (url, cls = 'art') => url ? '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="' + cls + ' none"></span>';
const EQ = '<i class="eqs" aria-label="Playing"><b></b><b></b><b></b></i>';
const isNow = (uri) => !!(player.track && player.track.uri && player.track.uri === uri);

function trackRow(t, { contextUri = null, list = null } = {}) {
  const now = isNow(t.uri);
  const find = (t.title + ' ' + t.artists + ' ' + (t.album || '')).toLowerCase();
  const f = (ui.spotify.filter || '').trim().toLowerCase();
  return '<div class="trk' + (now ? ' now' : '') + '" data-uri="' + esc(t.uri) + '" data-dur="' + (t.durationMs || 0) + '" data-find="' + esc(find) + '"' + (f && !find.includes(f) ? ' hidden' : '') + '>'
    + art(t.art)
    + '<div class="what"><b>' + esc(t.title) + '</b><span>' + esc(t.artists) + (t.album ? ' · ' + esc(t.album) : '') + '</span></div>'
    + '<span class="dur mono">' + (now && player.playing ? EQ : mmss(t.durationMs)) + '</span>'
    + '<span class="acts">'
      + '<button type="button" data-spot-play="' + esc(t.uri) + '"' + (contextUri ? ' data-spot-ctx="' + esc(contextUri) + '"' : '') + (list ? ' data-spot-list="' + esc(list) + '"' : '') + ' title="Play" aria-label="Play ' + esc(t.title) + '">▶</button>'
      + '<button type="button" data-spot-queue="' + esc(t.uri) + '" title="Add to queue" aria-label="Queue ' + esc(t.title) + '">+</button>'
    + '</span></div>';
}

function albumRow(a) {
  return '<div class="trk alb">' + art(a.art) + '<div class="what"><b>' + esc(a.name) + '</b><span>' + esc(a.artists) + (a.count ? ' · ' + a.count + (a.count === 1 ? ' track' : ' tracks') : '') + '</span></div>'
    + '<span class="acts"><button type="button" data-spot-play="" data-spot-ctx="' + esc(a.uri) + '" title="Play album" aria-label="Play ' + esc(a.name) + '">▶</button>'
    + '<button type="button" data-spot-album="' + esc(a.id) + '" title="Open" aria-label="Open ' + esc(a.name) + '">›</button></span></div>';
}

function artistRow(a) {
  return '<div class="trk art-row">' + art(a.art, 'art round') + '<div class="what"><b>' + esc(a.name) + '</b><span>Artist</span></div>'
    + '<span class="acts"><button type="button" data-spot-play="" data-spot-ctx="' + esc(a.uri) + '" title="Play artist" aria-label="Play ' + esc(a.name) + '">▶</button>'
    + '<button type="button" data-spot-artist="' + esc(a.id) + '" title="Open" aria-label="Open ' + esc(a.name) + '">›</button></span></div>';
}

/* Spotify only lets Rounds open playlists the user owns or collaborates on. */
const canOpen = (p) => !cache.me || p.ownerId === cache.me.id || p.collaborative;

function playlistRow(p) {
  return '<div class="trk">' + art(p.art) + '<div class="what"><b>' + esc(p.name) + '</b><span>' + [p.owner ? esc(p.owner) : '', p.count == null ? '' : p.count + ' tracks'].filter(Boolean).join(' · ') + '</span></div>'
    + '<span class="acts"><button type="button" data-spot-play="" data-spot-ctx="' + esc(p.uri) + '" title="Play playlist" aria-label="Play ' + esc(p.name) + '">▶</button>'
    + (canOpen(p) ? '<button type="button" data-spot-pl="' + esc(p.id) + '" data-spot-name="' + esc(p.name) + '" title="Open" aria-label="Open ' + esc(p.name) + '">›</button>' : '')
    + '</span></div>';
}

function loadingRow(what) {
  return '<div class="empty"><b>' + esc(what) + '</b>'
    + (spotifyRetryAt() ? 'Waiting for the Spotify request limit to reset.' : 'Asking Spotify…') + '</div>';
}

function moreButton(action, n) {
  return '<button class="addcourse spot-more" type="button" data-spot-more="' + esc(action) + '">Show more' + (n > 0 ? ' · ' + n + ' left' : '') + '</button>';
}

const refreshBtn = (what, label = 'Refresh') =>
  '<button class="btn ghost tiny" type="button" data-spot-refresh="' + what + '" title="' + label + '" aria-label="' + label + '">↻</button>';

function filterBox(t) {
  if (!t || t.items.length < 8) return '';
  return '<div class="spot-filter"><input type="search" placeholder="Filter these tracks" aria-label="Filter tracks" data-spot-filter value="' + esc(ui.spotify.filter || '') + '" autocomplete="off">'
    + '<span class="mono" data-spot-filter-count></span></div>';
}

function navHtml() {
  const pl = cache.playlists, cur = ui.spotify.pane, id = ui.spotify.playlistId;
  const item = (attrs, on, inner) => '<button class="spl' + (on ? ' on' : '') + '" type="button" ' + attrs + '>' + inner + '</button>';
  let h = '<div class="panel spot-nav"><div class="ph">Your music</div>';
  h += item('data-spot-pane="home"', cur === 'home', '<span class="ico">◷</span><span class="nm">Recently played</span>');
  h += item('data-spot-pane="queue"', cur === 'queue', '<span class="ico">≡</span><span class="nm">Queue</span>');
  h += item('data-spot-pl="liked"', cur === 'playlist' && id === 'liked', '<span class="ico">♥</span><span class="nm">Liked Songs</span>');
  h += '<div class="ph sub">Playlists' + (pl ? '<em>' + pl.total + '</em>' : '') + refreshBtn('playlists', 'Refresh playlists') + '</div>';
  if (!pl) h += busy.has('playlists') ? loadingRow('Playlists') : '';
  else if (!pl.items.length) h += '<div class="empty">No playlists yet.</div>';
  else {
    pl.items.forEach((p) => {
      h += item('data-spot-pl="' + esc(p.id) + '"', cur === 'playlist' && id === p.id,
        art(p.art, 'pa') + '<span class="nm">' + esc(p.name) + '<small>' + [p.count == null ? '' : p.count, p.owner ? esc(p.owner) : ''].filter((x) => x !== '').join(' · ') + '</small></span>');
    });
    if (pl.next) h += moreButton('playlists', pl.total - pl.items.length);
  }
  return h + '</div>';
}

function tracksPane(key, t, { contextUri, list, emptyText }) {
  if (!t) return loadingRow(cache.names[key] || 'Tracks');
  if (!t.items.length) return '<div class="empty">' + emptyText + '</div>';
  let body = filterBox(t) + t.items.map((tr) => trackRow(tr, { contextUri, list })).join('');
  if (t.next) body += moreButton('tracks', t.total - t.items.length);
  return body;
}

function mainHtml() {
  const pane = ui.spotify.pane;
  let head = '', body = '';

  if (pane === 'queue') {
    const q = cache.queue;
    head = 'Queue' + refreshBtn('queue', 'Refresh queue')
      + '<button class="btn ghost tiny" type="button" data-spotify="next">Skip ⏭</button>';
    if (!q) body = loadingRow('Queue');
    else {
      body += '<div class="ph sub">Now playing</div>';
      body += q.current ? trackRow(q.current) : '<div class="empty">Nothing playing.</div>';
      body += '<div class="ph sub">Next up<em>' + q.queue.length + '</em></div>';
      body += q.queue.length ? q.queue.map((t) => trackRow(t)).join('') : '<div class="empty">The queue is empty. Add to it with + on any track.</div>';
      body += '<div class="spot-hint">Spotify lets apps add to the queue and skip, but not remove or reorder. Do that in the Spotify app.</div>';
    }
  } else if (pane === 'search') {
    const r = cache.results;
    head = 'Results' + (r ? '<em>for “' + esc(r.q) + '”</em>' : '');
    if (!r || r.q !== ui.spotify.q) body = loadingRow('Searching');
    else if (!r.tracks.length && !r.artists.length && !r.albums.length && !r.playlists.length) body = '<div class="empty"><b>Nothing found</b>Try another spelling.</div>';
    else {
      const section = (kind, title, rows) => {
        if (!r[kind].length) return '';
        return '<div class="ph sub">' + title + '</div>' + rows + (r.more[kind] ? moreButton('search:' + kind, 0) : '');
      };
      body += section('tracks', 'Tracks', r.tracks.map((t) => trackRow(t)).join(''));
      body += section('artists', 'Artists', r.artists.map(artistRow).join(''));
      body += section('albums', 'Albums', r.albums.map(albumRow).join(''));
      body += section('playlists', 'Playlists', r.playlists.map(playlistRow).join(''));
    }
  } else if (pane === 'playlist') {
    const id = ui.spotify.playlistId, t = cache.tracks[id], name = cache.names[id] || 'Playlist';
    const liked = id === 'liked', ctx = liked ? null : 'spotify:playlist:' + id;
    head = esc(name) + (t ? '<em>' + t.total + ' tracks</em>' : '') + refreshBtn('list')
      + (t && t.items.length ? '<button class="btn tiny" type="button" data-spot-play=""' + (ctx ? ' data-spot-ctx="' + esc(ctx) + '"' : ' data-spot-list="liked"') + '>▶ Play all</button>' : '');
    body = tracksPane(id, t, { contextUri: ctx, list: liked ? 'liked' : null, emptyText: 'Nothing in here yet.' });
  } else if (pane === 'album') {
    const id = ui.spotify.albumId, a = cache.albums[id] || { name: 'Album', uri: 'spotify:album:' + id }, t = cache.tracks['album:' + id];
    head = esc(a.name) + (a.artists ? '<em>' + esc(a.artists) + '</em>' : '') + refreshBtn('list')
      + '<button class="btn tiny" type="button" data-spot-play="" data-spot-ctx="' + esc(a.uri) + '">▶ Play album</button>';
    body = tracksPane('album:' + id, t, { contextUri: a.uri, emptyText: 'This album has no tracks Spotify will play.' });
  } else if (pane === 'artist') {
    const id = ui.spotify.artistId, a = cache.artists[id] || { name: 'Artist', uri: 'spotify:artist:' + id }, list = cache.artistAlbums[id];
    head = esc(a.name) + '<button class="btn tiny" type="button" data-spot-play="" data-spot-ctx="' + esc(a.uri) + '">▶ Play</button>';
    if (!list) body = loadingRow(a.name);
    else if (!list.items.length) body = '<div class="empty">No albums here.</div>';
    else body = '<div class="ph sub">Albums and singles</div>' + list.items.map(albumRow).join('') + (list.next ? moreButton('artist', list.total - list.items.length) : '');
  } else {
    head = 'Recently played' + (cache.recent ? refreshBtn('recent', 'Refresh recently played') : '');
    if (cache.recentBlocked) {
      body = '<div class="empty"><b>Reconnect to see what you played lately</b>Rounds needs one more permission from Spotify for this.'
        + '<br><a class="btn" href="/api/spotify/connect" data-layout="df928149">Reconnect Spotify</a></div>';
    } else if (!cache.recent) body = busy.has('recent') ? loadingRow('Recently played') : '<div class="empty"><b>Pick a playlist, open the queue, or search</b>Play anything from here on whichever device Spotify is open on.</div>';
    else if (!cache.recent.items.length) body = '<div class="empty"><b>Nothing played lately</b>Pick a playlist or search to start.</div>';
    else body = cache.recent.items.map((t) => trackRow(t, { list: 'recent' })).join('');
  }
  return '<div class="panel spot-main"><div class="ph">' + head + '</div><div class="spot-list">' + body + '</div></div>';
}

const DEVICE_ICON = { Computer: '💻', Smartphone: '📱', Tablet: '📱', Speaker: '🔈', TV: '📺', CastVideo: '📺', CastAudio: '🔈', AVR: '🔈', STB: '📺', GameConsole: '🎮', Automobile: '🚗' };

function devicesHtml() {
  const list = cache.devices;
  if (!list) return '';
  let h = '<div class="panel spot-devs" role="dialog" aria-label="Choose a device"><div class="ph sub">Play on</div>';
  if (busy.has('devices') && !list.length) h += loadingRow('Devices');
  else if (!list.length) h += '<div class="empty">No devices. Open Spotify on your phone, computer or speaker.</div>';
  else {
    list.forEach((d) => {
      const here = d.id === web.deviceId;
      h += '<button class="spl' + (d.active ? ' on' : '') + '" type="button" data-spot-device="' + esc(d.id) + '"' + (d.restricted ? ' disabled title="This device does not take commands"' : '') + '>'
        + '<span class="ico">' + (DEVICE_ICON[d.type] || '🔈') + '</span><span class="nm">' + esc(here ? 'This tab' : d.name)
        + '<small>' + (d.active ? 'Playing here' : here ? 'Rounds, in this browser' : esc(d.type)) + '</small></span></button>';
    });
  }
  return h + '</div>';
}

const REPEAT_LABEL = { off: 'Repeat is off', context: 'Repeating the playlist or album', track: 'Repeating this track' };

function topHtml() {
  const cooldown = spotifyRetryAt();
  const vol = player.volume, can = player.connected && player.supportsVolume && vol != null, live = !!player.device;
  return '<div class="spot-top">'
    + '<form class="spot-search" data-spot-form role="search"><span class="spot-mark">' + SPOTIFY_MARK + '</span>'
    + '<input type="search" name="q" placeholder="Search tracks, artists, albums, playlists" aria-label="Search Spotify" value="' + esc(ui.spotify.q) + '" data-spot-q autocomplete="off">'
    + '<kbd class="spot-kbd" title="Press / to search">/</kbd>'
    + '<button class="btn" type="submit">Search</button></form>'
    + '<div class="spot-modes">'
    + '<button type="button" class="spot-mode' + (player.shuffle ? ' on' : '') + '" data-spot-shuffle aria-pressed="' + player.shuffle + '" title="Shuffle" aria-label="Shuffle"' + (live ? '' : ' disabled') + '>⤮</button>'
    + '<button type="button" class="spot-mode' + (player.repeat !== 'off' ? ' on' : '') + '" data-spot-repeat data-mode="' + esc(player.repeat) + '" title="' + REPEAT_LABEL[player.repeat] + '" aria-label="' + REPEAT_LABEL[player.repeat] + '"' + (live ? '' : ' disabled') + '>' + (player.repeat === 'track' ? '↻¹' : '↻') + '</button>'
    + '</div>'
    + '<div class="spot-vol' + (can ? '' : ' off') + '" title="' + (can ? 'Volume on ' + esc(player.device) : player.device ? 'This device does not take volume from here' : 'Nothing is playing') + '">'
    + '<span class="ico" aria-hidden="true">' + (vol === 0 ? '🔇' : vol != null && vol < 50 ? '🔉' : '🔊') + '</span>'
    + '<input type="range" min="0" max="100" step="1" value="' + (vol == null ? 50 : vol) + '" data-spot-vol aria-label="Volume"' + (can ? '' : ' disabled') + '>'
    + '<span class="mono" data-spot-vol-label>' + (vol == null ? '—' : vol) + '</span>'
    + '</div>'
    + '<button type="button" class="spot-dev' + (cache.devices ? ' open' : '') + '" data-spot-devices aria-expanded="' + !!cache.devices + '" title="Choose where Spotify plays">'
    + '<span data-spot-dev-name>' + esc(player.device || 'Choose a device') + '</span> ▾</button>'
    + devicesHtml()
    + '</div>'
    + (cooldown ? '<div class="spot-note" role="status">' + esc(cooldownMessage(cooldown)) + '</div>'
      : note ? '<div class="spot-note' + (note.ok ? ' ok' : '') + '" role="status">' + esc(note.text) + '</div>' : '');
}

export function renderSpotifyView() {
  if (!player.loaded) return '<div class="panel"><div class="empty"><b>Spotify</b>Checking your connection…</div></div>';
  if (!player.connected) {
    return '<div class="panel spot-off"><div class="empty">' + SPOTIFY_MARK + '<b>Spotify is not connected</b>'
      + 'Connect your account to search, browse your playlists, see the queue and set the volume from here.'
      + '<br><a class="btn" href="/api/spotify/connect" data-layout="df928149">Connect Spotify</a></div></div>';
  }
  ensurePlaylists();
  ensureMe();
  if (ui.spotify.pane === 'home') ensureRecent();
  if (ui.spotify.pane === 'queue' && !cache.queue && !busy.has('queue') && due('queue')) openQueue();
  return '<div class="spot-view">' + topHtml() + '<div class="spot-cols">' + navHtml() + mainHtml() + '</div></div>';
}

let drawnKey = null;

/**
 * Draw the view into `root`, keeping what a redraw would lose: the scroll of each column
 * (the list's only while the same list is open) and the caret in a text box.
 */
export function renderSpotifyInto(root) {
  const nav = root.querySelector('.spot-nav'), main = root.querySelector('.spot-main');
  const keep = { nav: nav ? nav.scrollTop : 0, main: main ? main.scrollTop : 0 };
  const box = document.activeElement && document.activeElement.closest && root.contains(document.activeElement)
    ? ['data-spot-q', 'data-spot-filter'].find((a) => document.activeElement.hasAttribute(a)) : null;
  const val = box ? document.activeElement.value : '', pos = box ? document.activeElement.selectionStart : 0;
  const key = paneKey(), same = key === drawnKey;
  setHTML(root, renderSpotifyView());
  drawnKey = key;
  const n = root.querySelector('.spot-nav'), m = root.querySelector('.spot-main');
  if (n) n.scrollTop = keep.nav;
  if (m && same) m.scrollTop = keep.main;
  if (box) {
    const el = root.querySelector('[' + box + ']');
    if (el) { el.value = val; el.focus({ preventScroll: true }); try { el.setSelectionRange(pos, pos); } catch {} }
  }
  applyFilter();
}

export function devicesOpen() { return !!cache.devices; }
export function closeDevices() { if (cache.devices) { cache.devices = null; rerender(); } }

/* ── following the poller without a redraw ── */

function syncControls() {
  const root = $('viewRoot');
  if (!root) return;
  const live = !!player.device;
  const sh = root.querySelector('[data-spot-shuffle]');
  if (sh) { sh.classList.toggle('on', player.shuffle); sh.setAttribute('aria-pressed', String(player.shuffle)); sh.disabled = !live; }
  const rp = root.querySelector('[data-spot-repeat]');
  if (rp) {
    rp.classList.toggle('on', player.repeat !== 'off');
    rp.dataset.mode = player.repeat;
    rp.textContent = player.repeat === 'track' ? '↻¹' : '↻';
    rp.title = REPEAT_LABEL[player.repeat]; rp.setAttribute('aria-label', REPEAT_LABEL[player.repeat]);
    rp.disabled = !live;
  }
  const dev = root.querySelector('[data-spot-dev-name]');
  if (dev) dev.textContent = player.device || 'Choose a device';
}

/* The "now" marker and the equaliser move from row to row in place, so the list keeps its scroll. */
function markNow(root) {
  root.querySelectorAll('.trk[data-uri]').forEach((row) => {
    const now = isNow(row.dataset.uri);
    row.classList.toggle('now', now);
    const dur = row.querySelector('.dur');
    if (!dur) return;
    const eq = now && player.playing;
    if (eq !== !!dur.querySelector('.eqs')) setHTML(dur, eq ? EQ : mmss(Number(row.dataset.dur) || 0));
  });
}

/** The poller learned something: update only what depends on it. */
export function onPlayerState() {
  const root = $('viewRoot');
  if (ui.view !== 'spotify' || !root) return;
  if (!root.querySelector('.spot-view') && player.loaded) { rerender(); return; }   /* was "connecting…" or "not connected" */
  if (!player.connected) { rerender(); return; }
  syncVolume();
  syncControls();
  const vol = root.querySelector('.spot-vol');
  if (vol && vol.classList.contains('off') === !!(player.supportsVolume && player.volume != null)) { rerender(); return; }
  markNow(root);
  const uri = player.track?.uri || null;
  if (uri !== lastUri) {
    const changed = lastUri !== undefined;
    lastUri = uri;
    /* the next track has moved up: what is queued has changed too */
    if (changed && ui.spotify.pane === 'queue' && !busy.has('queue') && due('queue')) load('queue', async () => { cache.queue = await api.spotifyQueue(); });
  }
}
