// The study timer's focus screen: its clock side, and the per-tick paint. The run itself is
// focus.js; the Study page (its timer cards too) and the corner dock are React
// (src/components/study/).

import { setHTML, esc, $ } from '../dom.js';
import { data, course, item } from '../store.js';
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
};

export { duration };

const flowMinutes = (f, kind) => f.steps.reduce((a, [k, m]) => a + (!kind || k === kind ? m : 0), 0) * f.rounds;

/** Minutes studied for one item, over every session linked to it. */
export const studiedFor = (itemId) => data.study_sessions.reduce((a, s) => a + (s.itemId === itemId ? s.studyMinutes : 0), 0);

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

/* ── the focus screen's clock side ── */

const NO_COURSE = '#7D8A99';
const colourOf = (id) => course(id)?.color || NO_COURSE;

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

/* ── per tick: the digits, the phase, the strip and the tab title ── */

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
}

/** The run ended: the Study tab's button goes back to its name. */
export function clearRun() {
  setStudyBadge(null);
  paint();
}
