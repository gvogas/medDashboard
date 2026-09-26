// The Log study / Edit session drawer: time studied away from the timer, typed in, or a
// logged session put right. Either way it counts toward the streak and the goal.

import { data, course, saveStudySession } from '../store.js';
import { ui } from '../state.js';
import { isOpen, uid } from '../model.js';
import { iso, today, parse } from '../dates.js';
import { esc, $, setHTML } from '../dom.js';
import { parseTime } from '../timepicker.js';
import { minutesByDay, streak } from '../history.js';
import { drawer, showDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';
import { duration, prefs } from './study.js';

export const QUICK = [15, 25, 30, 45, 60, 90];
const pad = (n) => String(n).padStart(2, '0');

/** Open the drawer: a session to edit by id, else a new one for now, on `courseId` when given. */
export function openSession(id, courseId) {
  resetDrawerState();
  const s = id ? data.study_sessions.find((x) => x.id === id) : null;
  const now = new Date();
  const courses = data.courses.filter((c) => !c.archived);
  const start = s ? new Date(s.startedAt) : new Date(now.getTime() - 30 * 60_000);
  ui.sessionDraft = {
    isNew: !s,
    base: s ? structuredClone(s) : null,
    id: s ? s.id : uid(),
    date: iso(start),
    time: pad(start.getHours()) + ':' + pad(start.getMinutes()),
    minutes: s ? s.studyMinutes : 30,
    courseId: s ? s.courseId : courseId || ui.study.courseId || courses[0]?.id || null,
    itemId: s ? s.itemId : null,
    note: s ? s.note || '' : '',
  };
  renderSessionDrawer(true);
}

/** When the typed day and time say the session started, in ms. */
export function startedAtOf(d) {
  const [y, m, day] = d.date.split('-').map(Number), [h, min] = (parseTime(d.time) || '09:00').split(':').map(Number);
  return new Date(y, m - 1, day, h, min).getTime();
}

const valid = (d) => Number.isInteger(d.minutes) && d.minutes >= 1 && d.minutes <= 720 && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date <= today() && !!parseTime(d.time);

function itemOptions(d) {
  const items = data.items.filter((it) => it.courseId === d.courseId && (isOpen(it) || it.id === d.itemId)).sort((a, b) => a.date.localeCompare(b.date));
  return '<option value="">Nothing in particular</option>' + items.map((it) => '<option value="' + esc(it.id) + '"' + (it.id === d.itemId ? ' selected' : '') + '>' + esc(it.title) + '</option>').join('');
}

/** What saving would do to today: the goal and the streak, in a line. */
function impact(d) {
  if (!valid(d)) return d.date > today() ? 'Pick a day up to today.' : 'Enter a day, a start time and 1 to 720 minutes.';
  const p = prefs();
  const others = data.study_sessions.filter((s) => s.id !== d.id);
  const before = minutesByDay(others);
  const after = new Map(before);
  after.set(d.date, (after.get(d.date) || 0) + d.minutes);
  const st = streak(after, today(), p);
  const was = streak(before, today(), p);
  const parts = [];
  if (d.date === today() && p.goal) parts.push('Today goes to ' + duration(after.get(d.date)) + ' of ' + duration(p.goal) + '.');
  else parts.push(parse(d.date).toDateString().slice(0, 10) + ' goes to ' + duration(after.get(d.date)) + '.');
  if (st.current > was.current) parts.push('Your streak goes to ' + st.current + ' day' + (st.current === 1 ? '' : 's') + '.');
  else if (st.current) parts.push('Your ' + st.current + '-day streak is safe.');
  return parts.join(' ');
}

export function renderSessionDrawer(focus) {
  const d = ui.sessionDraft;
  if (!d) return;
  const courses = data.courses.filter((c) => !c.archived || c.id === d.courseId);
  const head = '<div class="dhead" data-accent="' + (course(d.courseId)?.color || '#7D8A99') + '">'
    + '<span class="kind">' + (d.isNew ? 'Log study' : 'Edit session') + '</span>'
    + '<span data-layout="f7add123">' + (d.base && !d.base.manual ? 'recorded by the timer' : d.base ? 'logged by hand' : '') + '</span>'
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>';
  const body = '<div class="dbody sdraw">'
    + (d.isNew ? '<p class="lede">Time away from the timer: the library, Anki on your phone, a study group. It counts toward your streak and goal like a timer session.</p>' : '')
    + '<div class="fields">'
      + '<label for="sd-date">Day</label><input id="sd-date" type="date" data-sd="date" value="' + esc(d.date) + '" max="' + today() + '">'
      + '<label for="sd-time">Started</label><input id="sd-time" class="time tp" type="text" inputmode="numeric" autocomplete="off" placeholder="--:--" data-sd="time" value="' + esc(d.time) + '">'
      + '<label for="sd-min">How long</label><span class="pair"><input id="sd-min" type="number" inputmode="numeric" min="1" max="720" data-sd="minutes" value="' + d.minutes + '"><span>minutes</span></span>'
      + '<span></span><span class="quick" role="group" aria-label="Quick lengths">' + QUICK.map((m) => '<button type="button" data-sd-mins="' + m + '" aria-pressed="' + (d.minutes === m) + '">' + duration(m) + '</button>').join('') + '</span>'
      + '<label for="sd-course">Course</label><select id="sd-course" data-sd="courseId">'
        + (d.courseId && !course(d.courseId) ? '<option value="">No course</option>' : '')
        + courses.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === d.courseId ? ' selected' : '') + '>' + esc(c.code + ' · ' + c.name) + '</option>').join('') + '</select>'
      + '<label for="sd-item">For</label><select id="sd-item" data-sd="itemId">' + itemOptions(d) + '</select>'
    + '</div>'
    + '<div class="dsec"><h4>What you covered<em>optional</em></h4>'
    + '<textarea id="sd-note" rows="3" maxlength="200" data-sd="note" placeholder="Anki, 120 cards · chapters 3–4 · practice questions">' + esc(d.note) + '</textarea></div>'
    + '<p class="sd-hint" id="sdHint" role="status">' + esc(impact(d)) + '</p>'
    + '</div>';
  const foot = ui.confirm === 'session'
    ? '<div class="dfoot"><span class="hint">Delete this session?</span>'
      + '<button class="btn ghost" type="button" data-act="keep">Keep</button>'
      + '<button class="btn danger" type="button" data-act="session-delete-yes">Delete</button></div>'
    : '<div class="dfoot"><span class="hint">' + (valid(d) ? (d.isNew ? 'Ready to log' : 'Unsaved changes') : 'Not ready yet') + '</span>'
      + (d.isNew ? '' : '<button class="btn ghost" type="button" data-act="session-delete">Delete</button>')
      + '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>'
      + '<button class="btn go" type="button" data-act="session-save"' + (valid(d) ? '' : ' disabled') + '>' + (d.isNew ? 'Log ' + duration(d.minutes || 0) : 'Save') + '</button></div>';
  showDrawer(head + body + foot);
  if (focus) $('sd-min')?.focus();
}

