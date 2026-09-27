// The page: sidebar, stats and whichever view is chosen. The top bar is React
// (src/components/top-bar.tsx); notify() tells it to redraw.

import { ui } from '../state.js';
import { $, keepFocus, setHTML } from '../dom.js';
import { renderStats } from './stats.js';
import { renderWeek } from './week.js';
import { renderMonth } from './month.js';
import { renderTable } from './table.js';
import { renderSpotifyInto } from './spotify-view.js';
import { renderStudy, renderFocus } from './study.js';
import { notify } from '../../../bridge.ts';

/* The focus screen is a layout of the page: the study clock beside the Spotify view. */
const showsSpotify = () => ui.focus || ui.view === 'spotify';

export function renderView() {
  keepFocus(drawView);
  notify();
}
function drawView() {
  const root = $('viewRoot'), focusing = ui.focus;
  document.documentElement.classList.toggle('focusing', focusing);
  $('focusClock').hidden = !focusing;
  $('stats').hidden = ui.view === 'spotify' || ui.view === 'study';
  if (focusing) renderFocus();
  root.className = focusing || ui.view === 'table' || ui.view === 'spotify' ? 'own-scroll' : '';   /* these scroll their own rows */
  root.dataset.view = focusing ? 'spotify' : ui.view;
  if (showsSpotify()) { renderSpotifyInto(root); return; }
  if (ui.view === 'study') { setHTML(root, renderStudy()); return; }
  setHTML(root, ui.view === 'week' ? renderWeek() : ui.view === 'month' ? renderMonth() : renderTable());
}

export function render() {
  keepFocus(() => {
    renderStats();
    drawView();
  });
  notify();
}
