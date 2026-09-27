import { data, course } from '../store.js';
import { ui } from '../state.js';
import { tmeta, isComplete, statusLabel } from '../model.js';
import { parse, hhmm, DOW, MON } from '../dates.js';
import { passFilters } from '../query.js';
import { esc } from '../dom.js';
import { stepsHtml, statusChip } from './bits.js';

export function renderTable() {
  const rows = data.items.filter(passFilters), k = ui.sort.key, dir = ui.sort.dir;
  rows.sort((a, b) => {
    let va, vb;
    if (k === 'title') { va = a.title.toLowerCase(); vb = b.title.toLowerCase(); }
    else if (k === 'type') { va = a.type; vb = b.type; }
    else if (k === 'course') { va = (course(a.courseId) || { name: 'zz' }).name; vb = (course(b.courseId) || { name: 'zz' }).name; }
    else if (k === 'status') { va = statusLabel(a); vb = statusLabel(b); }
    else { va = a.date; vb = b.date; }
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
  const th = (key, label) => {
    const on = k === key;
    return '<th><button type="button" data-sort="' + key + '">' + label + (on ? '<span class="ar">' + (dir > 0 ? '↑' : '↓') + '</span>' : '') + '</button></th>';
  };
  let html = '<div class="panel fill"><div class="ph">All items <em>' + rows.length + ' shown of ' + data.items.length + '</em></div>'
    + '<div class="tablewrap"><table class="tbl"><thead><tr>'
    + th('title', 'Item') + th('type', 'Type') + th('course', 'Course') + th('date', 'Date')
    + '<th>Time</th><th>Where</th>' + th('status', 'Status') + '</tr></thead><tbody>';
  if (!rows.length) html += '<tr><td colspan="7"><div class="empty"><b>Nothing matches</b>Clear the search or turn a filter back on.</div></td></tr>';
  rows.forEach((it) => {
    const m = tmeta(it.type), c = course(it.courseId), d = parse(it.date);
    html += '<tr data-id="' + esc(it.id) + '" tabindex="0" class="' + (isComplete(it) ? 'complete' : '') + '">'
      + '<td><b data-layout="6e8bcfac">' + esc(it.title) + '</b>' + (it.checklist && it.checklist.length ? '<br>' + stepsHtml(it) : '') + '</td>'
      + '<td><span class="chip type" data-accent="' + m.color + '">' + esc(m.label) + '</span></td>'
      + '<td' + (c ? '' : ' class="none"') + '>' + (c ? '<span class="course-tag" data-accent="' + c.color + '"><i></i>' + esc(c.code) + '</span>' : '<span data-layout="ae860f94">—</span>') + '</td>'
      + '<td class="num mono">' + (it.recur === 'weekly' ? 'Weekly · ' + DOW[it.weekday] : DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3)) + '</td>'
      + '<td class="num mono' + (it.start || it.end ? '' : ' none') + '">' + (it.start ? hhmm(it.start) + (it.end ? '–' + hhmm(it.end) : '') : (it.end ? hhmm(it.end) : '—')) + '</td>'
      + '<td class="num' + (it.where ? '' : ' none') + '">' + esc(it.where || '—') + '</td>'
      + '<td>' + statusChip(it) + '</td></tr>';
  });
  return html + '</tbody></table></div></div>';
}
