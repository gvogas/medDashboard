import { data, course, item, saveItem } from '../store.js';
import { ui } from '../state.js';
import { typeList, statusesFor, baseOf, tmeta, statusLabel, isOverdue, isOpen, isTest, isComplete, uid, normalizeItem, shiftEnd, classRoom, httpUrl } from '../model.js';
import { parse, diffDays, today, hhmm, DOW } from '../dates.js';
import { activeCourses } from '../query.js';
import { esc, autoGrow } from '../dom.js';
import { CHECK_SVG, confirmFoot } from './bits.js';
import { GRADABLE } from '../grades.js';
import { prepPace, prepLabel } from '../prep.js';
import { drawer, showDrawer, hideDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';
import { studiedFor, duration } from './study.js';
import { renderView } from './render.js';
import { renderSidebar } from './sidebar.js';
import { renderStats } from './stats.js';
import { parseTime } from '../timepicker.js';
import { nextReview } from '../reviews.js';
import { launch as fireworks } from '../fireworks.js';

export function openItem(id) {
  resetDrawerState();
  ui.sel = id;
  renderItemDrawer();
}

export function newItem(date, type) {
  resetDrawerState();
  ui.draft = normalizeItem({
    id: uid(), type: type || 'assignment', title: '', courseId: ui.course === 'all' ? null : ui.course,
    date: date || ui.anchor, status: 'todo',
  });
  renderItemDrawer(true);
}

/** The item being edited: the unsaved draft, or the selected stored item. */
export function current() {
  if (ui.draft) return ui.draft;
  const row = ui.sel ? item(ui.sel) : null;
  if (row && soon?.id === row.id) row[soon.field] = soon.value;   /* a reload must not undo typing */
  return row;
}

/** Save the new item and close the drawer; the row appears on the board. */
export async function saveDraft() {
  if (!ui.draft || !ui.draft.title.trim()) return;
  await saveItem(ui.draft);
  closeDrawer();
}

/** Persist an edit to a stored item. Drafts are kept in memory until saved. */
export async function touch(it) {
  if (ui.draft === it) return;
  if (soon?.id === it.id) { it[soon.field] = soon.value; clearTimeout(soon.timer); soon = null; }
  else await flushTouch();
  await saveItem(it);
}

/* Typing saves when it pauses, not on every key: each save rewrites the local database,
   reloads it and tells the other tabs. The typed value is held apart from the row, since
   a sync may reload the row in the meantime; leaving the field or the drawer saves at once. */
const TYPING_MS = 400;
let soon = null;   /* { id, field, value, after, timer } */

export function touchSoon(it, field, after) {
  if (ui.draft === it) return;
  if (soon && (soon.id !== it.id || soon.field !== field)) flushTouch();
  clearTimeout(soon?.timer);
  soon = { id: it.id, field, value: it[field], after, timer: setTimeout(flushTouch, TYPING_MS) };
}

export async function flushTouch() {
  const s = soon;
  soon = null;
  if (!s) return;
  clearTimeout(s.timer);
  const row = item(s.id);
  if (!row) return;
  row[s.field] = s.value;
  await saveItem(row);
  s.after?.();
}

export function renderItemDrawer(focusTitle) {
  const it = current();
  if (!it) { resetDrawerState(); hideDrawer(); return; }   /* gone, e.g. deleted on another device */
  const TODAY = today();
  const isNew = !!ui.draft, m = tmeta(it.type), sts = statusesFor(it.type);
  const typeOpts = typeList(ui.bg, data.items).filter((t) => t.id === it.type || !t.hidden)
    .map((t) => '<option value="' + t.id + '"' + (t.id === it.type ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('');
  const courseOpts = '<option value="">No course</option>' + activeCourses().map((c) =>
    '<option value="' + esc(c.id) + '"' + (c.id === it.courseId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  const stOpts = sts.map((p) => '<option value="' + p[0] + '"' + (p[0] === it.status ? ' selected' : '') + '>' + p[1] + '</option>').join('');
  const dd = diffDays(TODAY, it.date);
  const countdown = it.recur === 'weekly' ? 'every ' + DOW[it.weekday]
    : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : dd > 0 ? 'in ' + dd + ' days' : Math.abs(dd) + ' day' + (Math.abs(dd) === 1 ? '' : 's') + ' ago';
  const cl = it.checklist || [], clDone = cl.filter((x) => x.done).length;
  const c = course(it.courseId);
  let mtgLine = '';
  if (c && (c.meetings || []).length) {
    const next = c.meetings.slice().sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))[0];
    mtgLine = '<div data-layout="544c3831">' + esc(c.code) + ' meets ' + DOW[next.weekday] + ' ' + hhmm(next.start) + ' · ' + esc(next.room || 'room not set')
      + ' <button class="icon-btn" type="button" data-editcourse="' + esc(c.id) + '" data-layout="06525a50">Edit course</button></div>';
  }

  const prep = !isNew && isTest(it.type) && isOpen(it) ? prepPace(it, TODAY) : null;
  const canFill = !isNew && isTest(it.type) && c && (c.meetings || []).some((x) => x.kind === 'Lecture');

  const head = '<div class="dhead" data-accent="' + m.color + '">'
    + '<span class="kind">' + esc(isNew ? 'New ' + m.label.toLowerCase() : m.label) + '</span>'
    + (isNew ? '' : (isOverdue(it) ? '<span class="chip overdue">Overdue</span>' : '<span class="chip st-' + esc(it.status) + '">' + esc(statusLabel(it)) + '</span>'))
    + '<span data-layout="f7add123" class="mono">' + esc(countdown) + '</span>'
    + (prep ? '<span class="chip prep' + (prep.hot ? ' hot' : '') + '" title="Topics done · topics a day to finish before the exam">' + esc(prepLabel(prep)) + '</span>' : '')
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>';

  let body = '<div class="dbody">'
    + '<textarea class="dtitle" data-f="title" rows="1" maxlength="140" placeholder="' + (isNew ? 'What is it called?' : 'Untitled item') + '">' + esc(it.title) + '</textarea>'
    + mtgLine
    + '<div class="fields">'
      + '<label for="f-type">Type</label><select id="f-type" data-f="type">' + typeOpts + '</select>'
      + '<label for="f-course">Course</label><select id="f-course" data-f="courseId">' + courseOpts + '</select>'
      + '<label for="f-date">Date</label><input id="f-date" type="date" data-f="date" value="' + esc(it.date) + '">'
      + '<label for="f-start">Time</label><span class="pair"><input id="f-start" class="tp" type="text" inputmode="numeric" autocomplete="off" placeholder="--:--" data-f="start" value="' + esc(it.start || '') + '"><span>to</span><input class="tp" type="text" inputmode="numeric" autocomplete="off" placeholder="--:--" data-f="end" value="' + esc(it.end || '') + '" aria-label="End time"></span>'
      + '<label for="f-where">Room</label><input id="f-where" type="text" data-f="where" value="' + esc(it.where || '') + '" placeholder="Room, lab, platform" maxlength="80">'
      + '<label for="f-status">Status</label><select id="f-status" data-f="status">' + stOpts + '</select>'
      + (GRADABLE.includes(baseOf(it.type)) ? '<label for="f-weight">Weight</label><input id="f-weight" type="number" min="0" max="100" step="any" data-f="weight" value="' + (typeof it.weight === 'number' ? it.weight : '') + '" placeholder="% of course">' : '')
      + (studiedFor(it.id) ? '<span class="flabel">Studied</span><span class="studied mono">' + duration(studiedFor(it.id)) + '</span>' : '')
      + (it.status === 'graded' ? '<label for="f-grade">Grade</label><input id="f-grade" type="number" min="0" max="100" data-f="grade" value="' + (typeof it.grade === 'number' ? it.grade : '') + '" placeholder="%">' : '')
      + ((it.type === 'office' || it.type === 'tutoring')
          ? '<label for="f-recur">Repeats</label><span class="pair"><input id="f-recur" type="checkbox" data-f="recur" ' + (it.recur === 'weekly' ? 'checked' : '') + ' data-layout="d5cb2920"><span>every week on ' + DOW[it.recur === 'weekly' ? it.weekday : parse(it.date).getDay()] + '</span></span>'
            + (it.recur === 'weekly' ? '<label for="f-until">Until</label><input id="f-until" type="date" data-f="recurUntil" value="' + esc(it.recurUntil || '') + '">' : '')
            + (it.type === 'office' ? '<label for="f-dept">Dept</label><input id="f-dept" type="text" data-f="dept" value="' + esc(it.dept || '') + '" placeholder="Cardiology" maxlength="40">' : '')
          : '')
    + '</div>'
    + '<div class="dsec"><h4>Notes</h4><textarea class="notes" data-f="notes" maxlength="5000" placeholder="What to revise, what the lecturer said, page numbers.">' + esc(it.notes || '') + '</textarea></div>'
    + '<div class="dsec"><h4>' + (isTest(it.type) ? 'Topics' : 'Checklist') + (cl.length ? '<em>' + clDone + ' of ' + cl.length + ' done</em>' : '') + '</h4>'
    + (canFill ? '<button class="btn ghost fill-topics" type="button" data-act="fill-topics">Fill topics from lectures</button>' : '')
    + (ui.fillNote ? '<span class="dnote">' + esc(ui.fillNote) + '</span>' : '');
  if (cl.length) {
    body += '<div class="meterwrap"><span class="meter pink' + (clDone === cl.length ? ' full' : '') + '" data-width="' + Math.round(clDone / cl.length * 100) + '"></span></div><div class="cl">';
    cl.forEach((s) => {
      body += '<div class="cl-item' + (s.done ? ' done' : '') + '">'
        + '<button class="box" type="button" data-cl="' + esc(s.id) + '" aria-pressed="' + (s.done ? 'true' : 'false') + '" aria-label="Done: ' + esc(s.text || 'step') + '">' + CHECK_SVG + '</button>'
        + '<input class="tx" data-cltext="' + esc(s.id) + '" value="' + esc(s.text) + '" maxlength="140" aria-label="Step">'
        + '<button class="x" type="button" data-clx="' + esc(s.id) + '" aria-label="Remove step">✕</button></div>';
    });
    body += '</div>';
  }
  body += '<div class="addline"><input type="text" id="clAdd" placeholder="Add a step, press Enter" aria-label="Add a step" maxlength="140"></div></div>'
    + '<div class="dsec"><h4>Links</h4><div class="links">';
  (it.links || []).forEach((l, i) => {
    /* only a web link becomes a link: never a javascript: or data: URL, however it got here */
    body += '<div class="linkrow"><span data-layout="ae860f94">↗</span>'
      + (httpUrl(l.url) ? '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label || l.url) + '</a>' : '<span>' + esc(l.label || l.url) + '</span>')
      + '<button class="x" type="button" data-linkx="' + i + '" aria-label="Remove link">✕</button></div>';
  });
  body += '</div><div class="addline"><input type="text" id="linkLabel" placeholder="Label" aria-label="Link label" data-layout="798c9fe1" maxlength="60">'
    + '<input type="url" id="linkUrl" placeholder="https://…" aria-label="Link URL" maxlength="500"></div></div></div>';

  let foot;
  if (isNew) {
    foot = '<div class="dfoot"><span class="hint">' + (it.title.trim() ? 'Ready to save' : 'Give it a name to save') + '</span>'
      + '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>'
      + '<button class="btn" type="button" data-act="save"' + (it.title.trim() ? '' : ' disabled') + '>Save item</button></div>';
  } else if (ui.confirm === 'item') {
    foot = confirmFoot('Delete “' + (it.title || 'this item') + '”?', 'delete-yes');
  } else {
    foot = '<div class="dfoot"><span class="hint">Edits save as you type</span>'
      + '<button class="btn ghost" type="button" data-act="delete">Delete</button>'
      + '<button class="btn" type="button" data-act="close">Done</button></div>';
  }

  showDrawer(head + body + foot);
  if (focusTitle) { const el = drawer.querySelector('.dtitle'); if (el) el.focus(); }
  autoGrow(drawer.querySelector('.dtitle'));
}

let startBase = null;   /* the item's times when its start field took focus */
/** focusin: an item's start field keeps the times it had, so the end can follow it. */
export function noteStartBase(e) {
  if (e.target.dataset?.f !== 'start') return;
  const it = current();
  startBase = it ? { id: it.id, start: it.start, end: it.end } : null;
}

/* Some items name themselves from the course: office hours after the teacher, exams,
   quizzes and tutorials after the class. Picking a course (or switching type) fills the title in, unless
   the title was typed by hand. */
function autoTitleFor(type, c) {
  if (!c) return '';
  if (type === 'office') return c.instructor ? c.instructor + ' — office hours' : '';
  if (type === 'exam') return c.name ? 'Exam — ' + c.name : '';
  if (type === 'quiz') return c.name ? 'Quiz — ' + c.name : '';
  if (type === 'tutoring') return c.name ? c.name + ' — tutorial' : '';
  return '';
}
function autoTitle(it, prevCourseId) {
  const next = autoTitleFor(it.type, course(it.courseId));
  if (!next) return;
  const wasAuto = ['office', 'exam', 'quiz', 'tutoring'].some((t) => it.title === autoTitleFor(t, course(prevCourseId)) || it.title === autoTitleFor(t, course(it.courseId)));
  if (it.title.trim() && !wasAuto) return;
  it.title = next;
  const ta = drawer.querySelector('.dtitle');
  if (ta) { ta.value = next; autoGrow(ta); }
  if (ui.draft) {
    const b = drawer.querySelector('[data-act="save"]'), h = drawer.querySelector('.dfoot .hint');
    if (b) b.disabled = false;
    if (h) h.textContent = 'Ready to save';
  }
}

/* A small show from an element, for finishing something. */
export function celebrate(el) {
  const r = el.getBoundingClientRect();
  fireworks(r.left + r.width / 2, r.top + r.height / 2, { rockets: 2 });
}

export function setStatus(it, status) {
  it.status = status;
  it.completedAt = status === 'todo' ? null : (it.completedAt || Date.now());
}

/** A review step just finished: schedule the next one. */
export async function chainReview(it) {
  if (it.status !== 'done') return;
  const next = nextReview(it, today(), data.items);
  if (next) await saveItem(normalizeItem(next));
}

/** Typing in an item's fields (data-f): the item follows, and what is derived from it. */
export async function onItemInput(e, d) {
  const it = current(); if (!it) return;
  const ROOMED = d.f === 'date' || d.f === 'courseId' || d.f === 'type' || d.f === 'start';
  const roomWas = ROOMED ? classRoom(it, course(it.courseId)) : '';
  if (d.f === 'recur') {
    it.recur = e.target.checked ? 'weekly' : null;
    it.weekday = it.recur ? parse(it.date).getDay() : null;
    if (!it.recur) it.recurUntil = null;
  } else if (d.f === 'weight') {
    it.weight = e.target.value === '' || !(+e.target.value > 0) ? null : Math.min(100, +e.target.value);
  } else if (d.f === 'grade') {
    it.grade = e.target.value === '' ? null : Math.max(0, Math.min(100, +e.target.value));
  } else if (d.f === 'courseId' || d.f === 'recurUntil') {
    const before = it.courseId;
    it[d.f] = e.target.value || null;
    if (d.f === 'courseId') autoTitle(it, before);
  } else if (d.f === 'status') {
    const wasDone = isComplete(it);
    setStatus(it, e.target.value);
    if (!wasDone && isComplete(it)) celebrate(e.target);
  } else if (d.f === 'start' || d.f === 'end') {
    it[d.f] = parseTime(e.target.value) || '';      /* half-typed stays out of the model until it parses */
    if (d.f === 'start' && it.start && startBase?.id === it.id) {
      /* moving the start moves the end with it, measured from before this edit so
         half-typed times along the way do not stretch or shrink it */
      it.end = shiftEnd(startBase.start, startBase.end, it.start);
      const endBox = drawer.querySelector('[data-f="end"]');
      if (endBox) endBox.value = it.end;
    }
  } else {
    it[d.f] = e.target.value;
    if (d.f === 'date' && it.recur === 'weekly') it.weekday = parse(it.date).getDay();
    if (d.f === 'type') autoTitle(it, it.courseId);
    /* a status the new type does not have (Submitted on a Task) goes back to its first */
    if (d.f === 'type' && !statusesFor(it.type).some((x) => x[0] === it.status)) setStatus(it, 'todo');
  }
  if (ROOMED) {
    /* an exam or quiz on a class day is held in that class's room, unless one was typed */
    if (!it.where || it.where === roomWas) it.where = classRoom(it, course(it.courseId));
    const whereBox = drawer.querySelector('[data-f="where"]');
    if (whereBox && whereBox.value !== it.where) whereBox.value = it.where;
  }
  if (d.f === 'title') {
    autoGrow(e.target);
    if (ui.draft) {
      const b = drawer.querySelector('[data-act="save"]'), h = drawer.querySelector('.dfoot .hint');
      if (b) b.disabled = !it.title.trim();
      if (h) h.textContent = it.title.trim() ? 'Ready to save' : 'Give it a name to save';
    }
  }
  if (!ui.draft) {
    /* notes show nowhere on the board except through the search, so typing them redraws nothing */
    const redraw = () => { if (d.f !== 'notes' || ui.search) { renderStats(); renderSidebar(); renderView(); } };
    /* only plain text waits: other fields change what is derived from them (the end
       follows the start, the weekday the date), and those must save together */
    if (d.f === 'title' || d.f === 'notes' || d.f === 'where') touchSoon(it, d.f, redraw);
    else {
      await touch(it);
      if (d.f === 'status') await chainReview(it);
      redraw();
    }
  }
  if (d.f === 'type' || d.f === 'status' || d.f === 'recur') renderItemDrawer();
}
