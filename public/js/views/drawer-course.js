import { data, course, saveCourse, deleteCourse } from '../store.js';
import { ui } from '../state.js';
import { KINDS, PALETTE, HEXES, colourName, uid, normalizeCourse } from '../model.js';
import { dur, DOW } from '../dates.js';
import { esc, autoGrow } from '../dom.js';
import { drawer, showDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';

export function openCourse(id) {
  resetDrawerState();
  const c = course(id);
  ui.courseMode = c ? 'edit' : 'new';
  ui.courseDraft = c ? JSON.parse(JSON.stringify(c))
    : normalizeCourse({ id: uid(), code: '', name: '', color: HEXES[data.courses.length % HEXES.length], instructor: '', meetings: [] });
  renderCourseDrawer(true);
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
  if (!isNew && used) body += '<div class="warnline">' + used + ' item' + (used === 1 ? '' : 's') + ' ' + (used === 1 ? 'is' : 'are') + ' filed under this course. Deleting it leaves them without a course.</div>';
  body += '</div>';

  let foot;
  if (ui.confirm === 'course') {
    foot = '<div class="dfoot"><span class="hint">Delete ' + esc(c.name || 'this course') + '?</span>'
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

export async function saveCourseDraft() {
  const c = ui.courseDraft;
  if (!c || !c.name.trim()) return;
  if (!c.code.trim()) c.code = c.name.trim().slice(0, 4).toUpperCase();
  for (const m of c.meetings) if (m.end <= m.start) m.end = m.start < '23:00' ? String(+m.start.slice(0, 2) + 1).padStart(2, '0') + m.start.slice(2) : '23:59';
  await saveCourse(c);
  closeDrawer();
}

export async function deleteCourseDraft() {
  const cid = ui.courseDraft.id;
  await deleteCourse(cid);
  if (ui.course === cid) ui.course = 'all';
  closeDrawer();
}
