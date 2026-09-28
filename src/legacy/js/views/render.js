// The one view still drawn here: the focus screen, in #viewRoot. The top bar, the stat
// tiles, the week, month and table, the Study page and the Spotify page are React
// (src/components/); notify() tells them to redraw.

import { ui } from '../state.js';
import { $, keepFocus } from '../dom.js';
import { renderSpotifyInto } from './spotify-view.js';
import { renderFocus } from './study.js';
import { notify } from '../../../bridge.ts';

export function renderView() {
  keepFocus(drawView);
  notify();
}
function drawView() {
  const root = $('viewRoot'), focusing = ui.focus;
  document.documentElement.classList.toggle('focusing', focusing);
  $('focusClock').hidden = !focusing;
  /* The focus screen is a layout of the page: the study clock beside the legacy Spotify
     view (until the focus screen is React's; the Spotify page is components/spotify/). */
  root.hidden = !focusing;
  if (!focusing) { root.replaceChildren(); return; }
  renderFocus();
  root.className = 'own-scroll';   /* the focus screen's music scrolls its own rows */
  root.dataset.view = 'spotify';
  renderSpotifyInto(root);
}

/** Everything else on the page is React and redraws on notify(), so this is renderView. */
export const render = renderView;
