// The study timer's views: the Study page's start panel and flow (drawn into the slot the
// React page leaves for them), the focus screen's clock side, and the corner clock. The
// run itself is focus.js; the page's tiles, history, achievements and leaderboard are
// React (src/components/study/).

import { setHTML, esc, $ } from '../dom.js';
import { ui } from '../state.js';
import { data, course, item } from '../store.js';
import { isOpen, normalizeFlow, normalizePrefs, FLOW_PRESETS } from '../model.js';
import { today } from '../dates.js';
import { minutesByDay } from '../history.js';
import * as focus from '../focus.js';
import { clockHtml, setClocks } from './flipclock.js';
import { setStudyBadge } from '../../../bridge.ts';
import { duration } from '../../../lib/time.ts';

const MIN = 60_000;
const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.6v10.8L13 8z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1"/></svg>',
  skip: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="11.2" y="3" width="2.2" height="10" rx=".8"/><path d="M2.5 3v10l8-5z"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
};

export { duration };

export const flow = () => normalizeFlow(data.profile?.studyFlow);
const flowMinutes = (f, kind) => f.steps.reduce((a, [k, m]) => a + (!kind || k === kind ? m : 0), 0) * f.rounds;

/** Minutes studied for one item, over every session linked to it. */
export const studiedFor = (itemId) => data.study_sessions.reduce((a, s) => a + (s.itemId === itemId ? s.studyMinutes : 0), 0);

/* ── what is being studied ── */

/** The course and item picked for the next run; a course is required. */
export function pick() {
  const courses = data.courses.filter((c) => !c.archived);
  if (!ui.study.courseId || !courses.some((c) => c.id === ui.study.courseId)) ui.study.courseId = courses[0]?.id || null;
  const items = openItems(ui.study.courseId);
  if (ui.study.itemId && !items.some((it) => it.id === ui.study.itemId)) ui.study.itemId = null;
  return { courses, items };
}
const openItems = (courseId) => data.items.filter((it) => it.courseId === courseId && isOpen(it)).sort((a, b) => a.date.localeCompare(b.date));

/* ── the round strip: every step of every round, in proportion ── */

function stripHtml(f, s) {
  let html = '';
  for (let r = 1; r <= f.rounds; r++) {
    html += '<span class="frnd">' + f.steps.map(([k, m], i) => {
      const past = s && (r < s.round || (r === s.round && i < s.index));
      const now = s && r === s.round && i === s.index;
      const pct = past ? 100 : now ? Math.round((1 - s.leftMs / s.stepMs) * 100) : 0;
      return '<span class="fseg ' + k + (now ? ' now' : '') + '" data-flex="' + m + '"><i data-width="' + pct + '"></i></span>';
    }).join('') + '</span>';
  }
  const round = s ? s.round : 1;
  const left = s ? Math.ceil(s.leftInFlowMs / MIN) : flowMinutes(f);
  return '<span class="fstrip" aria-hidden="true">' + html + '</span>'
    + '<span class="fstrip-lab"><span>Round ' + round + ' of ' + f.rounds + '</span><span>' + (s ? duration(left) + ' left' : duration(flowMinutes(f, 'study')) + ' study · ' + duration(left) + ' total') + '</span></span>';
}

function nextText(s) {
  const f = s.flow;
  let i = s.index + 1, r = s.round;
  if (i >= f.steps.length) { i = 0; r++; }
  if (r > f.rounds) return '<b>Last step</b> · the flow ends after this';
  const [k, m] = f.steps[i];
  return 'Next · <b>' + (k === 'study' ? 'Study' : 'Break') + ' ' + m + ' min</b>';
}

const phaseText = (s) => (s.kind === 'study' ? 'Study' : 'Break') + (s.paused ? ' · paused' : '');

/* ── the Study page's timer: the start panel and the flow, in the slot React leaves for
   them (#studyTimer, src/components/study/study-view.tsx) ── */

