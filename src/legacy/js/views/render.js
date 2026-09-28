// The views still drawn here: Spotify and the focus screen, in #viewRoot, and the Study
// page's start panel and flow, in the slot the React page leaves for them. The top bar,
// the stat tiles, the week, month and table and the rest of the Study page are React
// (src/components/); notify() tells them to redraw.

import { ui } from '../state.js';
import { $, keepFocus } from '../dom.js';
import { renderSpotifyInto } from './spotify-view.js';
import { renderStudyTimer, renderFocus } from './study.js';
import { notify } from '../../../bridge.ts';

export function renderView() {
  keepFocus(drawView);
  notify();
}
function drawView() {
  const root = $('viewRoot'), focusing = ui.focus;
  document.documentElement.classList.toggle('focusing', focusing);
  $('focusClock').hidden = !focusing;
  /* the Study page is React's, in #views; only its timer slot is drawn here */
  if (!focusing && ui.view === 'study') renderStudyTimer();
  /* The focus screen is a layout of the page: the study clock beside the Spotify view. */
  const legacy = focusing || ui.view === 'spotify';
  root.hidden = !legacy;
  if (!legacy) { root.replaceChildren(); return; }
  if (focusing) renderFocus();
  root.className = 'own-scroll';   /* the Spotify view scrolls its own rows */
  root.dataset.view = 'spotify';
  renderSpotifyInto(root);
}

/** Everything else on the page is React and redraws on notify(), so this is renderView. */
export const render = renderView;
