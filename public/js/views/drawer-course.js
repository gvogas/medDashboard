import { data, course, saveCourse } from '../store.js';
import { ui } from '../state.js';
import { KINDS, PALETTE, HEXES, colourName, uid, normalizeCourse } from '../model.js';
import { dur, DOW } from '../dates.js';
import { esc, autoGrow, setHTML } from '../dom.js';
import { courseGrade, neededLabel, targetsFor, ungraded } from '../grades.js';
import { drawer, showDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';
import { parseTime } from '../timepicker.js';

export function openCourse(id) {
  resetDrawerState();
  const c = course(id);
  ui.courseMode = c ? 'edit' : 'new';
  ui.whatIf = {};
  ui.courseDraft = c ? JSON.parse(JSON.stringify(c))
    : normalizeCourse({ id: uid(), code: '', name: '', color: HEXES[data.courses.length % HEXES.length], instructor: '', meetings: [] });
  renderCourseDrawer(true);
}

/** The draft holds edits not yet saved: it differs from the stored course, or, new, has anything in it. */
export function courseChanged() {
  const c = ui.courseDraft;
  if (!c) return false;
  if (ui.courseMode === 'new') return !!(c.name.trim() || c.code.trim() || (c.instructor || '').trim() || (c.meetings || []).length);
  const was = course(c.id);
  return !!was && JSON.stringify(normalizeCourse(c)) !== JSON.stringify(normalizeCourse(was));
}

export function renderCourseDrawer(focus) {
  const c = ui.courseDraft, isNew = ui.courseMode === 'new';
  let used = 0;
  data.items.forEach((it) => { if (it.courseId === c.id) used++; });
  const hrs = (c.meetings || []).reduce((s, m) => s + dur(m.start, m.end), 0);

  const head = '<div class="dhead" data-accent="' + c.color + '">'
    + '<span class="kind">' + (isNew ? 'New course' : 'Course') + '</span>'
    + '<span class="chip type" data-accent="' + c.color + '">' + esc(c.code || 'code') + '</span>'
    + '<span data-layout="f7add123" class="mono">' + (Math.round(hrs * 10) / 10) + ' h/week</span>'
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>';

  let body = '<div class="dbody">'
    + '<textarea class="dtitle" data-cf="name" rows="1" placeholder="Course name" maxlength="80">' + esc(c.name) + '</textarea>'
    + '<div class="fields">'
      + '<label for="c-code">Code</label><input id="c-code" type="text" data-cf="code" value="' + esc(c.code) + '" placeholder="CVS, ANAT…" maxlength="8">'
      + '<label for="c-inst">Teacher</label><input id="c-inst" type="text" data-cf="instructor" value="' + esc(c.instructor || '') + '" placeholder="Dr. Alvarez" maxlength="60">'
      + '<label for="c-term">Term</label><input id="c-term" type="text" data-cf="term" value="' + esc(c.term || '') + '" placeholder="2026 Autumn" maxlength="40">'
      + '<label>Colour</label><span class="swatchrow">'
      + PALETTE.map((p) =>
          '<button class="swatch" type="button" data-color="' + p.hex + '" aria-pressed="' + (p.hex === c.color ? 'true' : 'false')
            + '" data-accent="' + p.hex + '" title="' + p.name + '" aria-label="' + p.name + '"></button>').join('')
      + '</span>'
      + '<span class="swatchname">' + esc(colourName(c.color)) + '</span>'
      + (isNew ? '' : '<label for="c-arch">Archived</label><span class="pair"><input id="c-arch" type="checkbox" data-cf="archived" ' + (c.archived ? 'checked' : '') + ' data-layout="d5cb2920"><span>hidden from the sidebar, items kept</span></span>')
    + '</div>'
    + '<div class="dsec"><h4>Classes<em>time · room</em></h4><div class="mtglist">';
  if (!(c.meetings || []).length) body += '<div class="ttnone" data-layout="35eecf3e">No classes yet — add the first one below.</div>';
  (c.meetings || []).forEach((m) => {
    body += '<div class="mtg" data-mid="' + esc(m.id) + '"><div class="line">'
      + '<select class="kind" data-mf="kind" aria-label="Kind">'
        + KINDS.map((k) => '<option value="' + k + '"' + (k === m.kind ? ' selected' : '') + '>' + k + '</option>').join('')
      + '</select>'
      + '<select data-mf="weekday" aria-label="Day">'
        + [1, 2, 3, 4, 5, 6, 0].map((w) => '<option value="' + w + '"' + (w === m.weekday ? ' selected' : '') + '>' + DOW[w] + '</option>').join('')
      + '</select>'
      + '<input class="time tp" type="text" inputmode="numeric" autocomplete="off" placeholder="--:--" data-mf="start" value="' + esc(m.start) + '" aria-label="Start">'
      + '<input class="time tp" type="text" inputmode="numeric" autocomplete="off" placeholder="--:--" data-mf="end" value="' + esc(m.end) + '" aria-label="End">'
      + '<input class="room" type="text" data-mf="room" value="' + esc(m.room || '') + '" placeholder="Room number" aria-label="Room" maxlength="40">'
      + '</div><button class="x" type="button" data-mx="' + esc(m.id) + '" aria-label="Remove class">✕</button></div>';
  });
  body += '</div>' + ((c.meetings || []).length < 12 ? '<button class="btn ghost" type="button" data-act="addmtg" data-layout="0fd943ff">+ Add a class</button>' : '<span class="note">Twelve classes is the most a course can hold.</span>') + '</div>';
  if (!isNew) body += gradesSection(c, data.items.filter((it) => it.courseId === c.id));
  if (!isNew && used) body += '<div class="warnline">' + used + ' item' + (used === 1 ? '' : 's') + ' ' + (used === 1 ? 'is' : 'are') + ' filed under this course. Deleting it leaves them without a course.</div>';
  body += '</div>';

  let foot;
  if (ui.confirm === 'discard') {
    foot = '<div class="dfoot"><span class="hint" role="status">Discard your changes to ' + esc(c.name.trim() || 'this course') + '?</span>'
      + '<button class="btn ghost" type="button" data-act="keep">Keep editing</button>'
      + '<button class="btn danger" type="button" data-act="cancel">Discard</button></div>';
  } else if (ui.confirm === 'course') {
    foot = '<div class="dfoot"><span class="hint" role="status">Delete ' + esc(c.name || 'this course') + '?</span>'
      + '<button class="btn ghost" type="button" data-act="keep">Keep</button>'
      + '<button class="btn danger" type="button" data-act="course-delete-yes">Delete</button></div>';
  } else {
    foot = '<div class="dfoot"><span class="hint">' + (c.name.trim() ? (isNew ? 'Ready to save' : 'Unsaved changes') : 'Give it a name to save') + '</span>'
      + (isNew ? '' : '<button class="btn ghost" type="button" data-act="course-delete">Delete</button>')
      + '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>'
      + '<button class="btn" type="button" data-act="course-save"' + (c.name.trim() ? '' : ' disabled') + '>Save course</button></div>';
  }

  showDrawer(head + body + foot);
  if (focus) { const el = drawer.querySelector('.dtitle'); if (el) el.focus(); }
  autoGrow(drawer.querySelector('.dtitle'));
}

/* Weighted grade so far, how much of the course it covers, what the rest needs to reach
   50, 60, 70 or the course's own target, and what-if scores for what is still to come. */
function gradesSection(c, items) {
  const g = courseGrade(items);
  if (!g.total) return '';
  const open = ungraded(items).sort((a, b) => a.date.localeCompare(b.date));
  let html = '<div class="dsec grades"><h4>Grades<em>' + g.graded + ' of ' + g.total + '% graded</em></h4>'
    + '<div id="gradeOut">' + gradeOut(c, items) + '</div>'
    + '<div class="grade-target"><label for="c-target">Your target</label>'
    + '<input id="c-target" type="number" inputmode="numeric" min="1" max="100" step="1" data-cf="target" value="' + (c.target ?? '') + '" placeholder="e.g. 75">'
    + '<span>% final grade</span></div>';
  if (open.length) {
    const guessed = open.some((it) => typeof ui.whatIf?.[it.id] === 'number');
    html += '<details class="whatif"' + (guessed ? ' open' : '') + '><summary>What if…</summary><div class="wi-list">'
      + open.map((it) =>
          '<label class="wi-row"><span class="wi-t">' + esc(it.title) + '</span><em>' + it.weight + '%</em>'
          + '<input type="number" inputmode="decimal" min="0" max="100" step="any" data-whatif="' + esc(it.id) + '" value="' + (ui.whatIf?.[it.id] ?? '') + '" placeholder="score" aria-label="If I get this score on ' + esc(it.title) + '"></label>').join('')
      + '</div><span class="dnote">Scores you might get. Not saved; they clear when you close the course.</span></details>';
  }
  if (g.total !== 100) html += '<div class="warnline">Weights add up to ' + g.total + '%, not 100.</div>';
  return html + '</div>';
}

function gradeOut(c, items) {
  const real = courseGrade(items), guesses = ui.whatIf || {};
  const guessed = ungraded(items).some((it) => typeof guesses[it.id] === 'number');
  const g = guessed ? courseGrade(items, guesses) : real;
  let html = '<div class="grade-now"><b>' + (real.current === null ? '—' : real.current + '%') + '</b><span>current weighted average</span></div>';
  if (guessed) {
    const final = g.remaining <= 0;
    html += '<div class="grade-now proj"><b>' + g.current + '%</b><span>' + (final ? 'your final grade with these scores' : 'with your what-if scores') + '</span></div>';
  }
  html += '<div class="meterwrap"><span class="meter" data-width="' + Math.round(real.graded / Math.max(100, real.total) * 100) + '"></span></div>';
  if (g.remaining > 0) {
    const ts = targetsFor(c.target);
    html += '<div class="grade-need">' + ts.map((t) => {
      const label = neededLabel(g.needed(t));
      return '<span class="' + (label === 'secured' ? 'ok' : label === 'out of reach' ? 'bad' : '') + (t === c.target ? ' mine' : '') + '">'
        + '<em>' + (t === c.target ? 'Target ' + t : t) + '</em>' + esc(label) + '</span>';
    }).join('') + '</div><span class="dnote">What you need on the ' + (guessed ? 'other ' : 'remaining ') + g.remaining + '% to finish at '
      + ts.slice(0, -1).join(', ') + ' or ' + ts.at(-1) + '.</span>';
  } else if (c.target && g.current !== null) {
    html += '<span class="dnote ' + (g.current >= c.target ? 'ok' : 'bad') + '">' + (g.current >= c.target ? 'At or above' : 'Below') + ' your target of ' + c.target + '%.</span>';
  }
  return html;
}

/** Redraw the numbers only, so the target and what-if fields keep focus while typing. */
export function refreshGrades() {
  const out = drawer.querySelector('#gradeOut'), c = ui.courseDraft;
  if (out && c) setHTML(out, gradeOut(c, data.items.filter((it) => it.courseId === c.id)));
}

export async function saveCourseDraft() {
  const c = ui.courseDraft;
  if (!c || !c.name.trim()) return;
  if (!c.code.trim()) c.code = c.name.trim().slice(0, 4).toUpperCase();
  for (const m of c.meetings) if (m.end <= m.start) m.end = m.start < '23:00' ? String(+m.start.slice(0, 2) + 1).padStart(2, '0') + m.start.slice(2) : '23:59';
  await saveCourse(c);
  closeDrawer();
}

/** Close the drawer from ✕, Escape or the scrim. A course with unsaved edits asks
   first; asked, a second Escape or click discards them. */
export function leaveDrawer() {
  if (ui.courseDraft && ui.confirm !== 'discard' && courseChanged()) {
    ui.confirm = 'discard';
    renderCourseDrawer();
    drawer.querySelector('[data-act="keep"]')?.focus();
    return;
  }
  closeDrawer();
}

/** Typing in the course drawer: its fields, class meetings and what-if scores. True if it was one of them. */
export function onCourseInput(e, d) {
  if ('whatif' in d && ui.courseDraft) {  /* a what-if score, never saved */
    const v = e.target.value.trim() === '' ? NaN : +e.target.value;
    if (Number.isFinite(v) && v >= 0 && v <= 100) ui.whatIf[d.whatif] = v; else delete ui.whatIf[d.whatif];
    refreshGrades(); return true;
  }
  if (d.cf && ui.courseDraft) {           /* course fields */
    const n = Math.round(+e.target.value);
    ui.courseDraft[d.cf] = d.cf === 'archived' ? e.target.checked
      : d.cf === 'target' ? (e.target.value.trim() !== '' && n >= 1 && n <= 100 ? n : null)
      : e.target.value;
    if (d.cf === 'target') refreshGrades();
    if (d.cf === 'name') autoGrow(e.target);
    const hint = drawer.querySelector('.dfoot .hint'), btn = drawer.querySelector('[data-act="course-save"]');
    if (btn) btn.disabled = !ui.courseDraft.name.trim();
    if (hint) hint.textContent = ui.courseDraft.name.trim() ? (ui.courseMode === 'new' ? 'Ready to save' : 'Unsaved changes') : 'Give it a name to save';
    return true;
  }
  if (d.mf && ui.courseDraft) {           /* class meeting fields */
    const wrap = e.target.closest('[data-mid]'); if (!wrap) return true;
    ui.courseDraft.meetings.forEach((m) => {
      if (m.id !== wrap.dataset.mid) return;
      m[d.mf] = d.mf === 'weekday' ? +e.target.value
        : d.mf === 'start' || d.mf === 'end' ? (parseTime(e.target.value) || m[d.mf])
        : e.target.value;
    });
    return true;
  }
  return false;
}
