// What the Spotify view asks Spotify to do lives in data/spotify/commands.ts. This keeps
// the legacy view's controls in step with it without a redraw, until the Spotify UI is
// React's (stage 6).

import { state as player } from '../spotify.js';
import { $ } from '../dom.js';
import { onControls, queueAdd as addToQueue, setVolume as sendVolume, volumeHeld } from '../../../data/spotify/commands.ts';
import { REPEAT_LABEL } from './spotify-html.js';

export { play, toggleShuffle, cycleRepeat, toggleDevices, pickDevice } from '../../../data/spotify/commands.ts';

export async function queueAdd(uri, btn) {
  if (!(await addToQueue(uri))) return;
  if (btn) { btn.textContent = '✓'; btn.disabled = true; setTimeout(() => { btn.textContent = '+'; btn.disabled = false; }, 1500); }
}

/** Debounced in commands.ts; the number beside the slider follows at once. */
export function setVolume(percent) {
  sendVolume(percent);
  const label = document.querySelector('[data-spot-vol-label]');
  if (label) label.textContent = percent;
}

/** Called on every poll: keep the slider honest unless the user is holding it. */
export function syncVolume() {
  const s = document.querySelector('[data-spot-vol]');
  if (!s || document.activeElement === s || volumeHeld()) return;
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

onControls(syncControls);
