import { setHTML } from '../dom.js';
// The slide-in drawer and its scrim, shared by the item, course and settings panels.

import { ui } from '../state.js';
import { $, refind } from '../dom.js';
export { refind };
import { render } from './render.js';

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
  if (opening) opener = document.activeElement;
  setHTML(drawer, html);
  drawer.setAttribute('aria-label', drawer.querySelector('.dhead .kind')?.textContent || 'Details');
  drawer.classList.add('on');
  settle();
  scrim.classList.add('on');
  /* callers may focus a field right after; only take focus if nothing inside has it */
  if (opening) requestAnimationFrame(() => { if (!drawer.contains(document.activeElement)) drawer.focus(); });
}

export function hideDrawer() {
  const wasOpen = drawer.classList.contains('on');
  drawer.classList.remove('on');
  settle();
  scrim.classList.remove('on');
  if (wasOpen) refind(opener)?.focus();
  opener = null;
}

/* A redraw may have replaced the opener; find its successor by what it points at. */

export function resetDrawerState() {
  ui.sel = null; ui.draft = null; ui.courseDraft = null; ui.courseMode = null; ui.confirm = null; ui.settings = false; ui.importPlan = null; ui.fillNote = null; ui.sessionDraft = null; ui.signoutAsk = null;
}

/** Run before the drawer closes, e.g. to save what is still being typed. */
export const beforeClose = new Set();

export function closeDrawer() {
  for (const fn of beforeClose) fn();
  resetDrawerState();
  ui.spotifyNote = null;
  ui.importNote = null;
  render();
  hideDrawer();
}

export function drawerHasFocus() {
  return drawer.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName);
}

/** Is any drawer open: an item, a course, settings or a study session. */
export const drawerOpen = () => !!(ui.sel || ui.draft || ui.courseDraft || ui.settings || ui.sessionDraft);

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
  btn.setAttribute('aria-expanded', String(open));
  if (open) side.querySelector('button, input')?.focus();
  else if (side.contains(document.activeElement)) btn.focus();
}
