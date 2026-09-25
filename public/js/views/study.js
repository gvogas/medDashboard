// The study timer's views: the Study tab (start, your flow, this week's log), the
// focus screen's clock side, and the corner clock. The run itself is focus.js.

import { setHTML, esc, $ } from '../dom.js';
import { ui } from '../state.js';
import { data, course, item } from '../store.js';
import { isOpen, normalizeFlow, FLOW_PRESETS } from '../model.js';
import { monday, addDays, iso, today, DOW, parse } from '../dates.js';
import * as focus from '../focus.js';
import { clockHtml, setClocks } from './flipclock.js';

const MIN = 60_000;
const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.6v10.8L13 8z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1"/></svg>',
  skip: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="11.2" y="3" width="2.2" height="10" rx=".8"/><path d="M2.5 3v10l8-5z"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
};

/** "2h 05m", "45m". */
export function duration(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
}

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

/* ── the Study tab ── */

export function renderStudy() {
  const f = flow(), { courses, items } = pick();
  const first = f.steps[0][1] * MIN;
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
  queueMicrotask(() => { const el = document.querySelector('.study-start'); if (el) setClocks(el, first, { animate: false }); });
  return '<div class="study">'
    + '<div class="study-col">' + start + flowHtml(f) + '</div>'
    + '<div class="study-col">' + logHtml() + '</div>'
    + '</div>';
}

function flowHtml(f) {
  const steps = f.steps.map(([k, m], i) => '<li class="step ' + k + '">'
    + '<span class="n">' + (i + 1) + '</span>'
    + '<button type="button" class="kind" data-study-kind="' + i + '" title="Switch between Study and Break">' + (k === 'study' ? 'Study' : 'Break') + '</button>'
    + '<label class="mins"><input type="number" inputmode="numeric" min="1" max="180" value="' + m + '" data-study-min="' + i + '" aria-label="Minutes for step ' + (i + 1) + '">min</label>'
    + '<button type="button" class="del" data-study-del="' + i + '" aria-label="Remove step ' + (i + 1) + '"' + (f.steps.length < 2 ? ' disabled' : '') + '>' + ICON.x + '</button>'
    + '</li>').join('');
  return '<section class="panel study-flow">'
    + '<div class="fhead"><h3>Your flow</h3><span>Tap a step to switch Study and Break</span></div>'
    + '<ol class="fsteps">' + steps + '</ol>'
    + '<div class="adds">'
    + '<button type="button" class="add study" data-study-add="study"' + (f.steps.length >= 12 ? ' disabled' : '') + '>Add study</button>'
    + '<button type="button" class="add break" data-study-add="break"' + (f.steps.length >= 12 ? ' disabled' : '') + '>Add break</button></div>'
    + '<div class="reps"><label for="studyRounds">Repeat</label><input type="number" inputmode="numeric" id="studyRounds" min="1" max="12" value="' + f.rounds + '"><span>rounds</span>'
    + '<span class="sum">' + duration(flowMinutes(f, 'study')) + ' study · ' + duration(flowMinutes(f)) + ' total</span></div>'
    + '<div class="presets"><span>Quick start</span>' + FLOW_PRESETS.map(([name], i) => '<button type="button" data-study-preset="' + i + '">' + esc(name) + '</button>').join('') + '</div>'
    + '</section>';
}

/** This week, Monday to Sunday: total, a bar per day stacked by course, minutes per course, recent sessions. */
export function weekLog(sessions, todayIso = today()) {
  const start = monday(parse(todayIso)), from = start.getTime(), to = addDays(start, 7).getTime();
  const week = sessions.filter((s) => s.startedAt >= from && s.startedAt < to);
  const days = Array.from({ length: 7 }, (_, i) => ({ date: iso(addDays(start, i)), byCourse: new Map(), total: 0 }));
  const perCourse = new Map();
  for (const s of week) {
    const day = days[Math.min(6, Math.floor((s.startedAt - from) / 86_400_000))];
    const key = s.courseId || '';
    day.byCourse.set(key, (day.byCourse.get(key) || 0) + s.studyMinutes);
    day.total += s.studyMinutes;
    perCourse.set(key, (perCourse.get(key) || 0) + s.studyMinutes);
  }
  return {
    total: week.reduce((a, s) => a + s.studyMinutes, 0),
    count: week.length,
    days,
    perCourse: [...perCourse].sort((a, b) => b[1] - a[1]),
    recent: [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8),
  };
}

