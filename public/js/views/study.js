// The study timer's views: the Study tab (start, your flow, and the history: streak,
// goal, the week, achievements, the leaderboard, the term's heatmap and every session), the
// focus screen's clock side, and the corner clock. The run itself is focus.js.

import { setHTML, esc, $ } from '../dom.js';
import { ui } from '../state.js';
import { data, course, item } from '../store.js';
import { isOpen, normalizeFlow, normalizePrefs, FLOW_PRESETS } from '../model.js';
import { addDays, iso, today, DOW, MON, parse, shortDate, dayMonth } from '../dates.js';
import { dayOf, minutesByDay, week, month, streak, heatRange, level } from '../history.js';
import { termStart } from '../query.js';
import * as focus from '../focus.js';
import { clockHtml, setClocks } from './flipclock.js';
import { achievementsHtml } from './achievements.js';
import { leaderboardHtml } from './leaderboard.js';
import { achievements, ownAchievements } from '../achievements.js';

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
  const all = shown(), byDay = minutesByDay(all), p = prefs();
  return '<div class="study">'
    + tilesHtml(all, byDay, p)
    + '<div class="study-col">' + start + flowHtml(f) + '</div>'
    + '<div class="study-col">' + weekHtml(all, p) + '</div>'
    + achievementsHtml(achievements(all, data.items, p, today()), ownAchievements(data.achievements, all, data.items, data.courses))
    + leaderboardHtml()
    + '<div class="st-wide">' + termHtml(all, byDay, p) + sessionsHtml(all) + '</div>'
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

/* ── the history: tiles, the week, the term, the sessions ── */

const NO_COURSE = '#7D8A99';
const colourOf = (id) => course(id)?.color || NO_COURSE;
const courseCode = (id) => course(id)?.code || 'No course';
export const prefs = () => normalizePrefs(data.profile?.studyPrefs);
/** Sessions shown: every one but a delete that can still be undone. */
const shown = () => data.study_sessions.filter((s) => s.id !== ui.hist.undo?.session.id);
const hm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
/** "14 – 20 Sep", or "28 Sep – 4 Oct" across two months. */
const range = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? parse(a).getDate() : dayMonth(a)) + ' – ' + dayMonth(b);

const FLAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1 2.6 2.3 3.1C11 8.5 11.3 5.5 12 3z"/></svg>';
const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
const PEN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const NEXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';

/** A ring filling toward the goal: `part` of `whole`, drawn with SVG attributes (no inline style). */
function ringSvg(part, whole, cls = 'ring') {
  const c = 2 * Math.PI * 34, f = whole ? Math.min(1, part / whole) : 0;
  return '<svg class="' + cls + '" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="track"/>'
    + '<circle cx="40" cy="40" r="34" class="fill" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg>';
}

function tilesHtml(all, byDay, p) {
  const now = today(), st = streak(byDay, now, p), todayMin = byDay.get(now) || 0;
  const hr = heatRange(termStart(), now);
  const term = all.filter((s) => { const d = dayOf(s); return d >= hr.from && d <= now; });
  const termMin = term.reduce((a, s) => a + s.studyMinutes, 0);
  const left = Math.max(0, p.goal - todayMin);
  return '<div class="st-tiles">'
    + '<div class="panel st-tile"><span class="ic flame">' + FLAME + '</span><span class="tx"><span class="lab">Streak</span>'
      + '<b>' + st.current + ' <small>day' + (st.current === 1 ? '' : 's') + '</small></b>'
      + '<span class="sub">Longest ' + st.longest + ' · a day counts from ' + p.dayMin + ' min' + (st.today || !st.current ? '' : ' · study today to keep it') + '</span></span></div>'
    + '<div class="panel st-tile">'
      + (p.goal ? ringSvg(todayMin, p.goal) + '' : '<span class="ic">' + CAL + '</span>')
      + '<span class="tx"><span class="lab">Today</span>'
      + '<b>' + duration(todayMin) + (p.goal ? ' <small>of ' + duration(p.goal) + '</small>' : '') + '</b>'
      + (p.goal ? '<span class="sub">' + (left ? left + ' min to your daily goal' : 'Daily goal reached') + '</span>'
        : '<button type="button" class="linkish" data-hist-goal>Set a daily goal</button>') + '</span></div>'
    + '<div class="panel st-tile"><span class="ic term">' + CAL + '</span><span class="tx"><span class="lab">' + (hr.since ? 'This term' : 'Last 12 weeks') + '</span>'
      + '<b>' + duration(termMin) + '</b>'
      + '<span class="sub">' + term.length + ' session' + (term.length === 1 ? '' : 's') + (hr.since ? ' since ' + dayMonth(hr.since) : '') + '</span></span></div>'
    + '</div>';
}

