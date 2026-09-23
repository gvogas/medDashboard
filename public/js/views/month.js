import { ui } from '../state.js';
import { iso, parse, addDays, monday, today, hhmm, dur, DOW } from '../dates.js';
import { classes } from '../query.js';
import { esc } from '../dom.js';

/* month = class schedule only */
export function renderMonth() {
  const TODAY = today();
  const a = parse(ui.anchor), first = new Date(a.getFullYear(), a.getMonth(), 1);
  const gridStart = monday(first), cells = 42, all = classes();
  const byDow = {};
  all.forEach((x) => { (byDow[x.mtg.weekday] = byDow[x.mtg.weekday] || []).push(x); });

  let html = '<div class="panel"><div class="ph">Class schedule <em>' + all.length + ' weekly class' + (all.length === 1 ? '' : 'es') + '</em></div><div class="month">';
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => { html += '<div class="mhead">' + d + '</div>'; });
  for (let i = 0; i < cells; i++) {
    const d = addDays(gridStart, i), key = iso(d), out = d.getMonth() !== a.getMonth();
    const rows = byDow[d.getDay()] || [];
    html += '<button class="cell' + (out ? ' out' : '') + (key === TODAY ? ' is-today' : '') + '" type="button" data-day="' + key + '">'
      + '<span class="dnum">' + d.getDate() + '</span>';
    rows.slice(0, 3).forEach((x) => {
      html += '<span class="mchip" data-accent="' + x.course.color + '"><b>' + hhmm(x.mtg.start) + '</b> ' + esc(x.course.code)
        + ' <span class="rm">' + esc(x.mtg.room || '') + '</span></span>';
    });
    if (rows.length > 3) html += '<span class="more">+' + (rows.length - 3) + ' more</span>';
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