export function renderStudyTimer() {
  const root = $('studyTimer');
  if (!root) return;
  const f = flow(), { courses, items } = pick();
  const start = '<section class="panel study-start" data-phase="study">'
    + '<span class="phase-label">Ready</span>'
    + clockHtml('mid')
    + '<span class="strip-wrap">' + stripHtml(f, null) + '</span>'
    + (courses.length
      ? '<span class="study-pick">'
        + '<select id="studyCourse" aria-label="Course">' + courses.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === ui.study.courseId ? ' selected' : '') + '>' + esc(c.code + ' · ' + c.name) + '</option>').join('') + '</select>'
        + '<select id="studyItem" aria-label="Item (optional)"><option value="">No item</option>' + items.map((it) => '<option value="' + esc(it.id) + '"' + (it.id === ui.study.itemId ? ' selected' : '') + '>' + esc(it.title) + '</option>').join('') + '</select>'
        + '</span>'
        + '<button type="button" class="btn go" data-study-start>' + ICON.play + 'Start focus</button>'
        + '<span class="hint">Opens the focus screen: the clock and Spotify, nothing else.</span>'
      : '<span class="hint">Add a course first; study time is logged against one.</span><button type="button" class="btn" data-newcourse>Add a course</button>')
    + '</section>';
  setHTML(root, start + flowHtml(f));
  setClocks(root.querySelector('.study-start'), f.steps[0][1] * MIN, { animate: false });
}

function flowHtml(f) {
  const steps = f.steps.map(([k, m], i) => '<li class="step ' + k + '">'
    + '<span class="n">' + (i + 1) + '</span>'
    + '<button type="button" class="kind" data-study-kind="' + i + '" title="Switch between Study and Break">' + (k === 'study' ? 'Study' : 'Break') + '</button>'
    + '<label class="mins"><input type="number" inputmode="numeric" min="1" max="180" value="' + m + '" data-study-min="' + i + '" aria-label="Minutes for step ' + (i + 1) + '">min</label>'
    + '<button type="button" class="del" data-study-del="' + i + '" aria-label="Remove step ' + (i + 1) + '"' + (f.steps.length < 2 ? ' disabled' : '') + '>' + ICON.x + '</button>'
    + '</li>').join('');
  return '<section class="panel study-flow">'
    + '<div class="fhead"><h3>Your flow</h3><span>Tap Study or Break to switch it</span></div>'
    + '<ol class="fsteps">' + steps + '</ol>'
    + '<div class="adds">'
    + '<button type="button" class="add study" data-study-add="study"' + (f.steps.length >= 12 ? ' disabled' : '') + '>Add study</button>'
    + '<button type="button" class="add break" data-study-add="break"' + (f.steps.length >= 12 ? ' disabled' : '') + '>Add break</button></div>'
    + '<div class="reps"><label for="studyRounds">Repeat</label><input type="number" inputmode="numeric" id="studyRounds" min="1" max="12" value="' + f.rounds + '"><span>rounds</span>'
    + '<span class="sum">' + duration(flowMinutes(f, 'study')) + ' study · ' + duration(flowMinutes(f)) + ' total</span></div>'
    + '<div class="presets"><span>Quick start</span>' + FLOW_PRESETS.map(([name], i) => '<button type="button" data-study-preset="' + i + '">' + esc(name) + '</button>').join('') + '</div>'
    + '</section>';
}

/* ── what the focus screen and the corner clock share ── */

const NO_COURSE = '#7D8A99';
const colourOf = (id) => course(id)?.color || NO_COURSE;
export const prefs = () => normalizePrefs(data.profile?.studyPrefs);

/** A ring filling toward the goal: `part` of `whole`, drawn with SVG attributes (no inline style). */
function ringSvg(part, whole, cls = 'goal-ring') {
  const c = 2 * Math.PI * 34, f = whole ? Math.min(1, part / whole) : 0;
  return '<svg class="' + cls + '" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="track"/>'
    + '<circle cx="40" cy="40" r="34" class="fill" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg>';
}

/* ── the focus screen's clock side ── */

