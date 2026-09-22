// The Spotify view: search, playlists, the queue and volume. Data is fetched through
// the Worker and cached here for the session; the badge's poller owns "now playing".

import { api, ApiError } from '../api.js';
import { ui } from '../state.js';
import { state as player, poll } from '../spotify.js';
import { esc, $ } from '../dom.js';
import { SPOTIFY_MARK } from './player.js';

const cache = {
  playlists: null,          /* { items, total, next } once loaded */
  tracks: {},               /* playlist id → { name, items, total, next } */
  queue: null,              /* { current, queue } */
  results: null,            /* { q, tracks, albums, playlists } */
  names: { liked: 'Liked Songs' },
};
let loading = null;         /* what is being fetched, for the empty state */
let note = null;            /* a short line under the top row: { text, ok } */
let noteTimer = null;
let rerender = () => {};

export function onChange(fn) { rerender = fn; }

const MESSAGES = {
  no_device: 'Open Spotify on a device first, then try again.',
  premium_required: 'That needs Spotify Premium.',
  spotify_unavailable: 'Spotify is not answering right now.',
  rate_limited: 'Spotify asked us to slow down. Try again in a moment.',
  not_connected: 'Spotify is not connected. Connect it in Settings.',
  not_found: 'That playlist is not there any more.',
  offline: 'You seem to be offline.',
};

function explain(e) {
  return e instanceof ApiError ? (MESSAGES[e.body?.error] || MESSAGES.spotify_unavailable) : MESSAGES.offline;
}

function say(text, ms = 4000, ok = false) {
  note = { text, ok };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = null; rerender(); }, ms);
  rerender();
}

async function load(what, fn) {
  loading = what;
  rerender();
  try {
    await fn();
  } catch (e) {
    say(explain(e), 6000);
  } finally {
    loading = null;
    rerender();
  }
}

/* ── loaders ── */

export function ensurePlaylists() {
  if (cache.playlists || loading === 'playlists') return;
  load('playlists', async () => {
    cache.playlists = await api.spotifyPlaylists(0);
    cache.playlists.items.forEach((p) => { cache.names[p.id] = p.name; });
  });
}

export function morePlaylists() {
  const pl = cache.playlists;
  if (!pl || !pl.next) return;
  load('playlists', async () => {
    const page = await api.spotifyPlaylists(pl.items.length);
    pl.items.push(...page.items); pl.next = page.next; pl.total = page.total;
    page.items.forEach((p) => { cache.names[p.id] = p.name; });
  });
}

export function openPlaylist(id, name) {
  if (name) cache.names[id] = name;
  ui.spotify.pane = 'playlist';
  ui.spotify.playlistId = id;
  if (cache.tracks[id]) { rerender(); return; }
  load('tracks', async () => {
    const page = await api.spotifyPlaylistTracks(id, 0);
    cache.tracks[id] = { items: page.items, total: page.total, next: page.next };
  });
}

export function moreTracks() {
  const id = ui.spotify.playlistId, t = cache.tracks[id];
  if (!t || !t.next) return;
  load('tracks', async () => {
    const page = await api.spotifyPlaylistTracks(id, t.items.length);
    t.items.push(...page.items); t.next = page.next; t.total = page.total;
  });
}

export function openQueue(refresh = false) {
  ui.spotify.pane = 'queue';
  if (cache.queue && !refresh) { rerender(); }
  load('queue', async () => { cache.queue = await api.spotifyQueue(); });
}

export function search(q) {
  q = (q || '').trim();
  ui.spotify.q = q;
  if (!q) return;
  ui.spotify.pane = 'search';
  if (cache.results && cache.results.q === q) { rerender(); return; }
  load('search', async () => { cache.results = { q, ...(await api.spotifySearch(q)) }; });
}

/* ── commands ── */

export async function play(uri, contextUri) {
  try {
    await api.spotifyPlay({ uri: uri || null, contextUri: contextUri || null });
    say('Playing.', 1500, true);
    setTimeout(poll, 300);                       /* the badge catches up; Spotify lags a command */
  } catch (e) { say(explain(e)); }
}

