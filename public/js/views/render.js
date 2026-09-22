// The page: header, sidebar, stats and whichever view is chosen.

import { ui } from '../state.js';
import { parse, addDays, monday, DOW, MON } from '../dates.js';
import { $ } from '../dom.js';
import { renderSidebar } from './sidebar.js';
import { renderStats } from './stats.js';
import { renderWeek } from './week.js';
import { renderMonth } from './month.js';
import { renderTable } from './table.js';
import { renderSpotifyView } from './spotify-view.js';
import { state as spotify } from '../spotify.js';

function renderHeader() {
  const a = parse(ui.anchor), t = $('viewTitle'), s = $('viewSub');
  if (ui.view === 'week') {
    const st = monday(a), en = addDays(st, 6);
    t.textContent = 'Week board';
    s.textContent = DOW[st.getDay()] + ' ' + st.getDate() + ' ' + MON[st.getMonth()].slice(0, 3) + ' – ' + DOW[en.getDay()] + ' ' + en.getDate() + ' ' + MON[en.getMonth()].slice(0, 3) + ' ' + en.getFullYear();
  } else if (ui.view === 'month') {
    t.textContent = MON[a.getMonth()] + ' ' + a.getFullYear();
    s.textContent = '';
  } else if (ui.view === 'spotify') {
    t.textContent = 'Spotify';
    s.textContent = !spotify.loaded ? '' : !spotify.connected ? 'Not connected' : spotify.device ? 'Playing on ' + spotify.device : 'No active device';
  } else {
    t.textContent = 'All items';
    s.textContent = '';
  }
  const music = ui.view === 'spotify';
  document.querySelector('.navdate').hidden = music;
  $('stats').hidden = music;
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.view === ui.view ? 'true' : 'false');
  });
}

export function renderView() {
  const root = $('viewRoot');
  root.className = ui.view === 'table' || ui.view === 'spotify' ? 'fixed' : '';   /* these scroll their own rows */
  root.innerHTML = ui.view === 'week' ? renderWeek() : ui.view === 'month' ? renderMonth() : ui.view === 'spotify' ? renderSpotifyView() : renderTable();
}

export function render() {
  renderHeader();
  renderSidebar();
  renderStats();
  renderView();
}