export function renderFocus() {
  const s = focus.read();
  const root = $('focusClock');
  if (!s || !root) return;
  const c = course(s.courseId), it = s.itemId ? item(s.itemId) : null;
  setHTML(root, '<div class="fx-top">'
    + '<button type="button" class="fx-leave" data-study-leave>' + ICON.back + 'Leave focus</button>'
    + '<span class="fx-chip"><i data-swatch="' + colourOf(s.courseId) + '"></i><b>' + esc(c ? c.code : 'No course') + '</b>' + (it ? ' · ' + esc(it.title) : '') + '</span>'
    + '</div>'
    + '<div class="fx-clock">'
    + '<span class="phase-label" data-study-phase></span>'
    + clockHtml('big')
    + '<span class="strip-wrap" data-study-strip></span>'
    + '<div class="fx-ctrls">'
    + '<button type="button" class="ghost" data-study-skip>' + ICON.skip + 'Skip step</button>'
    + '<button type="button" class="play" data-study-pause aria-label="Pause"></button>'
    + '<button type="button" class="ghost" data-study-stop>' + ICON.stop + 'Stop &amp; log</button>'
    + '</div>'
    + '<span class="fx-next" data-study-next></span>'
    + '</div>');
  paint(false);
}

/* ── per tick: the digits, the phase, the strip, the corner clock and the tab title ── */

/* Four ticks a second mostly draw what is already there: only a change is rebuilt. */
const drawn = new WeakMap();
function redraw(el, html) {
  if (drawn.get(el) === html) return;
  drawn.set(el, html);
  setHTML(el, html);
}

export function paint(animate = true) {
  const s = focus.read();
  const html = document.documentElement;
  if (!s) {
    delete html.dataset.phase;
    document.title = 'Rounds';
    const dock = $('studyDock'); if (dock) dock.hidden = true;
    return;
  }
  html.dataset.phase = s.kind;
  const text = setClocks(document, s.leftMs, { animate, running: !s.paused });
  document.title = text + ' · ' + (s.kind === 'study' ? 'Study' : 'Break');
  document.querySelectorAll('[data-study-phase]').forEach((el) => { el.textContent = phaseText(s); });
  document.querySelectorAll('[data-study-strip]').forEach((el) => redraw(el, stripHtml(s.flow, s)));
  document.querySelectorAll('[data-study-next]').forEach((el) => redraw(el, nextText(s)));
  document.querySelectorAll('[data-study-pause]').forEach((el) => {
    redraw(el, s.paused ? ICON.play : ICON.pause);
    el.setAttribute('aria-label', s.paused ? 'Resume' : 'Pause');
  });
  setStudyBadge(text);
  const dock = $('studyDock');
  if (dock) {
    dock.hidden = ui.focus;
    const goal = prefs().goal;
    if (!ui.focus && !dock.querySelector('.clock')) {
      setHTML(dock, clockHtml('mini') + '<span class="phase-label" data-study-phase>' + esc(phaseText(s)) + '</span>'
        + (goal ? '<span class="dock-ring" data-dock-ring></span>' : '')
        + '<button type="button" class="back" data-study-back>Focus</button>');
      setClocks(dock, s.leftMs, { animate: false, running: !s.paused });
    }
    /* today so far, with the study time of this run, filling toward the goal */
    const ring = dock.querySelector('[data-dock-ring]');
    if (ring && goal) {
      const mins = (minutesByDay(data.study_sessions).get(today()) || 0) + Math.floor(s.studyMs / MIN);
      if (ring.dataset.mins !== String(mins)) {
        ring.dataset.mins = String(mins);
        setHTML(ring, ringSvg(mins, goal, 'goal-ring mini'));
        ring.title = 'Today: ' + duration(mins) + ' of ' + duration(goal);
      }
    }
  }
}

/** The run ended: the Study tab's button goes back to its name, the dock empties. */
export function clearRun() {
  setStudyBadge(null);
  const dock = $('studyDock');
  if (dock) { dock.hidden = true; setHTML(dock, ''); }
  paint();
}
