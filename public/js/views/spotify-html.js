// The Spotify view's markup: rows, the playlist column, the open list and the top bar,
// drawn from the session cache in spotify-data.js.

import { ui } from '../state.js';
import { spotifyRetryAt } from '../api.js';
import { state as player } from '../spotify.js';
import { state as web } from '../web-player.js';
import { esc } from '../dom.js';
import { SPOTIFY_MARK } from './player.js';
import { cache, busy, note, cooldownMessage } from './spotify-data.js';

export function mmss(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const art = (url, cls = 'art') => url ? '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="' + cls + ' none"></span>';
export const EQ = '<i class="eqs" aria-label="Playing"><b></b><b></b><b></b></i>';
export const isNow = (uri) => !!(player.track && player.track.uri && player.track.uri === uri);

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

export function navHtml() {
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

export function mainHtml() {
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

export const REPEAT_LABEL = { off: 'Repeat is off', context: 'Repeating the playlist or album', track: 'Repeating this track' };

export function topHtml() {
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