function courseBars(list) {
  const top = list[0]?.[1] || 1;
  return list.map(([id, m]) => '<div class="cr"><span class="cc"><i data-swatch="' + colourOf(id) + '"></i>' + esc(courseCode(id || null)) + '</span>'
    + '<span class="cmeter"><i data-swatch="' + colourOf(id) + '" data-width="' + (m / top * 100).toFixed(1) + '"></i></span>'
    + '<span class="mono">' + duration(m) + '</span></div>').join('');
}

function weekHtml(all, p) {
  const now = today(), anchor = iso(addDays(parse(now), 7 * ui.hist.weekOffset));
  const w = week(all, anchor), prev = week(all, iso(addDays(parse(anchor), -7)));
  const max = Math.max(60, p.goal ? p.goal * 1.25 : 0, ...w.days.map((d) => d.total));
  const bars = w.days.map((d) => '<span class="dbar' + (d.date > now ? ' future' : '') + '" title="' + esc(shortDate(d.date) + ' · ' + duration(d.total)) + '">'
    + d.byCourse.map(([id, m]) => '<i data-swatch="' + colourOf(id) + '" data-height="' + (m / max * 100).toFixed(1) + '"></i>').join('') + '</span>').join('');
  const labels = w.days.map((d) => '<span' + (d.date === now ? ' class="today"' : '') + '><b>' + DOW[parse(d.date).getDay()] + ' ' + parse(d.date).getDate() + '</b>'
    + (d.total ? duration(d.total) : '') + '</span>').join('');
  const diff = w.total - prev.total;
  const compare = !prev.total ? '' : ' · ' + (diff === 0 ? 'same as' : duration(Math.abs(diff)) + (diff > 0 ? ' more than' : ' less than')) + ' the week before';
  return '<section class="panel st-week">'
    + '<div class="st-head"><h3>Week</h3>'
    + '<button type="button" class="nav" data-hist-week="-1" aria-label="Previous week">' + ICON.back + '</button>'
    + '<span class="mono rng">' + range(w.from, w.to) + '</span>'
    + '<button type="button" class="nav" data-hist-week="1" aria-label="Next week"' + (ui.hist.weekOffset >= 0 ? ' disabled' : '') + '>' + NEXT + '</button>'
    + (ui.hist.weekOffset ? '<button type="button" class="chipbtn" data-hist-week="0">This week</button>' : '') + '</div>'
    + '<div class="tot"><b class="mono">' + duration(w.total) + '</b><span>in ' + w.count + ' session' + (w.count === 1 ? '' : 's') + compare + '</span></div>'
    + '<div class="dchart"><div class="dbars" aria-hidden="true">' + bars + '</div>'
    + (p.goal ? '<span class="goal-line" data-height="' + (p.goal / max * 100).toFixed(1) + '" aria-hidden="true"><em>' + duration(p.goal) + ' goal</em></span>' : '')
    + '</div><div class="blab">' + labels + '</div>'
    + (w.perCourse.length ? '<div class="crs">' + courseBars(w.perCourse) + '</div>' : '<p class="hint">Finished study time shows up here, by course.</p>')
    + '</section>';
}

