// The keyboard: single-key shortcuts, Escape closing whatever is on top, Enter in the
// small add-a-thing boxes.

import { ui } from './state.js';
import { $, isTyping } from './dom.js';
import { getSheet, requestCloseSheet } from '../../data/overlay.ts';
import { setSide } from '../../data/sidebar.ts';
import { openKeys, closeKeys, keysOpen } from '../../data/keys.ts';
import { getBusy } from '../../data/ai-read.ts';
import { setView } from './study-controller.js';
import { escapeFocus } from '../../data/study-timer.ts';
import { newItem, goToday, step } from '../../data/actions.ts';

/* Single keys, when nothing is being typed and no drawer or the focus screen is up:
   the list is components/overlays.tsx. Each does what its top-bar button does; a number shows a view. */
const VIEW_KEYS = { 1: 'week', 2: 'month', 3: 'table', 4: 'spotify', 5: 'study' };
function shortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target) || e.target.isContentEditable) return false;
  if (getBusy()) return false;
  if (e.key === '?') { keysOpen() ? closeKeys() : openKeys(); e.preventDefault(); return true; }
  if (keysOpen() || ui.focus || getSheet() || $('app').hidden) return false;
  const run = (fn) => { e.preventDefault(); fn(); return true; };
  if (e.key === 'n') return run(newItem);
  if (e.key === 't') return run(goToday);
  if ((e.key === '[' || e.key === ']') && (ui.view === 'week' || ui.view === 'month')) return run(() => step(e.key === '[' ? -1 : 1));
  if (VIEW_KEYS[e.key]) return run(() => setView(VIEW_KEYS[e.key]));
  return false;
}

export async function onKeydown(e) {
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;   /* a field used it, like the time picker closing its list */
    if (keysOpen()) { closeKeys(); return; }
    if ($('side').classList.contains('on')) { setSide(false); return; }
    /* the sheet takes Escape itself when focus is inside it; this is for when it is not */
    if (getSheet()) { requestCloseSheet(); return; }
    if (ui.focus) escapeFocus();          /* the music panel first, then the focus screen */
    return;
  }
  if (shortcut(e)) return;
  /* The focus screen takes Space, M and / itself (components/focus/focus-screen.tsx). */
  if (ui.focus) return;
  if (e.key === '/' && !e.defaultPrevented && !/input|textarea|select/i.test(e.target.tagName)) {
    e.preventDefault(); $('search')?.focus(); return;   /* the top bar's search box */
  }
}
