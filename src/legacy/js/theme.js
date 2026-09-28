// The theme (light, dark or the system's) and the Med or CS background art; both are
// saved to the profile so they follow the account to other devices.

import * as store from './store.js';
import { data } from './store.js';
import { ui, rememberUi } from './state.js';
import { render } from './views/render.js';
import { notify } from '../../bridge.ts';
import { schedule as drawOrnament } from './ornament.js';

export function setTheme(choice, { persist = true } = {}) {
  ui.theme = choice === 'light' || choice === 'dark' ? choice : 'system';
  if (window.__roundsApplyTheme) window.__roundsApplyTheme(ui.theme);
  rememberUi();
  /* a failed save shows its own toast */
  if (persist && data.profile && data.profile.theme !== ui.theme) store.saveProfile({ theme: ui.theme }).catch(() => {});
  notify();                           /* Settings shows the choice */
  drawOrnament();                     /* the ornament layer is drawn in the theme's teal */
}
export function followSystem() { if (ui.theme === 'system') setTheme('system', { persist: false }); }

/* ═════════ background: Med or CS art, independent of light/dark ═════════ */
export function setBg(choice, { persist = true } = {}) {
  ui.bg = choice === 'cs' ? 'cs' : 'med';
  document.documentElement.setAttribute('data-bg', ui.bg);
  rememberUi();
  if (persist && data.profile && data.profile.bg !== ui.bg) store.saveProfile({ bg: ui.bg }).catch(() => {});
  if (data.profile) render();          /* the sidebar, stats and type lists change with it */
  notify();
  drawOrnament();
}
