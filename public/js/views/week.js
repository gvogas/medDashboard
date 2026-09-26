import { data, course } from '../store.js';
import { ui } from '../state.js';
import { tmeta, isOpen, isComplete, isOverdue, dueSoon, isTest } from '../model.js';
import { iso, parse, addDays, monday, diffDays, today, hhmm, DOW, MON } from '../dates.js';
import { instances, classes, matchSearch } from '../query.js';
import { esc } from '../dom.js';
import { stepsHtml, statusChip, CHECK_SVG } from './bits.js';

function rowHtml(inst) {
  const TODAY = today();
  const it = inst.item, m = tmeta(it.type), c = course(it.courseId);
  let badges = '<span class="chip type" data-accent="' + m.color + '">' + esc(m.label) + '</span>';
  if (isOverdue(it) || it.status !== 'todo') badges += statusChip(it);
  else if (dueSoon(it) && (it.type === 'assignment' || isTest(it.type))) badges += '<span class="chip soon">' + (diffDays(TODAY, inst.date) === 0 ? 'Today' : 'Soon') + '</span>';

  const when = it.start ? hhmm(it.start) : it.end ? hhmm(it.end) : '—';
  const bits = [];
  if (c) bits.push(c.name);
  if (it.where) bits.push(it.where);
  if (it.start && it.end) bits.push(hhmm(it.start) + '–' + hhmm(it.end));
  if (it.recur === 'weekly') bits.push('weekly');

  return '<button class="row tint' + (isComplete(it) ? ' complete' : '') + '" type="button" data-id="' + esc(it.id) + '" data-accent="' + m.color + '">'
    + '<span class="when mono">' + esc(when) + '</span>'
    + '<span class="what"><span class="t' + (isComplete(it) && it.type === 'task' ? ' struck' : '') + '">' + esc(it.title) + '</span>'
    + '<span class="m">' + esc(bits.join(' · ')) + '</span>'
    + stepsHtml(it)
    + '</span>'
    + '<span class="badges">' + badges + '</span></button>';
}

/** A class under its day: time, course name and room, in the course's colour. */
export function classChip(x) {
  return '<span class="mchip" data-accent="' + x.course.color + '" title="' + esc([x.course.code, x.mtg.kind, x.mtg.room].filter(Boolean).join(' · ')) + '">'
    + '<b>' + hhmm(x.mtg.start) + '</b> ' + esc(x.course.name || x.course.code)
    + (x.mtg.room ? ' <span class="rm">' + esc(x.mtg.room) + '</span>' : '') + '</span>';
}

