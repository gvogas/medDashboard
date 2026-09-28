// The legacy slide-in drawer, for Settings and the drawers not yet moved to React (the
// item and course are the React sheet, components/sheet/). What takes focus, this drawer,
// the sheet or an overlay, is decided in src/data/overlay.ts for both.

import { ui } from '../state.js';
import { $, refind, setHTML } from '../dom.js';
import { render } from './render.js';
import * as overlay from '../../../data/overlay.ts';

export const drawer = $('drawer');
export const scrim = $('scrim');

/* The drawer is a modal dialog: while it is open the page behind it is inert, so Tab
   stays inside; when it closes, focus goes back to what opened it. Closed, it is inert
   itself, so its buttons leave the Tab order although it is only slid off-screen. */
let opener = null;

export function showDrawer(html) {
  const opening = !drawer.classList.contains('on');
  const had = drawer.contains(document.activeElement) ? document.activeElement : null;
  if (opening) opener = document.activeElement;
  overlay.legacyDrawer(true);   /* closes the React sheet, saving what it had pending */
  setHTML(drawer, html);
  drawer.setAttribute('aria-label', drawer.querySelector('.dhead .kind')?.textContent || 'Details');
  drawer.classList.add('on');
  overlay.settle();
  scrim.classList.add('on');
  /* callers may focus a field right after; only take focus if nothing inside has it */
  if (opening) requestAnimationFrame(() => { if (!drawer.contains(document.activeElement)) drawer.focus(); });
  /* redrawn under the keyboard (a select changed, a file picked): the same control, or the drawer */
  else if (had && !had.isConnected) {
    const next = refind(had);
    if (next && drawer.contains(next)) next.focus({ preventScroll: true });
    if (!drawer.contains(document.activeElement)) drawer.focus({ preventScroll: true });
  }
}

export function hideDrawer() {
  const wasOpen = drawer.classList.contains('on');
  drawer.classList.remove('on');
  overlay.legacyDrawer(false);
  if (!overlay.getSheet()) scrim.classList.remove('on');
  if (wasOpen) refind(opener)?.focus();   /* a redraw may have replaced the opener: its successor */
  opener = null;
}

export function resetDrawerState() {
  ui.confirm = null; ui.sessionDraft = null; ui.achDraft = null;
}

/** Run before the drawer closes, e.g. to save what is still being typed. */
export const beforeClose = new Set();

export function closeDrawer() {
  for (const fn of beforeClose) fn();
  resetDrawerState();
  render();
  hideDrawer();
}

export function drawerHasFocus() {
  return drawer.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName);
}

/** Is any drawer open: the React sheet (an item, a course, Settings, an import, the school calendar), a study session or an achievement. */
export const drawerOpen = () => !!(overlay.getSheet() || ui.sessionDraft || ui.achDraft);

/* The React sheet opening closes this drawer the usual way. */
overlay.onLegacyClose(() => closeDrawer());