function termHtml(all, byDay, p) {
  const now = today(), hr = heatRange(termStart(), now);
  const start = parse(hr.from);
  let months = '', cells = '';
  for (let w = 0; w < hr.weeks; w++) {
    const mon = addDays(start, w * 7);
    const first = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).find((d) => d.getDate() === 1);
    months += '<span>' + (first ? MON[first.getMonth()] : w === 0 ? MON[mon.getMonth()] : '').slice(0, 3) + '</span>';
    for (let i = 0; i < 7; i++) {
      const d = iso(addDays(mon, i)), m = byDay.get(d) || 0;
      cells += d > now ? '<span class="hc fut"></span>'
        : '<span class="hc l' + level(m, p.goal) + (d === now ? ' now' : '') + (d === ui.hist.focusDay ? ' pick' : '') + '" data-hist-day="' + d + '" title="' + esc(shortDate(d) + ' · ' + (m ? duration(m) : 'no study')) + '"></span>';
    }
  }
  const term = all.filter((s) => { const d = dayOf(s); return d >= hr.from && d <= now; });
  const per = [...term.reduce((m, s) => m.set(s.courseId || '', (m.get(s.courseId || '') || 0) + s.studyMinutes), new Map())].sort((a, b) => b[1] - a[1]);
  const days = [...byDay].filter(([d, m]) => d >= hr.from && d <= now && m).length;
  return '<section class="panel st-term">'
    + '<div class="st-head"><h3>' + (hr.since ? 'Term' : 'Last 12 weeks') + '</h3><span class="rng">' + dayMonth(hr.from) + ' – ' + dayMonth(hr.to) + '</span></div>'
    + '<p class="sr-only">Studied on ' + days + ' days in this range. The months view below lists every session.</p>'
    + '<div class="hmap" aria-hidden="true"><span class="dn"><i>Mon</i><i></i><i>Wed</i><i></i><i>Fri</i><i></i><i>Sun</i></span>'
    + '<span class="hgrid"><span class="hmon">' + months + '</span><span class="hcells">' + cells + '</span></span></div>'
    + '<div class="hleg"><span>Click a day to see its sessions</span><span class="sp"></span><span>Less</span>'
    + [0, 1, 2, 3, 4].map((l) => '<span class="hc l' + l + '"></span>').join('') + '<span>More</span></div>'
    + (per.length ? '<h3 class="sub-h">By course</h3><div class="crs">' + courseBars(per) + '</div>' : '')
    + '</section>';
}

function rowHtml(s, withDay) {
  const it = s.itemId ? item(s.itemId) : null;
  const note = s.note || (s.roundsDone ? s.roundsDone + ' round' + (s.roundsDone === 1 ? '' : 's') : '');
  return '<div class="se">'
    + '<span class="tm mono">' + (withDay ? DOW[new Date(s.startedAt).getDay()] + ' ' + new Date(s.startedAt).getDate() + ' · ' : '') + hm(s.startedAt) + '</span>'
    + '<span class="cchip"><i data-swatch="' + colourOf(s.courseId) + '"></i>' + esc(courseCode(s.courseId)) + '</span>'
    + '<span class="what"><b>' + esc(it ? it.title : course(s.courseId)?.name || 'No course') + '</b>' + (note ? '<em>' + esc(note) + '</em>' : '') + '</span>'
    + '<span class="mins mono">' + duration(s.studyMinutes) + '</span>'
    + '<span class="src' + (s.manual ? ' hand' : '') + '">' + (s.manual ? 'By hand' : 'Timer') + '</span>'
    + '<span class="acts"><button type="button" class="del" data-hist-edit="' + esc(s.id) + '" aria-label="Edit this session">' + PEN + '</button>'
    + '<button type="button" class="del" data-study-sessdel="' + esc(s.id) + '" aria-label="Delete this session">' + ICON.x + '</button></span></div>';
}

/* The month as a calendar: each day's total, split by course, tinted by how much, with a
   tick where the goal was met. The picked day's sessions sit under it. */
