// The import preview: what a .ics or CSV file would add, with a tick per row.
// Nothing is written until "Import"; see commitImport in main.js.

import { data, course, saveCourse, saveItem, saveProfile } from '../store.js';
import { ui } from '../state.js';
import { TYPES, ORDER, normalizeCourse, normalizeItem } from '../model.js';
import { DOW } from '../dates.js';
import { esc } from '../dom.js';
import { parseIcs } from '../importers/ics.js';
import { parseCsv } from '../importers/csv.js';
import { planImport, planOutline, planSummary } from '../importers/plan.js';
import { showDrawer, resetDrawerState } from './drawer-base.js';
import { shortDate } from '../reviews.js';

/** Parse a file's text and open the preview. Returns an error message, or '' on success. */
export function previewImport(text, name = '') {
  const isIcs = /BEGIN:VCALENDAR/i.test(text);
  let events;
  try { events = isIcs ? parseIcs(text) : parseCsv(text); }
  catch { return 'That file could not be read.'; }
  if (!events.length) return isIcs ? 'No events were found in that calendar.' : 'No rows were found. The first line must be a header such as type,course,title,date,start,end,room,weight.';
  const plan = planImport(events, data, isIcs ? 'ics' : 'csv');
  if (!plan.courses.length && !plan.items.length) return 'Nothing in that file could be imported.' + (plan.notes[0] ? ' ' + plan.notes[0] : '');
  resetDrawerState();
  ui.importPlan = { plan, name };
  renderImport();
  return '';
}

/** Open the preview for a course outline the Worker has read. */
export function previewOutline(outline, name) {
  const plan = planOutline(outline, data);
  resetDrawerState();
  ui.importPlan = { plan, name };
  renderImport();
}

export function renderImport() {
  const { plan, name } = ui.importPlan;
  const head = '<div class="dhead"><span class="kind">Import</span>'
    + '<span data-layout="f7add123" class="mono">' + esc(name || 'pasted text') + '</span>'
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>';

  let body = '<div class="dbody"><div class="imp-sum">' + esc(planSummary(plan)) + '</div>';
  const kept = plan.courses.find((c) => c.keep && c.isNew && (c.instructor || c.term));
  if (kept || plan.termStart) body += '<div class="dnote">' + esc([kept?.instructor, kept?.term, plan.termStart && !data.profile?.termStart ? 'term start ' + shortDate(plan.termStart) : ''].filter(Boolean).join(' · ')) + '</div>';
  if (plan.notes.length) body += '<div class="warnline">' + plan.notes.slice(0, 6).map(esc).join('<br>') + (plan.notes.length > 6 ? '<br>…and ' + (plan.notes.length - 6) + ' more.' : '') + '</div>';

  const groups = plan.courses.map((c) => ({ c, items: plan.items.map((it, i) => ({ it, i })).filter((x) => x.it.row.courseId === c.id) }));
  const loose = plan.items.map((it, i) => ({ it, i })).filter((x) => !x.it.row.courseId);
  for (const { c, items } of groups) {
    body += '<div class="dsec imp-group"><h4><i class="pip" data-accent="' + c.color + '"></i>' + esc(c.code) + ' · ' + esc(c.name)
      + (c.isNew ? '<em>new course</em>' : '') + '</h4>';
    for (const m of c.meetings) {
      body += '<label class="imp-row"><input type="checkbox" data-imp-m="' + esc(c.id) + ':' + esc(m.id) + '"' + (m.include ? ' checked' : '') + '>'
        + '<span class="imp-kind">' + esc(m.kind) + '</span><span>' + DOW[m.weekday] + ' ' + esc(m.start) + '–' + esc(m.end) + '</span>'
        + '<span class="imp-where">' + esc(m.room) + '</span></label>';
    }
    body += items.map(itemRow).join('') + '</div>';
  }
  if (loose.length) body += '<div class="dsec imp-group"><h4>No course</h4>' + loose.map(itemRow).join('') + '</div>';
  body += '</div>';

  const n = countTicked(plan) + plan.courses.filter((c) => c.keep && c.isNew).length;
  const foot = '<div class="dfoot"><span class="hint">Nothing is saved until you import</span>'
    + '<button class="btn ghost" type="button" data-act="import-cancel">Cancel</button>'
    + '<button class="btn" type="button" data-act="import-confirm"' + (n ? '' : ' disabled') + '>Import ' + n + '</button></div>';
  showDrawer(head + body + foot);
}

function itemRow({ it, i }) {
  const r = it.row;
  const types = ORDER.filter((t) => t !== 'project' || ui.bg === 'cs' || r.type === 'project')
    .map((t) => '<option value="' + t + '"' + (t === r.type ? ' selected' : '') + '>' + TYPES[t].label + '</option>').join('');
  return '<div class="imp-row' + (it.duplicate ? ' dup' : '') + '"><input type="checkbox" data-imp-i="' + i + '"' + (it.include ? ' checked' : '') + ' aria-label="Import ' + esc(r.title) + '">'
    + '<select data-imp-type="' + i + '" aria-label="Type">' + types + '</select>'
    + '<span class="imp-title">' + esc(r.title) + (it.duplicate ? ' <em>already there</em>' : '') + '</span>'
    + '<span class="imp-where">' + esc(shortDate(r.date)) + (r.start ? ' ' + esc(r.start) : '') + '</span></div>';
}

function countTicked(plan) {
  return plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length, 0) + plan.items.filter((i) => i.include).length;
}

/** Apply a tick or a type change from the preview. */
export function editImport(target) {
  const plan = ui.importPlan?.plan;
  if (!plan) return;
  const d = target.dataset;
  if (d.impM) {
    const [cid, mid] = d.impM.split(':');
    const m = plan.courses.find((c) => c.id === cid)?.meetings.find((x) => x.id === mid);
    if (m) m.include = target.checked;
  } else if (d.impI !== undefined) {
    plan.items[+d.impI].include = target.checked;
  } else if (d.impType !== undefined) {
    plan.items[+d.impType].row.type = target.value;
    return;                                   /* nothing on screen depends on it */
  }
  renderImport();
}

/** Write the ticked rows: courses first, so the items can point at them. Returns a summary line. */
export async function commitImport() {
  const plan = ui.importPlan?.plan;
  if (!plan) return '';
  let classes = 0, items = 0;
  const wanted = new Set(plan.items.filter((i) => i.include).map((i) => i.row.courseId).filter(Boolean));
  for (const c of plan.courses) {
    const add = c.meetings.filter((m) => m.include).map(({ include, ...m }) => m);
    if (!add.length && !(c.isNew && (c.keep || wanted.has(c.id)))) continue;
    if (c.isNew) {
      await saveCourse(normalizeCourse({ id: c.id, code: c.code, name: c.name, color: c.color, instructor: c.instructor || '', term: c.term || '', meetings: add }));
    } else {
      const live = course(c.id);
      if (!live) continue;
      await saveCourse({ ...live, meetings: [...live.meetings, ...add].slice(0, 12) });
    }
    classes += add.length;
  }
  for (const it of plan.items) {
    if (!it.include) continue;
    await saveItem(normalizeItem(it.row));
    items++;
  }
  /* An outline that states when teaching starts sets the term start, if none is set yet. */
  if (plan.termStart && data.profile && !data.profile.termStart) await saveProfile({ termStart: plan.termStart });
  ui.importPlan = null;
  return 'Imported ' + classes + ' class' + (classes === 1 ? '' : 'es') + ' and ' + items + ' item' + (items === 1 ? '' : 's') + '.';
}
