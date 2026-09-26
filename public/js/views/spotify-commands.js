// What the Spotify view asks Spotify to do: play, queue, shuffle, repeat, devices and
// volume, and the controls kept in step with them without a redraw.

import { api } from '../api.js';
import { ui } from '../state.js';
import { state as player, poll, onRoundsIfIdle } from '../spotify.js';
import { state as web } from '../web-player.js';
import { $ } from '../dom.js';
import { cache, rerender, say, explain, load, openQueue } from './spotify-data.js';
import { REPEAT_LABEL } from './spotify-html.js';

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

/* ── following the poller without a redraw ── */

export function syncControls() {
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