function monthHtml(m, at) {
  const p = prefs(), now = today(), byDate = new Map(m.groups.map((g) => [g.date, g]));
  const first = at, last = new Date(at.getFullYear(), at.getMonth() + 1, 0);
  const lastDay = iso(last) < now ? iso(last) : now;
  /* the day picked here or on the heatmap; else today in this month, else its latest study day */
  const ym = iso(first).slice(0, 7);
  const pick = (ui.hist.focusDay || '').startsWith(ym) ? ui.hist.focusDay : now.startsWith(ym) ? now : m.groups[0]?.date || null;
  const daysSoFar = iso(first) > now ? 0 : parse(lastDay).getDate();
  const avg = daysSoFar ? Math.round(m.total / daysSoFar) : 0;

  let cells = '';
  const lead = (first.getDay() + 6) % 7;                       /* Monday first */
  for (let i = 0; i < lead; i++) cells += '<span class="mc out"></span>';
  for (let d = 1; d <= last.getDate(); d++) {
    const date = iso(new Date(at.getFullYear(), at.getMonth(), d)), g = byDate.get(date);
    if (date > now) { cells += '<span class="mc fut"><span class="n">' + d + '</span></span>'; continue; }
    const mins = g?.total || 0, split = g ? [...g.sessions.reduce((acc, s) => acc.set(s.courseId || '', (acc.get(s.courseId || '') || 0) + s.studyMinutes), new Map())] : [];
    cells += '<button type="button" class="mc l' + level(mins, p.goal) + (date === now ? ' now' : '') + (date === pick ? ' pick' : '') + (p.goal && mins >= p.goal ? ' met' : '') + '"'
      + ' data-hist-pick="' + date + '" aria-pressed="' + (date === pick) + '" aria-label="' + esc(shortDate(date) + ', ' + (mins ? duration(mins) : 'no study')) + '">'
      + '<span class="n">' + d + '</span>' + (mins ? '<span class="t mono">' + duration(mins) + '</span>' : '')
      + (split.length ? '<span class="mbar">' + split.map(([id, v]) => '<i data-swatch="' + colourOf(id) + '" data-flex="' + v + '"></i>').join('') + '</span>' : '')
      + '</button>';
  }
  const g = pick ? byDate.get(pick) : null;
  const detail = !pick ? ''
    : '<div class="mday" id="hday-' + pick + '"><div class="mdh"><b' + (pick === now ? ' class="today"' : '') + '>' + shortDate(pick) + (pick === now ? ' · today' : '') + '</b>'
      + '<span class="mono">' + (g ? duration(g.total) + ' · ' + g.sessions.length + ' session' + (g.sessions.length === 1 ? '' : 's') : 'No study') + '</span></div>'
      + (g ? g.sessions.map((s) => rowHtml(s, false)).join('') : '<p class="hint">Nothing logged this day. <button type="button" class="linkish" data-hist-log>Log study</button></p>') + '</div>';
  const stat = (v, l) => '<span class="ms"><b class="mono">' + v + '</b><span>' + l + '</span></span>';
  return '<div class="mstats">'
      + stat(duration(m.total), 'studied') + stat(m.count, 'session' + (m.count === 1 ? '' : 's'))
      + stat(m.daysStudied + '<small>/' + daysSoFar + '</small>', 'days studied')
      + stat(duration(avg), 'a day on average') + '</div>'
    + '<div class="mcal" role="group" aria-label="' + MON[at.getMonth()] + ' ' + at.getFullYear() + '">'
    + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => '<span class="mh">' + d + '</span>').join('') + cells + '</div>'
    + detail;
}

function sessionsHtml(all) {
  const h = ui.hist, now = parse(today());
  let head, body;
  if (h.range === 'week') {
    const w = week(all, iso(addDays(now, 7 * h.weekOffset)));
    head = '<span class="rng">' + range(w.from, w.to) + ' · newest first</span>';
    body = w.sessions.length ? w.sessions.map((s) => rowHtml(s, true)).join('') : '<p class="hint">No study logged this week.</p>';
  } else {
    const at = new Date(now.getFullYear(), now.getMonth() + h.monthOffset, 1);
    const m = month(all, at.getFullYear(), at.getMonth());
    head = '<span class="histnav"><button type="button" class="nav" data-hist-month="-1" aria-label="Previous month">' + ICON.back + '</button>'
      + '<span class="mono rng">' + MON[at.getMonth()] + ' ' + at.getFullYear() + '</span>'
      + '<button type="button" class="nav" data-hist-month="1" aria-label="Next month"' + (h.monthOffset >= 0 ? ' disabled' : '') + '>' + NEXT + '</button></span>';
    body = monthHtml(m, at);
  }
  const u = h.undo;
  return '<section class="panel st-sess">'
    + '<div class="st-head"><h3>Sessions</h3>'
    + '<span class="seg" role="group" aria-label="Show sessions for">'
    + '<button type="button" data-hist-range="week" aria-pressed="' + (h.range === 'week') + '">Week</button>'
    + '<button type="button" data-hist-range="month" aria-pressed="' + (h.range === 'month') + '">Month</button></span>'
    + '<span class="sp"></span>' + head
    + '<button type="button" class="btn ghost logbtn" data-hist-log>' + PLUS + 'Log study</button></div>'
    + '<div class="sess">' + body + '</div>'
    + (u ? '<div class="undo" role="status"><span>Deleted <b>' + esc(courseCode(u.session.courseId)) + ' · ' + duration(u.session.studyMinutes) + '</b> from ' + shortDate(dayOf(u.session)) + '.</span>'
      + '<button type="button" data-hist-undo>Undo</button></div>' : '')
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
  const seg = document.querySelector('#viewSeg [data-view="study"]');
  if (seg) seg.textContent = 'Study · ' + text;
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
        setHTML(ring, ringSvg(mins, goal, 'ring mini'));
        ring.title = 'Today: ' + duration(mins) + ' of ' + duration(goal);
      }
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