const NO_COURSE = '#7D8A99';
const colourOf = (id) => course(id)?.color || NO_COURSE;
const courseName = (id) => { const c = course(id); return c ? c.code + ' · ' + c.name : 'No course'; };

function logHtml() {
  const log = weekLog(data.study_sessions);
  const max = Math.max(60, ...log.days.map((d) => d.total));
  const now = today();
  const bars = log.days.map((d) => '<span class="dbar" title="' + esc(duration(d.total)) + '">'
    + [...d.byCourse].map(([id, m]) => '<i data-swatch="' + colourOf(id) + '" data-height="' + (m / max * 100).toFixed(1) + '"></i>').join('') + '</span>').join('');
  const labels = log.days.map((d) => '<span' + (d.date === now ? ' class="today"' : '') + '>' + DOW[parse(d.date).getDay()] + '</span>').join('');
  const top = log.perCourse[0]?.[1] || 1;
  const courses = log.perCourse.map(([id, m]) => '<div class="cr"><span>' + esc(courseName(id || null)) + '</span><span class="mono">' + duration(m) + '</span>'
    + '<span class="cmeter"><i data-swatch="' + colourOf(id) + '" data-width="' + (m / top * 100).toFixed(1) + '"></i></span></div>').join('');
  const recent = log.recent.map((s) => {
    const it = s.itemId ? item(s.itemId) : null, d = new Date(s.startedAt);
    const when = DOW[d.getDay()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return '<div class="se"><span class="tag">' + duration(s.studyMinutes) + '</span>'
      + '<span class="what">' + esc(courseName(s.courseId)) + (it ? ' · ' + esc(it.title) : '') + (s.roundsDone ? ' · ' + s.roundsDone + ' round' + (s.roundsDone === 1 ? '' : 's') : '') + '</span>'
      + '<span class="tm mono">' + when + '</span>'
      + '<button type="button" class="del" data-study-sessdel="' + esc(s.id) + '" aria-label="Delete this session">' + ICON.x + '</button></div>';
  }).join('');
  return '<section class="panel study-log">'
    + '<h3>This week</h3>'
    + '<div class="tot"><b class="mono">' + duration(log.total) + '</b><span>studied in ' + log.count + ' session' + (log.count === 1 ? '' : 's') + '</span></div>'
    + '<div class="dbars" aria-hidden="true">' + bars + '</div><div class="blab">' + labels + '</div>'
    + (courses ? '<div class="crs">' + courses + '</div>' : '<p class="hint">Finished study time shows up here, by course.</p>')
    + (recent ? '<h3 class="recent-h">Recent sessions</h3><div class="sess">' + recent + '</div>' : '')
    + '</section>';
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
  document.querySelectorAll('[data-study-strip]').forEach((el) => setHTML(el, stripHtml(s.flow, s)));
  document.querySelectorAll('[data-study-next]').forEach((el) => setHTML(el, nextText(s)));
  document.querySelectorAll('[data-study-pause]').forEach((el) => {
    setHTML(el, s.paused ? ICON.play : ICON.pause);
    el.setAttribute('aria-label', s.paused ? 'Resume' : 'Pause');
  });
  const seg = document.querySelector('#viewSeg [data-view="study"]');
  if (seg) seg.textContent = 'Study · ' + text;
  const dock = $('studyDock');
  if (dock) {
    dock.hidden = ui.focus;
    if (!ui.focus && !dock.querySelector('.clock')) {
      setHTML(dock, clockHtml('mini') + '<span class="phase-label" data-study-phase>' + esc(phaseText(s)) + '</span>'
        + '<button type="button" class="back" data-study-back>Focus</button>');
      setClocks(dock, s.leftMs, { animate: false, running: !s.paused });
    }
  }
}

/** The run ended: the Study tab's button goes back to its name, the dock empties. */
export function clearRun() {
  const seg = document.querySelector('#viewSeg [data-view="study"]');
  if (seg) seg.textContent = 'Study';
  const dock = $('studyDock');
  if (dock) { dock.hidden = true; setHTML(dock, ''); }
  paint();
}
