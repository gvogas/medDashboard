// The study timer and history: the focus screen, study-session deletes that can be
// undone (item and course deletes wait the same way), the daily goal and the flow.

import * as store from './store.js';
import { data } from './store.js';
import { ui, rememberUi } from './state.js';
import { normalizeFlow, normalizePrefs, FLOW_PRESETS } from './model.js';
import { parse, today } from './dates.js';
import { $, esc } from './dom.js';
import { render, renderView } from './views/render.js';
import { drawerOpen } from './views/drawer-base.js';
import { openSession, editSession } from './views/drawer-session.js';
import { toast } from './views/toast.js';
import { openSettings, renderSettings } from './views/drawer-settings.js';
import { minutesByDay, streak } from './history.js';
import { achievements, ownAchievements } from './achievements.js';
import { launch as fireworks } from './fireworks.js';
import * as focus from './focus.js';
import { paint as paintStudy, clearRun, flow as studyFlow } from './views/study.js';

/* ═════════ the study timer ═════════ */
export function onFocusTick(s, event) {
  if (event === 'start') { ui.focus = true; render(); }
  else if (event === 'end') {
    ui.focus = false;
    ui.view = 'study'; rememberUi();
    clearRun();
    render();
    return;
  } else if (event === 'step' && s.kind === 'study' && !ui.focus && !drawerOpen()) {
    ui.focus = true;                       /* a new Study step pulls you back in */
    render();
  }
  paintStudy(event !== 'start');
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

/* ── the history: deletes that can be undone, a day picked on the heatmap, the goal ── */

/* A delete waits six seconds so Undo can take it back; the session is only hidden
   meanwhile. Another delete, or leaving the page, makes the waiting one final. */
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
function undoDelete() {
  const u = ui.hist.undo;
  if (!u) return;
  clearTimeout(u.timer);
  ui.hist.undo = null;
  renderView();
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

/** The heatmap: show that day's sessions, in its month. */
function showDay(day) {
  const d = parse(day), now = parse(today());
  ui.hist.range = 'month';
  ui.hist.monthOffset = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  ui.hist.focusDay = day;
  renderView();
  /* after this click has finished with the page */
  requestAnimationFrame(() => document.getElementById('hday-' + day)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

const studyPrefs = () => normalizePrefs(data.profile?.studyPrefs);
export async function savePrefs(patch) {
  await store.saveProfile({ studyPrefs: { ...studyPrefs(), ...patch } });
  if (ui.settings) renderSettings();
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
  const el = document.getElementById('ach-' + id);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

/* Every change to the flow saves it to the profile, so it follows you to other devices. */
async function saveFlow(next) {
  await store.saveProfile({ studyFlow: normalizeFlow(next) });
  renderView();
}

export async function studyClick(e) {
  let el;
  if (e.target.closest('[data-study-start]')) {
    if (!ui.study.courseId || focus.active()) return true;
    await focus.begin(studyFlow(), ui.study.courseId, ui.study.itemId);
    return true;
  }
  if (e.target.closest('[data-study-pause]')) { await focus.togglePause(); return true; }
  if (e.target.closest('[data-study-skip]')) { await focus.skip(); return true; }
  if (e.target.closest('[data-study-stop]')) { await focus.stop(); return true; }
  if (e.target.closest('[data-study-leave]')) { leaveFocus(); return true; }
  if (e.target.closest('[data-study-back]')) { openFocus(); return true; }
  if ((el = e.target.closest('[data-study-sessdel]'))) { deleteWithUndo(el.dataset.studySessdel); return true; }
  if (e.target.closest('[data-hist-undo]')) { undoDelete(); return true; }
  if ((el = e.target.closest('[data-hist-edit]'))) { openSession(el.dataset.histEdit); return true; }
  if (e.target.closest('[data-hist-log]')) { openSession(null); return true; }
  if (e.target.closest('[data-hist-goal]')) { openSettings('goalGrp'); return true; }
  if ((el = e.target.closest('[data-hist-week]'))) {
    const n = +el.dataset.histWeek;
    ui.hist.weekOffset = n ? Math.min(0, ui.hist.weekOffset + n) : 0;
    renderView(); return true;
  }
  if ((el = e.target.closest('[data-hist-range]'))) { ui.hist.range = el.dataset.histRange; ui.hist.focusDay = null; renderView(); return true; }
  if ((el = e.target.closest('[data-hist-month]'))) {
    ui.hist.monthOffset = Math.min(0, ui.hist.monthOffset + +el.dataset.histMonth);
    ui.hist.focusDay = null;
    renderView(); return true;
  }
  if ((el = e.target.closest('[data-hist-pick]'))) { ui.hist.focusDay = el.dataset.histPick; renderView(); document.querySelector('[data-hist-pick="' + el.dataset.histPick + '"]')?.focus(); return true; }
  if ((el = e.target.closest('[data-hist-day]'))) { showDay(el.dataset.histDay); return true; }
  if ((el = e.target.closest('[data-sd-mins]'))) { editSession('minutes', el.dataset.sdMins); $('sd-min').value = el.dataset.sdMins; return true; }
  if ((el = e.target.closest('[data-goal-step]'))) { const p = studyPrefs(); await savePrefs({ goal: Math.max(0, Math.min(720, p.goal + +el.dataset.goalStep)) }); return true; }
  if ((el = e.target.closest('[data-goal-set]'))) { await savePrefs({ goal: +el.dataset.goalSet }); return true; }
  if ((el = e.target.closest('[data-rest]'))) {
    const d = +el.dataset.rest, rest = studyPrefs().rest;
    await savePrefs({ rest: rest.includes(d) ? rest.filter((x) => x !== d) : rest.length < 6 ? [...rest, d] : rest });
    return true;
  }
  const f = studyFlow();
  if ((el = e.target.closest('[data-study-kind]'))) {
    const step = f.steps[+el.dataset.studyKind];
    if (step) step[0] = step[0] === 'study' ? 'break' : 'study';
    /* a flow needs a Study step: switching the only one is refused by normalizeFlow */
    if (f.steps.some(([k]) => k === 'study')) await saveFlow(f);
    return true;
  }
  if ((el = e.target.closest('[data-study-del]'))) {
    f.steps.splice(+el.dataset.studyDel, 1);
    if (f.steps.some(([k]) => k === 'study')) await saveFlow(f);
    return true;
  }
  if ((el = e.target.closest('[data-study-add]'))) {
    if (f.steps.length < 12) { f.steps.push([el.dataset.studyAdd, el.dataset.studyAdd === 'study' ? 25 : 5]); await saveFlow(f); }
    return true;
  }
  if ((el = e.target.closest('[data-study-preset]'))) {
    const preset = FLOW_PRESETS[+el.dataset.studyPreset];
    if (preset) await saveFlow(structuredClone(preset[1]));
    return true;
  }
  return false;
}

export async function studyChange(target) {
  if (target.id === 'studyCourse') { ui.study.courseId = target.value; ui.study.itemId = null; renderView(); return true; }
  if (target.id === 'studyItem') { ui.study.itemId = target.value || null; return true; }
  if (target.id === 'studyRounds' || target.dataset?.studyMin !== undefined) {
    const f = studyFlow();
    if (target.id === 'studyRounds') f.rounds = +target.value;
    else if (f.steps[+target.dataset.studyMin]) f.steps[+target.dataset.studyMin][1] = +target.value;
    await saveFlow(f);
    return true;
  }
  return false;
}