export function renderWeek() {
  const TODAY = today();
  const start = monday(parse(ui.anchor)), from = iso(start), to = iso(addDays(start, 6));
  const list = instances(from, to), byDay = {};
  list.forEach((x) => { (byDay[x.date] = byDay[x.date] || []).push(x); });

  let sched = '<div class="panel"><div class="ph">Schedule <em>' + list.length + ' item' + (list.length === 1 ? '' : 's') + '</em></div>'
    + '<svg class="helix-rule" viewBox="0 0 400 11" preserveAspectRatio="none" fill="none" stroke="currentColor" stroke-width="1.05" aria-hidden="true">'
    + (ui.bg === 'cs'
      /* CS: a two-line data bus, ticked where the DNA has its rungs */
      ? '<path d="M0 3h400M0 8h400"/><path d="M18 3v5M54 3v5M90 3v5M126 3v5M162 3v5M198 3v5M234 3v5M270 3v5M306 3v5M342 3v5M378 3v5"/>'
      : '<path d="M0 5.5c12-5.5 24-5.5 36 0s24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0"/>'
        + '<path d="M0 5.5c12 5.5 24 5.5 36 0s24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0"/>'
        + '<path d="M18 1.8v7.4M54 1.8v7.4M90 1.8v7.4M126 1.8v7.4M162 1.8v7.4M198 1.8v7.4M234 1.8v7.4M270 1.8v7.4M306 1.8v7.4M342 1.8v7.4M378 1.8v7.4"/>')
    + '</svg>';

  const classesByDow = {};
  classes().forEach((x) => { (classesByDow[x.mtg.weekday] = classesByDow[x.mtg.weekday] || []).push(x); });

  let any = false;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), key = iso(d), rows = byDay[key] || [];
    if (!rows.length && ui.search) continue;
    any = any || rows.length > 0;
    const cls = classesByDow[d.getDay()] || [];
    sched += '<div class="day' + (key === TODAY ? ' is-today' : '') + '">'
      + DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3)
      + (key === TODAY ? '<span class="today-tag">Today</span>' : '')
      + (rows.length ? '' : '<span class="free">Nothing due</span>')
      + '<button class="add" type="button" data-add="' + key + '" aria-label="Add item on ' + key + '">+</button></div>';
    if (cls.length) sched += '<div class="dayclasses">' + cls.map(classChip).join('') + '</div>';
    rows.forEach((x) => { sched += rowHtml(x); });
  }
  if (!any) {
    sched += data.items.length
      ? '<div class="empty"><b>No matches this week</b>Try clearing the search or a filter.</div>'
      : '<div class="empty"><b>Nothing here yet</b>Add a course from the sidebar, then a first item with “New item”.</div>';
  }
  sched += '</div>';

  const ohRows = data.items.filter((it) => it.type === 'office' && (ui.course === 'all' || it.courseId === ui.course) && matchSearch(it));
  ohRows.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || (a.start < b.start ? -1 : 1));
  let ohHtml = '<div class="panel"><div class="ph">Office hours <em>weekly</em></div><table class="oh"><thead><tr><th>Faculty</th><th>When · room</th></tr></thead><tbody>';
  if (!ohRows.length) ohHtml += '<tr><td colspan="2" class="empty">None yet</td></tr>';
  ohRows.forEach((it, i) => {
    const c = course(it.courseId);
    ohHtml += '<tr data-id="' + esc(it.id) + '" tabindex="0"><td class="' + (i === 0 ? 'next' : '') + '">'
      + (i === 0 ? '<svg class="mini-scope" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">'
        + (ui.bg === 'cs' ? '<path d="M3 6l5 4-5 4M10 15h7"/>' : '<path d="M4 3c0 6 2 7 4 9s6 3 8 1"/><circle cx="16" cy="14" r="3.4"/>') + '</svg>' : '')
      + esc(it.title.replace(' — office hours', '')) + ' <span class="dept">' + esc(it.dept || (c ? c.code : '')) + '</span></td>'
      + '<td class="w mono">' + (it.recur === 'weekly' ? DOW[it.weekday] : DOW[parse(it.date).getDay()]) + ' ' + hhmm(it.start) + '<br><span class="dept">' + esc(it.where || '') + '</span></td></tr>';
  });
  ohHtml += '</tbody></table></div>';

  const tasks = data.items.filter((it) => it.type === 'task' && (ui.course === 'all' || it.courseId === ui.course) && matchSearch(it))
    .sort((a, b) => (isOpen(b) ? 0 : 1) - (isOpen(a) ? 0 : 1) || (a.date < b.date ? -1 : 1));
  let tHtml = '<div class="panel"><div class="ph">Tasks <em>' + tasks.filter(isOpen).length + ' open</em></div>';
  if (!tasks.length) tHtml += '<div class="empty">No tasks</div>';
  tasks.slice(0, 9).forEach((it) => {
    tHtml += '<div class="task' + (isOpen(it) ? '' : ' done') + '">'
      + '<button class="box" type="button" data-toggle="' + esc(it.id) + '" aria-pressed="' + (isOpen(it) ? 'false' : 'true') + '" aria-label="Mark done">' + CHECK_SVG + '</button>'
      + '<button type="button" class="tx" data-id="' + esc(it.id) + '">' + esc(it.title)
      + (it.date ? ' <span class="meta">' + (isOverdue(it) ? '· overdue' : '· ' + DOW[parse(it.date).getDay()] + ' ' + parse(it.date).getDate()) + '</span>' : '')
      + '</button></div>';
  });
  tHtml += '<div class="quick"><input type="text" id="quickTask" placeholder="Add a task, press Enter" aria-label="Add a task" maxlength="140"></div>'
    + '<svg class="steroid" viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'
    + (ui.bg === 'cs'
      /* CS: a small binary tree in the corner instead of the steroid */
      ? '<circle cx="60" cy="12" r="6"/><circle cx="32" cy="40" r="6"/><circle cx="88" cy="40" r="6"/>'
        + '<circle cx="18" cy="68" r="5"/><circle cx="46" cy="68" r="5"/><circle cx="102" cy="68" r="5"/>'
        + '<path d="M55 16L37 36M65 16l18 20M28 45l-7 18M36 45l7 18M92 45l7 18"/>'
      : '<path d="M14 46l-9-16 9-16 18 1 8 15-8 16z"/><path d="M32 31l18 1 8 15-8 16-18-1-8-15"/>'
        + '<path d="M50 32l17-8 13 11-5 17-17 3-8-15"/><path d="M80 35l16-4 8 12-11 11-13-5z"/>')
    + '</svg></div>';

  return '<div class="cols">' + sched + '<div class="aside-col">' + ohHtml + tHtml + '</div></div>';
}
