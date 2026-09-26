import { setHTML } from '../dom.js';
// The page: header, sidebar, stats and whichever view is chosen.

import { ui } from '../state.js';
import { parse, addDays, monday, iso, DOW, MON } from '../dates.js';
import { schoolCal } from '../query.js';
import { weekOf } from '../school.js';
import { weekLabel } from './school-bits.js';
import { $, keepFocus } from '../dom.js';
import { renderSidebar } from './sidebar.js';
import { renderStats } from './stats.js';
import { renderWeek } from './week.js';
import { renderMonth } from './month.js';
import { renderTable } from './table.js';
import { renderSpotifyInto } from './spotify-view.js';
import { state as spotify } from '../spotify.js';
import { renderStudy, renderFocus } from './study.js';

export function renderHeader() {
  const a = parse(ui.anchor), t = $('viewTitle'), s = $('viewSub');
  if (ui.view === 'week') {
    const st = monday(a), en = addDays(st, 6);
    t.textContent = 'Week board';
    const school = weekLabel(weekOf(schoolCal(), iso(st)));
    s.textContent = DOW[st.getDay()] + ' ' + st.getDate() + ' ' + MON[st.getMonth()].slice(0, 3) + ' – ' + DOW[en.getDay()] + ' ' + en.getDate() + ' ' + MON[en.getMonth()].slice(0, 3) + ' ' + en.getFullYear()
      + (school ? ' · ' + school : '');
  } else if (ui.view === 'month') {
    t.textContent = MON[a.getMonth()] + ' ' + a.getFullYear();
    s.textContent = '';
  } else if (ui.view === 'study') {
    t.textContent = 'Study';
    s.textContent = '';
  } else if (ui.view === 'spotify') {
    t.textContent = 'Spotify';
    s.textContent = !spotify.loaded ? '' : !spotify.connected ? 'Not connected' : spotify.device ? 'Playing on ' + spotify.device : 'No active device';
  } else {
    t.textContent = 'All items';
    s.textContent = '';
  }
  const music = ui.view === 'spotify' || ui.view === 'study';
  document.querySelector('.navdate').hidden = music;
  $('stats').hidden = music;
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.view === ui.view ? 'true' : 'false');
  });
}

/* The focus screen is a layout of the page: the study clock beside the Spotify view. */
export const showsSpotify = () => ui.focus || ui.view === 'spotify';

export function renderView() {
  keepFocus(drawView);
}
function drawView() {
  const root = $('viewRoot'), focusing = ui.focus;
  document.documentElement.classList.toggle('focusing', focusing);
  $('focusClock').hidden = !focusing;
  if (focusing) renderFocus();
  root.className = focusing || ui.view === 'table' || ui.view === 'spotify' ? 'fixed' : '';   /* these scroll their own rows */
  root.dataset.view = focusing ? 'spotify' : ui.view;
  if (showsSpotify()) { renderSpotifyInto(root); return; }
  if (ui.view === 'study') { setHTML(root, renderStudy()); return; }
  setHTML(root, ui.view === 'week' ? renderWeek() : ui.view === 'month' ? renderMonth() : renderTable());
}

export function render() {
  keepFocus(() => {
    renderHeader();
    renderSidebar();
    renderStats();
    drawView();
  });
}
