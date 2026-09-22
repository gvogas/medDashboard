// The slide-in drawer and its scrim, shared by the item, course and settings panels.

import { ui } from '../state.js';
import { $ } from '../dom.js';
import { render } from './render.js';

export const drawer = $('drawer');
export const scrim = $('scrim');

export function showDrawer(html) {
  drawer.innerHTML = html;
  drawer.classList.add('on');
  drawer.setAttribute('aria-hidden', 'false');
  scrim.classList.add('on');
}

export function hideDrawer() {
  drawer.classList.remove('on');
  drawer.setAttribute('aria-hidden', 'true');
  scrim.classList.remove('on');
}

export function resetDrawerState() {
  ui.sel = null; ui.draft = null; ui.courseDraft = null; ui.courseMode = null; ui.confirm = null; ui.settings = false;
  ui.spotifyFlash = null;
}

export function closeDrawer() {
  resetDrawerState();
  hideDrawer();
  render();
}

export function drawerHasFocus() {
  return drawer.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName);
}