export async function queueAdd(uri, btn) {
  try {
    await api.spotifyQueueAdd(uri);
    if (btn) { btn.textContent = '✓'; btn.disabled = true; setTimeout(() => { btn.textContent = '+'; btn.disabled = false; }, 1500); }
    if (cache.queue) cache.queue = null;         /* stale now; reloaded when the pane is opened */
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

/* ── html ── */

function mmss(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const art = (url, cls = 'art') => url ? '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="' + cls + ' none"></span>';

function trackRow(t, contextUri, extra = '') {
  const now = player.track && player.track.uri && player.track.uri === t.uri;
  return '<div class="trk' + (now ? ' now' : '') + '" data-uri="' + esc(t.uri) + '">'
    + art(t.art)
    + '<div class="what"><b>' + esc(t.title) + '</b><span>' + esc(t.artists) + (t.album ? ' · ' + esc(t.album) : '') + '</span></div>'
    + '<span class="dur mono">' + (now && player.playing ? '<i class="eqs" aria-label="Playing"><b></b><b></b><b></b></i>' : mmss(t.durationMs)) + '</span>'
    + '<span class="acts">'
      + '<button type="button" data-spot-play="' + esc(t.uri) + '"' + (contextUri ? ' data-spot-ctx="' + esc(contextUri) + '"' : '') + ' title="Play" aria-label="Play ' + esc(t.title) + '">▶</button>'
      + '<button type="button" data-spot-queue="' + esc(t.uri) + '" title="Add to queue" aria-label="Queue ' + esc(t.title) + '">+</button>'
    + extra + '</span></div>';
}

function loadingRow(what) {
  return '<div class="empty"><b>' + esc(what) + '</b>Asking Spotify…</div>';
}

function moreButton(action, n) {
  return '<button class="addcourse spot-more" type="button" data-spot-more="' + action + '">Show more · ' + n + ' left</button>';
}

function navHtml() {
  const pl = cache.playlists, cur = ui.spotify.pane, id = ui.spotify.playlistId;
  const item = (attrs, on, inner) => '<button class="spl' + (on ? ' on' : '') + '" type="button" ' + attrs + '>' + inner + '</button>';
  let h = '<div class="panel spot-nav"><div class="ph">Your music</div>';
  h += item('data-spot-pane="queue"', cur === 'queue', '<span class="ico">≡</span><span class="nm">Queue</span>');
  h += item('data-spot-pl="liked"', cur === 'playlist' && id === 'liked', '<span class="ico">♥</span><span class="nm">Liked Songs</span>');
  h += '<div class="ph sub">Playlists' + (pl ? '<em>' + pl.total + '</em>' : '') + '</div>';
  if (!pl) h += loading === 'playlists' ? loadingRow('Playlists') : '';
  else if (!pl.items.length) h += '<div class="empty">No playlists yet.</div>';
  else {
    pl.items.forEach((p) => {
      h += item('data-spot-pl="' + esc(p.id) + '"', cur === 'playlist' && id === p.id,
        art(p.art, 'pa') + '<span class="nm">' + esc(p.name) + '<small>' + p.count + (p.owner ? ' · ' + esc(p.owner) : '') + '</small></span>');
    });
    if (pl.next) h += moreButton('playlists', pl.total - pl.items.length);
  }
  return h + '</div>';
}

function mainHtml() {
  const pane = ui.spotify.pane;
  let head = '', body = '';

  if (pane === 'queue') {
    const q = cache.queue;
    head = 'Queue' + '<button class="btn ghost tiny" type="button" data-spot-refresh="queue">Refresh</button>'
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
    else if (!r.tracks.length && !r.albums.length && !r.playlists.length) body = '<div class="empty"><b>Nothing found</b>Try another spelling.</div>';
    else {
      if (r.tracks.length) body += '<div class="ph sub">Tracks</div>' + r.tracks.map((t) => trackRow(t)).join('');
      if (r.albums.length) {
        body += '<div class="ph sub">Albums</div>' + r.albums.map((a) =>
          '<div class="trk">' + art(a.art) + '<div class="what"><b>' + esc(a.name) + '</b><span>' + esc(a.artists) + ' · ' + a.count + ' tracks</span></div>'
          + '<span class="acts"><button type="button" data-spot-play="" data-spot-ctx="' + esc(a.uri) + '" title="Play album" aria-label="Play ' + esc(a.name) + '">▶</button></span></div>').join('');
      }
      if (r.playlists.length) {
        body += '<div class="ph sub">Playlists</div>' + r.playlists.map((p) =>
          '<div class="trk">' + art(p.art) + '<div class="what"><b>' + esc(p.name) + '</b><span>' + (p.owner ? esc(p.owner) + ' · ' : '') + p.count + ' tracks</span></div>'
          + '<span class="acts"><button type="button" data-spot-play="" data-spot-ctx="' + esc(p.uri) + '" title="Play playlist" aria-label="Play ' + esc(p.name) + '">▶</button>'
          + '<button type="button" data-spot-pl="' + esc(p.id) + '" data-spot-name="' + esc(p.name) + '" title="Open" aria-label="Open ' + esc(p.name) + '">›</button></span></div>').join('');
      }
    }
  } else if (pane === 'playlist') {
    const id = ui.spotify.playlistId, t = cache.tracks[id], name = cache.names[id] || 'Playlist';
    const ctx = id === 'liked' ? null : 'spotify:playlist:' + id;
    head = esc(name) + (t ? '<em>' + t.total + ' tracks</em>' : '')
      + (ctx ? '<button class="btn tiny" type="button" data-spot-play="" data-spot-ctx="' + esc(ctx) + '">▶ Play all</button>' : '');
    if (!t) body = loadingRow(name);
    else if (!t.items.length) body = '<div class="empty">Nothing in here yet.</div>';
    else {
      body = t.items.map((tr) => trackRow(tr, ctx)).join('');
      if (t.next) body += moreButton('tracks', t.total - t.items.length);
    }
  } else {
    head = 'Spotify';
    body = '<div class="empty"><b>Pick a playlist, open the queue, or search</b>Play anything from here on whichever device Spotify is open on.</div>';
  }
  return '<div class="panel spot-main"><div class="ph">' + head + '</div><div class="spot-list">' + body + '</div></div>';
}

function topHtml() {
  const vol = player.volume, can = player.connected && player.supportsVolume && vol != null;
  return '<div class="spot-top">'
    + '<form class="spot-search" data-spot-form><span class="spot-mark">' + SPOTIFY_MARK + '</span>'
    + '<input type="search" name="q" placeholder="Search tracks, albums, playlists" aria-label="Search Spotify" value="' + esc(ui.spotify.q) + '" data-spot-q autocomplete="off">'
    + '<button class="btn" type="submit">Search</button></form>'
    + '<div class="spot-vol' + (can ? '' : ' off') + '" title="' + (can ? 'Volume on ' + esc(player.device) : player.device ? 'This device does not take volume from here' : 'Nothing is playing') + '">'
    + '<span class="ico" aria-hidden="true">' + (vol === 0 ? '🔇' : vol != null && vol < 50 ? '🔉' : '🔊') + '</span>'
    + '<input type="range" min="0" max="100" step="1" value="' + (vol == null ? 50 : vol) + '" data-spot-vol aria-label="Volume"' + (can ? '' : ' disabled') + '>'
    + '<span class="mono" data-spot-vol-label>' + (vol == null ? '—' : vol) + '</span>'
    + (player.device ? '<em>' + esc(player.device) + '</em>' : '')
    + '</div></div>'
    + (note ? '<div class="spot-note' + (note.ok ? ' ok' : '') + '" role="status">' + esc(note.text) + '</div>' : '');
}

export function renderSpotifyView() {
  if (!player.loaded) return '<div class="panel"><div class="empty"><b>Spotify</b>Checking your connection…</div></div>';
  if (!player.connected) {
    return '<div class="panel spot-off"><div class="empty">' + SPOTIFY_MARK + '<b>Spotify is not connected</b>'
      + 'Connect your account to search, browse your playlists, see the queue and set the volume from here.'
      + '<br><button class="btn" type="button" data-spotify="connect" style="margin-top:10px">Connect Spotify</button></div></div>';
  }
  ensurePlaylists();
  if (ui.spotify.pane === 'queue' && !cache.queue && loading !== 'queue') openQueue();
  return '<div class="spot-view">' + topHtml() + '<div class="spot-cols">' + navHtml() + mainHtml() + '</div></div>';
}

/** The poller learned something: redraw only what depends on it. */
export function onPlayerState() {
  const root = $('viewRoot');
  if (ui.view !== 'spotify' || !root) return;
  if (!root.querySelector('.spot-view') && player.loaded) { rerender(); return; }   /* was "connecting…" or "not connected" */
  if (!player.connected) { rerender(); return; }
  syncVolume();
  const dev = root.querySelector('.spot-vol em');
  if (dev && player.device && dev.textContent !== player.device) rerender();
  /* the "now" marker moves with the track */
  root.querySelectorAll('.trk').forEach((row) => {
    const now = !!(player.track && player.track.uri && row.dataset.uri === player.track.uri);
    if (row.classList.contains('now') !== now) rerender();
  });
}
