// The school calendar: reading one from a PDF with AI, the drawer to check and fix it
// (semesters and special days), and its group in Settings. It is saved on the profile;
// public/js/school.js says what each day is.

import { data, saveProfile } from '../store.js';
import { ui } from '../state.js';
import { api, ApiError } from '../api.js';
import { pdfText } from '../pdftext.js';
import { today, DOW } from '../dates.js';
import { esc, $, keepFocus } from '../dom.js';
import { shortDate } from '../reviews.js';
import { normalizeSchool, validDate, weekOf, schoolStatus, KIND_LABELS, SCHOOL_KINDS, SCHOOL_LIMITS } from '../school.js';
import { schoolCal } from '../query.js';
import { drawer, showDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';
import { showBusy, hideBusy } from './busy.js';
import { toast } from './toast.js';
import { renderSettings } from './drawer-settings.js';
import { render } from './render.js';

const ERRORS = {
  outline_empty: 'No text was found in that file. A scanned calendar needs to be a text PDF.',
  school_unreadable: 'No semesters could be found in that calendar. Try again, or check it is the academic calendar.',
  outline_unavailable: 'The calendar reader is not available right now. Try again later.',
  outline_limit: 'That is the limit of 10 AI reads for today (outlines and calendars). Try again tomorrow.',
  outline_quota: 'The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).',
  too_large: 'That file is over 5 MB.',
};

/* ── Settings ── */

/** The School calendar group, on the Study tab of Settings. */
export function schoolGroup() {
  const cal = schoolCal();
  const pick = (label) => '<label class="btn ghost filepick' + (ui.schoolBusy ? ' busy' : '') + '">' + (ui.schoolBusy ? 'Reading calendar…' : label)
    + '<input type="file" id="schoolFile" accept=".pdf,.docx,.txt,.html,application/pdf"' + (ui.schoolBusy ? ' disabled' : '') + '></label>';
  let html = '<div class="setgrp" id="schoolGrp" tabindex="-1"><h4>School calendar<em>' + (cal ? 'on' : 'off') + '</em></h4>';
  if (!cal) {
    html += '<span class="note">Upload your school’s academic calendar (PDF). Rounds marks days off, breaks and exams, skips classes when there are none, and numbers your weeks.</span>'
      + '<span data-layout="ed524873">' + pick('Upload calendar…') + '</span>';
  } else if (ui.schoolAsk) {
    html += '<span class="note">Remove the school calendar? Classes show every week again, and the term start goes back to the one you had.</span>'
      + '<span data-layout="ed524873"><button class="btn ghost" type="button" data-school="keep">Keep</button>'
      + '<button class="btn danger" type="button" data-school="remove-yes">Remove</button></span>';
  } else {
    html += '<span class="school-now"><b>' + esc(cal.name || 'Your school') + '</b><span>' + esc(schoolStatus(cal, today(), shortDate)) + ' · '
      + cal.terms.length + ' semester' + (cal.terms.length === 1 ? '' : 's') + ', ' + cal.days.length + ' special day' + (cal.days.length === 1 ? '' : 's') + '</span></span>'
      + '<span data-layout="ed524873"><button class="btn ghost" type="button" data-school="review">Review dates</button>' + pick('Replace…')
      + '<button class="btn ghost" type="button" data-school="remove">Remove</button></span>';
  }
  if (ui.schoolNote) html += '<span class="note' + (ui.schoolNote.error ? ' err' : '') + '">' + esc(ui.schoolNote.text) + '</span>';
  return html + '</div>';
}

/** A calendar file was picked: read it with AI, then open the drawer to check it. */
export async function readSchoolFile(file) {
  if (file.size > 5 * 1024 * 1024) { ui.schoolNote = { text: ERRORS.too_large, error: true }; renderSettings(); return; }
  ui.schoolBusy = true; ui.schoolNote = null; renderSettings();
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) showBusy(file.name, 'Pulling the text out of the PDF…');
    const body = isPdf ? new Blob([await pdfText(file)], { type: 'text/plain' }) : file;
    showBusy(file.name, 'Finding the semesters, breaks and days off with AI…');
    const read = await api.readSchool(body, { name: file.name, today: today() });
    ui.schoolBusy = false; hideBusy();
    openSchool(read, file.name);
  } catch (err) {
    ui.schoolBusy = false; hideBusy();
    const code = err instanceof ApiError ? err.body?.error : null;
    ui.schoolNote = { text: ERRORS[code] || (err instanceof ApiError ? 'The calendar could not be read (' + (code || err.status) + ').' : 'You seem to be offline. Reading a calendar needs a connection.'), error: true };
    if (ui.settings) renderSettings();
  }
}

/* ── the drawer ── */

