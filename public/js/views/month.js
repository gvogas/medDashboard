import { ui } from '../state.js';
import { iso, parse, addDays, monday, today, hhmm, dur, DOW } from '../dates.js';
import { classes, instances } from '../query.js';
import { tmeta } from '../model.js';
import { esc } from '../dom.js';
import { classChip } from './week.js';

const PER_CELL = 4;

/* month = the class schedule, and the dated deadlines when "Deadlines" is on. Weekly
   items (office hours, recurring tasks) stay off: they would fill every week. */
export function renderMonth() {
  const TODAY = today();
  const a = parse(ui.anchor), first = new Date(a.getFullYear(), a.getMonth(), 1);
  const gridStart = monday(first), cells = 42, all = classes();
  const byDow = {};
  all.forEach((x) => { (byDow[x.mtg.weekday] = byDow[x.mtg.weekday] || []).push(x); });

  const byDate = {};
  if (ui.monthDeadlines) {
    instances(iso(gridStart), iso(addDays(gridStart, cells - 1)))
      .filter((x) => x.item.recur !== 'weekly' && x.item.type !== 'office')
      .forEach((x) => { (byDate[x.date] = byDate[x.date] || []).push(x); });
  }

  let html = '<div class="panel"><div class="ph">' + (ui.monthDeadlines ? 'Classes and deadlines' : 'Class schedule')
    + '<button class="ph-toggle" type="button" data-monthdeadlines aria-pressed="' + (ui.monthDeadlines ? 'true' : 'false') + '">Deadlines</button>'
    + '<em>' + all.length + ' weekly class' + (all.length === 1 ? '' : 'es') + '</em></div><div class="month">';
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => { html += '<div class="mhead">' + d + '</div>'; });
  for (let i = 0; i < cells; i++) {
    const d = addDays(gridStart, i), key = iso(d), out = d.getMonth() !== a.getMonth();
    const due = byDate[key] || [], rows = byDow[d.getDay()] || [];
    const chips = due.map(deadlineChip).concat(rows.map(classChip));
    html += '<button class="cell' + (out ? ' out' : '') + (key === TODAY ? ' is-today' : '') + '" type="button" data-day="' + key + '"'
      + ' aria-label="' + esc(DOW[d.getDay()] + ' ' + key + (due.length ? ', ' + due.length + ' due' : '') + (rows.length ? ', ' + rows.length + ' class' + (rows.length === 1 ? '' : 'es') : '')) + '">'
      + '<span class="dnum">' + d.getDate() + '</span>';
    const shown = chips.length > PER_CELL ? PER_CELL - 1 : chips.length;
    html += chips.slice(0, shown).join('');
    if (chips.length > shown) html += '<span class="more">+' + (chips.length - shown) + ' more</span>';
    html += '</button>';
  }
  html += '</div></div>';

  /* weekly timetable, Mon–Sat (Sunday only if a class lands there) */
  const days = [1, 2, 3, 4, 5, 6, 0].filter((w) => (w !== 0 && w !== 6) || (byDow[w] || []).length);
  let tt = '<div class="panel"><div class="ph">Weekly timetable <em>time · room</em></div><div class="tt">';
  days.forEach((w) => {
    const rows = (byDow[w] || []).slice().sort((x, y) => (x.mtg.start < y.mtg.start ? -1 : 1));
    const hrs = rows.reduce((s, x) => s + dur(x.mtg.start, x.mtg.end), 0);
    tt += '<div class="ttcol"><div class="ttday">' + DOW[w] + '<em>' + (hrs ? Math.round(hrs * 10) / 10 + ' h' : '—') + '</em></div>';
    if (!rows.length) tt += '<div class="ttnone">No classes</div>';
    rows.forEach((x) => {
      tt += '<button class="ttcard" type="button" data-editcourse="' + esc(x.course.id) + '" data-accent="' + x.course.color + '">'
        + '<span class="tm">' + hhmm(x.mtg.start) + '–' + hhmm(x.mtg.end) + '</span> <span class="kd">' + esc(x.mtg.kind || 'Class') + '</span>'
        + '<span class="nm">' + esc(x.course.name) + '</span>'
        + '<span class="rm">' + esc(x.mtg.room || 'Room not set') + (x.course.instructor ? ' · ' + esc(x.course.instructor) : '') + '</span></button>';
    });
    tt += '</div>';
  });
  tt += '</div></div>';

  return html + tt;
}

function deadlineChip(x) {
  const m = tmeta(x.item.type);
  return '<span class="mchip due" data-accent="' + m.color + '" title="' + esc(m.label + ': ' + x.item.title) + '">'
    + (x.item.start ? '<b>' + hhmm(x.item.start) + '</b> ' : '') + esc(x.item.title) + '</span>';
}
