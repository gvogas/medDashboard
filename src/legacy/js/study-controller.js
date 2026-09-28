// The study timer: the focus screen, study-session deletes that wait for Undo
// (item and course deletes wait the same way), the daily goal, and the celebrations.
// The Study page's history, its Undo and the leaderboard are React (src/data/study.ts).

import * as store from './store.js';
import { data } from './store.js';
import { ui, rememberUi } from './state.js';
import { normalizePrefs } from './model.js';
import { today } from './dates.js';
import { esc } from './dom.js';
import { render, renderView } from './views/render.js';
import { getSheet } from '../../data/overlay.ts';
import { toast } from './views/toast.js';
import { minutesByDay, streak } from './history.js';
import { achievements, ownAchievements } from './achievements.js';
import { launch as fireworks } from './fireworks.js';
import * as focus from './focus.js';
import { paint as paintStudy, clearRun } from './views/study.js';

/* ═════════ the study timer ═════════ */
export function onFocusTick(s, event) {
  if (event === 'start') { ui.focus = true; render(); }
  else if (event === 'end') {
    ui.focus = false;
    ui.view = 'study'; rememberUi();
    clearRun();
    render();
    return;
  } else if (event === 'step' && s.kind === 'study' && !ui.focus && !getSheet()) {
    ui.focus = true;                       /* a new Study step pulls you back in */
    render();
  }
  paintStudy(event !== 'start');
}

/** Show a view: the dock and the 1–5 keys. Study while a run is going opens its focus screen. */
export function setView(view) {
  if (view === 'study' && focus.active()) { openFocus(); return; }
  ui.view = view; rememberUi(); render();
}

export function openFocus() {
  ui.focus = true;
  focus.fullscreen(true);
  render(); paintStudy(false);
}
export function leaveFocus() {
  ui.focus = false;
  focus.fullscreen(false);
  if (ui.view === 'study') { ui.view = 'week'; rememberUi(); }
  render(); paintStudy(false);
}

/* ── the history: deletes that can be undone, the goal ── */

/* A delete waits six seconds so Undo (the History card's, undoSessionDelete in
   src/data/study.ts) can take it back; the session is only hidden meanwhile. Another
   delete, or leaving the page, makes the waiting one final. */
const UNDO_MS = 6000;
export function deleteWithUndo(id) {
  const session = data.study_sessions.find((x) => x.id === id);
  if (!session) return;
  commitUndo();
  ui.hist.undo = { session, timer: setTimeout(commitUndo, UNDO_MS) };
  renderView();
}
export function commitUndo() {
  const u = ui.hist.undo;
  if (!u) return Promise.resolve();
  clearTimeout(u.timer);
  ui.hist.undo = null;
  /* a failed save already shows its own toast */
  return store.deleteStudySession(u.session.id).then(() => { if (ui.view === 'study') renderView(); }, () => {});
}

/* An item or course delete waits the same six seconds, the row hidden from every view
   meanwhile, so the toast's Undo only has to show it again. */
let doomed = null;   /* { key, commit, timer } */
export async function deleteLater(kind, id, what, commit) {
  /* a failed save already shows its own toast; it must not stop this delete */
  const settle = () => finishDelete().catch(() => {});
  await settle();
  const key = kind + ':' + id;
  doomed = { key, commit, timer: setTimeout(settle, UNDO_MS) };
  await store.hide(key);
  render();
  toast(what + ' deleted', { undo: undoLater, ms: UNDO_MS });
}
export async function finishDelete() {
  const d = doomed;
  if (!d) return;
  doomed = null;
  clearTimeout(d.timer);
  try { await d.commit(); } finally { await store.hide(d.key, false); }
}
async function undoLater() {
  const d = doomed;
  if (!d) return;
  doomed = null;
  clearTimeout(d.timer);
  await store.hide(d.key, false);
  render();
}

const studyPrefs = () => normalizePrefs(data.profile?.studyPrefs);
export async function savePrefs(patch) {
  await store.saveProfile({ studyPrefs: { ...studyPrefs(), ...patch } });
  renderView();
}

/* Fireworks when today's study crosses the goal, or the streak reaches a milestone,
   through something done on this device. The first look only records where it stands. */
let seen = null;
export function celebrateStudy() {
  const p = studyPrefs(), now = today(), byDay = minutesByDay(data.study_sessions);
  const mins = byDay.get(now) || 0, days = streak(byDay, now, p).current;
  const was = seen;
  seen = { day: now, mins, days };
  if (!was || was.day !== now || !p.celebrate) return;
  const goal = p.goal && was.mins < p.goal && mins >= p.goal;
  const milestone = days > was.days && [7, 30, 100, 365].includes(days);
  if (goal || milestone) fireworks(window.innerWidth / 2, window.innerHeight * 0.7, { rockets: milestone ? 6 : 4 });
}

/* A toast, and fireworks when celebrations are on, for each achievement newly earned.
   The first look, and anything synced from elsewhere, only records what is earned. */
let earned = null;
export function celebrateAchievements({ quiet = false } = {}) {
  const list = [...achievements(data.study_sessions, data.items, studyPrefs(), today()),
    ...ownAchievements(data.achievements, data.study_sessions, data.items, data.courses)];
  const was = earned;
  earned = new Set(list.filter((b) => b.earned).map((b) => b.id));
  if (!was || quiet) return;
  const fresh = list.filter((b) => b.earned && !was.has(b.id));
  if (!fresh.length) return;
  const b = fresh[0], more = fresh.length - 1;
  toast('Achievement unlocked: ' + b.name + (more ? ' and ' + more + ' more' : ''), {
    badge: b.sticker ? '<img class="stk" src="' + esc(b.sticker) + '" alt="" width="36" height="36">'
      : '<span class="md g-' + b.group + '" aria-hidden="true">' + esc(b.tier) + '</span>',
    label: 'See', undo: () => showAchievement(b.id), ms: 8000,
  });
  if (studyPrefs().celebrate) fireworks(window.innerWidth / 2, window.innerHeight * 0.7, { rockets: 5 });
}

function showAchievement(id) {
  if (ui.view !== 'study') { ui.view = 'study'; rememberUi(); render(); }
  /* the Study page is React's, drawn by the next frame when it was not showing */
  requestAnimationFrame(() => {
    const el = document.getElementById('ach-' + id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  });
}

/* The focus screen's buttons (the Study page's cards and the dock are React). */
export async function studyClick(e) {
  if (e.target.closest('[data-study-pause]')) { await focus.togglePause(); return true; }
  if (e.target.closest('[data-study-skip]')) { await focus.skip(); return true; }
  if (e.target.closest('[data-study-stop]')) { await focus.stop(); return true; }
  if (e.target.closest('[data-study-leave]')) { leaveFocus(); return true; }
  return false;
}
