import { setHTML } from '../dom.js';
// The Spotify view: search, playlists, albums, artists, the queue, devices and volume.
// Data is fetched through the Worker and cached for the session in spotify-data.js; the
// badge's poller owns "now playing", and this view follows it without redrawing the page.

import { api } from '../api.js';
import { ui } from '../state.js';
import { state as player } from '../spotify.js';
import { $ } from '../dom.js';
import { SPOTIFY_MARK } from './player.js';
import { cache, busy, due, load, rerender, ensureMe, ensurePlaylists, ensureRecent, openQueue } from './spotify-data.js';
import { topHtml, navHtml, mainHtml, EQ, mmss, isNow } from './spotify-html.js';
import { syncVolume, syncControls } from './spotify-commands.js';

/* The loaders and commands live beside this file; main.js and the tests reach them here. */
export { onChange, openHome, openPlaylist, openAlbum, openArtist, more, openQueue, refresh, search, typed } from './spotify-data.js';
export { play, queueAdd, toggleShuffle, cycleRepeat, toggleDevices, pickDevice, setVolume } from './spotify-commands.js';

let lastUri;                /* the track the poller last reported, to notice a change */

/** Which list is open, so a redraw of the same one keeps its scroll. */
function paneKey() {
  const s = ui.spotify;
  return s.pane + ':' + (s.pane === 'playlist' ? s.playlistId : s.pane === 'album' ? s.albumId : s.pane === 'artist' ? s.artistId : s.pane === 'search' ? s.q : '');
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
  const button = !box && root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
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
  if (button) root.querySelector(button)?.focus({ preventScroll: true });
  applyFilter();
}

/** A selector for the same control after a redraw: its first data-spot-* attribute and value. */
function focusKey(el) {
  const attr = [...(el.attributes || [])].find((a) => a.name.startsWith('data-spot'));
  return attr ? '[' + attr.name + '="' + CSS.escape(attr.value) + '"]' : null;
}

export function devicesOpen() { return !!cache.devices; }
export function closeDevices() { if (cache.devices) { cache.devices = null; rerender(); } }

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
  if ((ui.view !== 'spotify' && !ui.focus) || !root) return;
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
