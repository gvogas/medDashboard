import { setHTML } from '../dom.js';
// The Spotify badge at the bottom of the coat. Given the poller's state, draws it.
// A tick only moves the progress line, so the buttons are not rebuilt under the cursor.

import { esc, $ } from '../dom.js';
import { state as web, playTarget } from '../web-player.js';

export const SPOTIFY_MARK = '<svg class="spot" viewBox="0 0 24 24" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="12" fill="currentColor"/>'
  + '<path d="M6.2 9.4c3.9-1.1 8.4-.8 11.7 1.2M6.9 12.5c3.2-.9 6.9-.6 9.7 1M7.5 15.4c2.5-.7 5.3-.5 7.6.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>';

const ICON = {
  prev: '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2 1h1.6v10H2zM10 1.5v9L4 6z"/></svg>',
  next: '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M8.4 1H10v10H8.4zM2 1.5v9l6-4.5z"/></svg>',
  play: '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3.2 1.5v9l7-4.5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z"/></svg>',
};

const MESSAGES = {
  no_device: 'Open Spotify somewhere, or use a desktop browser',
  nothing_to_resume: 'Pick something in the Spotify view',
  premium_required: 'Controls need Spotify Premium',
  not_allowed: 'Spotify would not do that right now',
  spotify_unavailable: 'Spotify is not answering',
  rate_limited: 'Spotify asked us to slow down',
  offline: 'You seem to be offline',
};

let lastKey = null;

function message(s) {
  return s.error ? '<div class="msg" role="status">' + esc(MESSAGES[s.error] || MESSAGES.spotify_unavailable) + '</div>' : '';
}

function pct(track) {
  return track && track.durationMs ? Math.min(100, (track.progressMs / track.durationMs) * 100) : 0;
}

/* What the badge looks like, apart from the moving line. Same key, no rebuild. */
function shapeKey(s) {
  return [s.loaded, s.connected, s.playing, s.stale, s.error, s.device, s.track && s.track.url, s.track && s.track.title, playTarget(s, web)].join('|');
}

export function renderPlayer(s, kind = 'state') {
  const host = $('player');
  if (!host) return;
  const key = shapeKey(s);
  if (kind === 'tick' && key === lastKey) {
    const line = host.querySelector('.line i');
    if (line) line.style.width = pct(s.track) + '%';
    return;
  }
  lastKey = key;
  host.toggleAttribute('data-stale', !!s.stale);
  host.dataset.state = !s.loaded ? 'loading' : !s.connected ? 'off' : !s.track ? 'idle' : s.playing ? 'playing' : 'paused';
  host.hidden = !s.loaded;
  if (!s.loaded) { setHTML(host, ''); return; }

  if (!s.connected) {
    setHTML(host, '<a class="connect" href="/api/spotify/connect">' + SPOTIFY_MARK + 'Connect Spotify</a>');
    return;
  }
  const target = playTarget(s, web);
  if (!s.track) {
    setHTML(host, '<div class="quiet">' + SPOTIFY_MARK + 'Nothing playing'
      + (target === 'here' ? '<button class="pp" type="button" data-spotify="play" aria-label="Play in Rounds" title="Play in Rounds">' + ICON.play + '</button>' : '')
      + '</div>' + message(s));
    return;
  }
  const t = s.track;
  setHTML(host,
    '<div class="now">'
      + (t.art ? '<img class="art" src="' + esc(t.art) + '" alt="" width="42" height="42">' : '<span class="art"></span>')
      + '<div class="meta">'
        + (t.url ? '<a class="title" href="' + esc(t.url) + '" target="_blank" rel="noopener" title="Open in Spotify">' + esc(t.title) + '</a>'
                 : '<span class="title">' + esc(t.title) + '</span>')
        + '<span class="artist">' + esc(t.artists) + '</span>'
        + '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>'
      + '</div>'
      + SPOTIFY_MARK
    + '</div>'
    + '<span class="line"><i data-width="' + pct(t) + '"></i></span>'
    + '<div class="ctl">'
      + '<button type="button" data-spotify="previous" aria-label="Previous">' + ICON.prev + '</button>'
      + '<button class="pp" type="button" data-spotify="' + (s.playing ? 'pause' : 'play') + '" aria-label="' + (s.playing ? 'Pause' : 'Play') + '">' + (s.playing ? ICON.pause : ICON.play) + '</button>'
      + '<button type="button" data-spotify="next" aria-label="Next">' + ICON.next + '</button>'
    + '</div>'
    + message(s)
    + (s.device ? '<div class="device">on <b>' + esc(s.device) + '</b>'
      + (target === 'offer' ? ' · <button class="here" type="button" data-spotify="here" title="Move the music into this tab">Play here</button>' : '')
      + '</div>' : ''));
}