/** Keep the footer and the line about today in step with what is typed, without a redraw. */
export function refreshSessionDrawer() {
  const d = ui.sessionDraft;
  if (!d) return;
  const hint = $('sdHint'); if (hint) hint.textContent = impact(d);
  const save = drawer.querySelector('[data-act="session-save"]');
  if (save) { save.disabled = !valid(d); save.textContent = d.isNew ? 'Log ' + duration(d.minutes || 0) : 'Save'; }
  const tip = drawer.querySelector('.dfoot .hint');
  if (tip && ui.confirm !== 'session') tip.textContent = valid(d) ? (d.isNew ? 'Ready to log' : 'Unsaved changes') : 'Not ready yet';
  drawer.querySelectorAll('[data-sd-mins]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.sdMins === d.minutes)));
}

/** A field of the drawer changed: `name` is its data-sd, `value` what it holds now. */
export function editSession(name, value) {
  const d = ui.sessionDraft;
  if (!d) return;
  if (name === 'minutes') d.minutes = value === '' ? 0 : Math.round(+value);
  else if (name === 'courseId') { d.courseId = value || null; d.itemId = null; const it = $('sd-item'); if (it) setHTML(it, itemOptions(d)); }
  else if (name === 'itemId') d.itemId = value || null;
  else if (name === 'time') d.time = parseTime(value) || value;
  else d[name] = value;
  refreshSessionDrawer();
}

export async function saveSessionDraft() {
  const d = ui.sessionDraft;
  if (!d || !valid(d)) return;
  await saveStudySession({
    ...(d.base || { roundsDone: 0, manual: true }),
    id: d.id, courseId: d.courseId, itemId: d.itemId, note: d.note.trim(),
    startedAt: startedAtOf(d), studyMinutes: d.minutes,
  });
  closeDrawer();
}
