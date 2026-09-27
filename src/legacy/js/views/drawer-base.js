// The slide-in drawer and its scrim, shared by the item, course and settings panels.

import { ui } from '../state.js';
import { $, refind, setHTML } from '../dom.js';
import { render } from './render.js';
import { notify } from '../../../bridge.ts';

export const drawer = $('drawer');
export const scrim = $('scrim');

/* The drawer is a modal dialog: while it is open the page behind it is inert, so Tab
   stays inside; when it closes, focus goes back to what opened it. Closed, it is inert
   itself, so its buttons leave the Tab order although it is only slid off-screen. */
let opener = null;
let covers = 0;   /* overlays above everything, drawer included: the shortcuts, the busy card */

/** Which of the page and the drawer take focus, from what is open. */
function settle() {
  const open = drawer.classList.contains('on');
  drawer.inert = covers > 0 || !open;
  $('app').inert = covers > 0 || open;
}
/** An overlay opens (`true`) or closes over the page and the drawer. */
export function cover(on) {
  covers = Math.max(0, covers + (on ? 1 : -1));
  settle();
}

export function showDrawer(html) {
  const opening = !drawer.classList.contains('on');
  const had = drawer.contains(document.activeElement) ? document.activeElement : null;
  if (opening) opener = document.activeElement;
  setHTML(drawer, html);
  drawer.setAttribute('aria-label', drawer.querySelector('.dhead .kind')?.textContent || 'Details');
  drawer.classList.add('on');
  settle();
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
  settle();
  scrim.classList.remove('on');
  if (wasOpen) refind(opener)?.focus();   /* a redraw may have replaced the opener: its successor */
  opener = null;
}

export function resetDrawerState() {
  ui.sel = null; ui.draft = null; ui.courseDraft = null; ui.courseMode = null; ui.confirm = null; ui.settings = false; ui.importPlan = null; ui.fillNote = null; ui.sessionDraft = null; ui.achDraft = null; ui.schoolDraft = null; ui.signoutAsk = null;
  /* questions asked in Settings are not still asked when it opens again */
  ui.schoolAsk = false; if (ui.feed) ui.feed.confirm = null;
}

/** Run before the drawer closes, e.g. to save what is still being typed. */
export const beforeClose = new Set();

export function closeDrawer() {
  for (const fn of beforeClose) fn();
  resetDrawerState();
  ui.spotifyNote = null;
  ui.importNote = null;
  ui.schoolNote = null;
  render();
  hideDrawer();
}

export function drawerHasFocus() {
  return drawer.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName);
}

/** Is any drawer open: an item, a course, settings, an import, a study session, an achievement or the school calendar. */
export const drawerOpen = () => !!(ui.sel || ui.draft || ui.courseDraft || ui.settings || ui.importPlan || ui.sessionDraft || ui.achDraft || ui.schoolDraft);

/* On narrow screens the sidebar slides over the page. Closed, it is inert, so Tab does
   not wander through it off-screen; open, it takes focus and Escape closes it. */
export const narrow = window.matchMedia('(max-width:900px)');
export function setSide(open) {
  const side = $('side'), btn = $('menuBtn');
  side.classList.toggle('on', open);
  side.inert = narrow.matches && !open;
  /* open over the page, the page behind is dimmed and out of reach */
  document.querySelector('.content').inert = narrow.matches && open;
  if (!drawer.classList.contains('on')) scrim.classList.toggle('on', narrow.matches && open);
  notify();   /* the top bar's menu button (React) reads .on for aria-expanded */
  if (open) side.querySelector('button, input')?.focus();
  else if (side.contains(document.activeElement)) btn?.focus();
}
