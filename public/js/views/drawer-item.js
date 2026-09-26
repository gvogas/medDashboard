import { data, course, item, saveItem } from '../store.js';
import { ui } from '../state.js';
import { typeList, statusesFor, baseOf, tmeta, statusLabel, isOverdue, isOpen, isTest, uid, normalizeItem } from '../model.js';
import { parse, diffDays, today, hhmm, DOW } from '../dates.js';
import { activeCourses } from '../query.js';
import { esc, autoGrow } from '../dom.js';
import { CHECK_SVG } from './bits.js';
import { GRADABLE } from '../grades.js';
import { prepPace, prepLabel } from '../prep.js';
import { drawer, showDrawer, hideDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';
import { studiedFor, duration } from './study.js';

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
  if (!it) { hideDrawer(); return; }
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
    + '<span class="kind">' + (isNew ? 'New ' + m.label.toLowerCase() : esc(m.label)) + '</span>'
    + (isNew ? '' : (isOverdue(it) ? '<span class="chip overdue">Overdue</span>' : '<span class="chip st-' + it.status + '">' + esc(statusLabel(it)) + '</span>'))
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
        + '<button class="box" type="button" data-cl="' + esc(s.id) + '" aria-pressed="' + (s.done ? 'true' : 'false') + '" aria-label="Toggle step">' + CHECK_SVG + '</button>'
        + '<input class="tx" data-cltext="' + esc(s.id) + '" value="' + esc(s.text) + '" maxlength="140">'
        + '<button class="x" type="button" data-clx="' + esc(s.id) + '" aria-label="Remove step">✕</button></div>';
    });
    body += '</div>';
  }
  body += '<div class="addline"><input type="text" id="clAdd" placeholder="Add a step, press Enter" aria-label="Add a step" maxlength="140"></div></div>'
    + '<div class="dsec"><h4>Links</h4><div class="links">';
  (it.links || []).forEach((l, i) => {
    body += '<div class="linkrow"><span data-layout="ae860f94">↗</span><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label || l.url) + '</a>'
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
    foot = '<div class="dfoot"><span class="hint">Delete “' + esc(it.title || 'this item') + '”?</span>'
      + '<button class="btn ghost" type="button" data-act="keep">Keep</button>'
      + '<button class="btn danger" type="button" data-act="delete-yes">Delete</button></div>';
  } else {
    foot = '<div class="dfoot"><span class="hint">Edits save as you type</span>'
      + '<button class="btn ghost" type="button" data-act="delete">Delete</button>'
      + '<button class="btn" type="button" data-act="close">Done</button></div>';
  }

  showDrawer(head + body + foot);
  if (focusTitle) { const el = drawer.querySelector('.dtitle'); if (el) el.focus(); }
  autoGrow(drawer.querySelector('.dtitle'));
}