/** Open the drawer on a calendar just read (with its file name), or on the saved one. */
export function openSchool(read, source = null) {
  const cal = normalizeSchool(read) || schoolCal();
  if (!cal) return;
  resetDrawerState();
  ui.schoolDraft = { source, truncated: !!read?.truncated, name: cal.name, terms: cal.terms.map((t) => ({ ...t })), days: cal.days.map((d) => ({ ...d })) };
  renderSchoolDrawer();
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const termOk = (t) => t.name.trim() && validDate(t.start) && validDate(t.end) && t.start <= t.end;
const dayOk = (d) => validDate(d.from) && validDate(d.to) && d.to >= d.from;
const valid = (s) => s.terms.length > 0 && s.terms.every(termOk) && s.days.every(dayOk);
const plural = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
const footHint = (s) => valid(s) ? plural(s.terms.length, 'semester') + ', ' + plural(s.days.length, 'day') : 'Fix the dates marked in red';

/** The draft as it would be saved. */
function toSave(s) {
  return {
    name: s.name.trim(),
    terms: s.terms.map((t) => ({ name: t.name.trim(), start: t.start, end: t.end })).sort((a, b) => a.start.localeCompare(b.start)),
    days: s.days.map((d) => ({ from: d.from, to: d.to, kind: d.kind, label: d.label.trim(), ...(d.kind === 'swap' ? { follows: d.follows ?? 1 } : {}) }))
      .sort((a, b) => a.from.localeCompare(b.from)),
  };
}

function termHtml(t, i, s) {
  const cal = termOk(t) ? normalizeSchool({ terms: [t], days: s.days.filter(dayOk) }) : null;
  const w = cal ? weekOf(cal, t.start) : null;
  return '<div class="sc-term' + (termOk(t) ? '' : ' bad') + '">'
    + '<span class="sc-row1"><input class="nm" type="text" maxlength="' + SCHOOL_LIMITS.term + '" data-sct="' + i + ':name" value="' + esc(t.name) + '" aria-label="Semester name">'
    + (s.terms.length > 1 ? '<button type="button" class="x" data-school-delterm="' + i + '" aria-label="Remove ' + esc(t.name || 'this semester') + '">✕</button>' : '') + '</span>'
    + '<label for="sct-' + i + '-s">Classes</label><span class="sc-dates"><input id="sct-' + i + '-s" type="date" data-sct="' + i + ':start" value="' + esc(t.start) + '" aria-label="First day of classes">'
    + '<span>to</span><input type="date" data-sct="' + i + ':end" value="' + esc(t.end) + '" aria-label="Last day of classes"></span>'
    + '<span class="sum">' + (w?.of ? w.of + ' week' + (w.of === 1 ? '' : 's') + ' of classes · ' + shortDate(t.start) + ' – ' + shortDate(t.end) : 'Check the dates') + '</span></div>';
}

function dayHtml(d, i) {
  const range = d.to !== d.from;
  return '<div class="sc-day k-' + d.kind + (dayOk(d) ? '' : ' bad') + '">'
    + '<span class="sc-when"><input type="date" data-scd="' + i + ':from" value="' + esc(d.from) + '" aria-label="From">'
    + '<input type="date" data-scd="' + i + ':to" value="' + esc(d.to) + '" aria-label="To"' + (range ? '' : ' class="same"') + '></span>'
    + '<span class="sc-what"><input type="text" maxlength="' + SCHOOL_LIMITS.label + '" data-scd="' + i + ':label" value="' + esc(d.label) + '" placeholder="' + esc(KIND_LABELS[d.kind]) + '" aria-label="Label">'
    + '<span class="sc-kinds"><select data-scd="' + i + ':kind" aria-label="Kind">' + SCHOOL_KINDS.map((k) => '<option value="' + k + '"' + (k === d.kind ? ' selected' : '') + '>' + KIND_LABELS[k] + '</option>').join('') + '</select>'
    + (d.kind === 'swap' ? '<select data-scd="' + i + ':follows" aria-label="Follows the timetable of">' + DAY_ORDER.map((w) => '<option value="' + w + '"' + (w === d.follows ? ' selected' : '') + '>' + DOW[w] + '’s classes</option>').join('') + '</select>' : '')
    + '</span></span>'
    + '<button type="button" class="x" data-school-del="' + i + '" aria-label="Remove ' + esc(d.label || KIND_LABELS[d.kind]) + '">✕</button></div>';
}

export function renderSchoolDrawer() {
  const s = ui.schoolDraft;
  if (!s) return;
  /* the days in date order, under the semester they fall in or follow */
  const order = s.days.map((d, i) => [d, i]).sort((a, b) => (a[0].from || '').localeCompare(b[0].from || ''));
  const terms = s.terms.filter(termOk).slice().sort((a, b) => a.start.localeCompare(b.start));
  let rows = '', head = null;
  for (const [d, i] of order) {
    const t = [...terms].reverse().find((x) => x.start <= d.from) || terms[0];
    if (t && t !== head) { rows += '<div class="sc-semh">' + esc(t.name) + '</div>'; head = t; }
    rows += dayHtml(d, i);
  }
  const body = '<div class="dbody sdrawer">'
    + '<div class="dnote">' + (s.source ? 'Read from <b>' + esc(s.source) + '</b>. Check the dates, then save. Nothing changes until you do.' : 'Your saved school calendar. Changes apply when you save.')
    + (s.truncated ? ' The file was long, so its end was not read: check the last dates.' : '') + '</div>'
    + '<div class="dsec"><h4>Name</h4><input class="sc-name" type="text" maxlength="' + SCHOOL_LIMITS.name + '" data-sc="name" value="' + esc(s.name) + '" placeholder="Your school 2026–27"></div>'
    + '<div class="dsec"><h4>Semesters<em>' + s.terms.length + '</em></h4>' + s.terms.map((t, i) => termHtml(t, i, s)).join('')
    + (s.terms.length < SCHOOL_LIMITS.terms ? '<button type="button" class="sc-add" data-school="add-term">+ Add a semester</button>' : '') + '</div>'
    + '<div class="dsec"><h4>Special days<em>' + s.days.length + '</em></h4>'
    + '<span class="note">Only the kind changes what you see: <b>No classes</b>, <b>Study break</b> and <b>Exams</b> hide classes; <b>Follows another day</b> runs that day’s timetable; a <b>Marker</b> is just a label.</span>'
    + rows
    + (s.days.length < SCHOOL_LIMITS.days ? '<button type="button" class="sc-add" data-school="add-day">+ Add a day</button>' : '') + '</div>'
    + '</div>';
  const ok = valid(s);
  const foot = '<div class="dfoot"><span class="hint">' + footHint(s) + '</span>'
    + '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>'
    + '<button class="btn go" type="button" data-school="save"' + (ok ? '' : ' disabled') + '>Save calendar</button></div>';
  keepFocus(() => showDrawer('<div class="dhead" data-accent="#0E7C74"><span class="kind">School calendar</span><span></span>'
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>' + body + foot));
}

/** A field of the drawer changed. */
export function editSchool(target) {
  const s = ui.schoolDraft, d = target.dataset;
  if (!s) return false;
  if ('sc' in d) { s.name = target.value; return true; }
  const [i, field] = (d.sct || d.scd || '').split(':');
  if ('sct' in d && s.terms[+i]) {
    s.terms[+i][field] = target.value;
    target.closest('.sc-term')?.classList.toggle('bad', !termOk(s.terms[+i]));
    refreshFoot();
    return true;
  }
  const row = s.days[+i];
  if (!('scd' in d) || !row) return false;
  if (field === 'follows') row.follows = +target.value;
  else if (field === 'kind') { row.kind = target.value; if (row.kind === 'swap' && row.follows === undefined) row.follows = 1; }
  else if (field === 'from') {
    const was = row.from;
    row.from = target.value;
    if (validDate(row.from) && (!row.to || row.to === was || row.to < row.from)) { row.to = row.from; const to = drawer.querySelector('[data-scd="' + i + ':to"]'); if (to) to.value = row.to; }
  } else row[field] = target.value;
  /* a new kind changes the row; dates and labels are typed in place, without a redraw */
  if (field === 'kind') renderSchoolDrawer();
  else { target.closest('.sc-day')?.classList.toggle('bad', !dayOk(row)); refreshFoot(); }
  return true;
}

function refreshFoot() {
  const s = ui.schoolDraft;
  const save = drawer.querySelector('[data-school="save"]'); if (save) save.disabled = !valid(s);
  const hint = drawer.querySelector('.dfoot .hint');
  if (hint) hint.textContent = footHint(s);
}

/** Clicks for the school calendar, in Settings and the drawer. True when it was one. */
export async function schoolClick(e) {
  let el;
  const act = e.target.closest('[data-school]')?.dataset.school;
  const s = ui.schoolDraft;
  if (act === 'review') { openSchool(null); return true; }
  if (act === 'remove') { ui.schoolAsk = true; renderSettings(); $('schoolGrp')?.querySelector('[data-school="keep"]')?.focus(); return true; }
  if (act === 'keep') { ui.schoolAsk = false; renderSettings(); return true; }
  if (act === 'remove-yes') {
    ui.schoolAsk = false;
    await saveProfile({ schoolCalendar: {} });
    ui.schoolNote = { text: 'School calendar removed.' };
    renderSettings(); render();
    return true;
  }
  if (!s) return false;
  if (act === 'save' && valid(s)) {
    await saveProfile({ schoolCalendar: toSave(s) });
    closeDrawer();
    toast('School calendar saved');
    return true;
  }
  if (act === 'add-term') {
    const last = s.terms[s.terms.length - 1];
    s.terms.push({ name: 'Semester ' + (s.terms.length + 1), start: last?.end || today(), end: last?.end || today() });
    renderSchoolDrawer(); return true;
  }
  if (act === 'add-day') {
    s.days.push({ from: today(), to: today(), kind: 'off', label: '' });
    renderSchoolDrawer();
    drawer.querySelector('[data-scd="' + (s.days.length - 1) + ':from"]')?.focus();
    return true;
  }
  if ((el = e.target.closest('[data-school-del]'))) { s.days.splice(+el.dataset.schoolDel, 1); renderSchoolDrawer(); return true; }
  if ((el = e.target.closest('[data-school-delterm]'))) { if (s.terms.length > 1) s.terms.splice(+el.dataset.schoolDelterm, 1); renderSchoolDrawer(); return true; }
  return false;
}
