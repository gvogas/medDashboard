// The views still drawn here: Study and the focus screen, in #viewRoot. The top bar, the
// stat tiles, the week, month and table and the Spotify page are React (src/components/);
// notify() tells them to redraw.

import { ui } from '../state.js';
import { $, keepFocus, setHTML } from '../dom.js';
import { renderSpotifyInto } from './spotify-view.js';
import { renderStudy, renderFocus } from './study.js';
import { notify } from '../../../bridge.ts';

/* The focus screen is a layout of the page: the study clock beside the legacy Spotify view
   (until the focus screen is React's; the Spotify page is components/spotify/). */

export function renderView() {
  keepFocus(drawView);
  notify();
}
function drawView() {
  const root = $('viewRoot'), focusing = ui.focus;
  document.documentElement.classList.toggle('focusing', focusing);
  $('focusClock').hidden = !focusing;
  /* the week, month, table and Spotify page are React's, in #views */
  const legacy = focusing || ui.view === 'study';
  root.hidden = !legacy;
  if (!legacy) { root.replaceChildren(); return; }
  if (focusing) renderFocus();
  root.className = focusing ? 'own-scroll' : '';   /* the focus screen's music scrolls its own rows */
  root.dataset.view = focusing ? 'spotify' : ui.view;
  if (focusing) { renderSpotifyInto(root); return; }
  setHTML(root, renderStudy());
}

/** Everything else on the page is React and redraws on notify(), so this is renderView. */
export const render = renderView;
