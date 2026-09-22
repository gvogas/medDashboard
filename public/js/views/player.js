// The Spotify strip at the bottom of the sidebar. The strip is rebuilt only when what
// it shows changes, so a button keeps its focus through a poll; the progress line is
// moved on its own every second.

import { esc, $ } from '../dom.js';

const MARK = '<svg class="spmark" viewBox="0 0 24 24" role="img" aria-label="Spotify"><path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
const icon = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + d + '"/></svg>';
const ICONS = {
  previous: icon('M6 5h2v14H6zM20 5v14L9 12z'),
  next: icon('M16 5h2v14h-2zM4 5v14l11-7z'),
  play: icon('M7 5v14l12-7z'),
  pause: icon('M6 5h4v14H6zM14 5h4v14h-4z'),
};

const NOTES = {
  no_device: 'Open Spotify on a device first',
  premium_required: 'Controls need Spotify Premium',
  spotify_unavailable: 'Spotify is not answering',
};
const NOTE_MS = 4000;

let last = null, note = '', noteTimer = null, drawn = '';

function markup(s) {
  if (!s.connected) {
    return ['connect', '<button class="player-connect" type="button" data-spotify-connect>' + MARK + '<span>Connect Spotify</span></button>'];
  }
  const noteHtml = note ? '<div class="player-note" role="status">' + esc(note) + '</div>' : '';
  const t = s.track;
  if (!t) return ['idle', '<div class="player-idle">' + MARK + '<span>Nothing playing</span></div>' + noteHtml];
  const link = (cls, inner) => (t.url
    ? '<a class="' + cls + '" href="' + esc(t.url) + '" target="_blank" rel="noopener">' + inner + '</a>'
    : '<span class="' + cls + '">' + inner + '</span>');
  return ['track',
    '<div class="player-now">'
      + (t.art ? link('player-art', '<img src="' + esc(t.art) + '" alt="' + esc(t.album) + '" width="36" height="36">') : '')
      + '<div class="player-meta">' + link('player-title', esc(t.title)) + '<div class="player-artist">' + esc(t.artists) + '</div></div>'
      + MARK
    + '</div>'
    + '<div class="player-bar"><i id="playerBar"></i></div>'
    + '<div class="player-ctl">'
      + '<button type="button" data-spotify="previous" aria-label="Previous">' + ICONS.previous + '</button>'
      + '<button type="button" data-spotify="toggle" aria-label="' + (s.playing ? 'Pause' : 'Play') + '">' + (s.playing ? ICONS.pause : ICONS.play) + '</button>'
      + '<button type="button" data-spotify="next" aria-label="Next">' + ICONS.next + '</button>'
    + '</div>'
    + noteHtml];
}

/** Draw the strip for this state; null hides it. */
export function renderPlayer(s) {
  const el = $('player');
  if (!el) return;
  last = s;
  if (!s) { el.hidden = true; el.innerHTML = ''; drawn = ''; return; }
  el.hidden = false;
  el.toggleAttribute('data-stale', !!s.stale);
  const [mode, html] = markup(s);
  el.dataset.mode = mode;
  if (html !== drawn) { el.innerHTML = html; drawn = html; }
  renderProgress(s);
}

/** Move the progress line only. */
export function renderProgress(s) {
  const bar = $('playerBar'), t = s?.track;
  if (bar && t && t.durationMs) bar.style.width = Math.min(100, (t.progressMs / t.durationMs) * 100).toFixed(2) + '%';
}

/** A short explanation under the controls after a command fails, for four seconds. */
export function showPlayerNote(code) {
  note = NOTES[code] || NOTES.spotify_unavailable;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = ''; renderPlayer(last); }, NOTE_MS);
  renderPlayer(last);
}
