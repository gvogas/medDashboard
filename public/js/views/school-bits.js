// How the school calendar shows on the month and week views: a tag for a day with no
// classes, a break, exams or another day's timetable, marker labels, and week numbers.

import { esc } from '../dom.js';
import { DOW } from '../dates.js';

/** The tags for one day, from dayInfo(); '' for an ordinary day or none at all. */
export function schoolTags(info) {
  if (!info) return '';
  let out = '';
  if (info.kind === 'off' || info.kind === 'break' || info.kind === 'exams') out += '<span class="sdtag ' + info.kind + '">' + esc(info.label) + '</span>';
  else if (info.kind === 'swap') out += '<span class="sdtag swap" title="' + esc(info.label || '') + '">Follows ' + DOW[info.follows] + '</span>';
  for (const n of info.notes) out += '<span class="sdtag note">' + esc(n) + '</span>';
  return out;
}

/** "Week 7 of 16 · Autumn 2026", "Study break · Winter 2027", or '' outside school. */
export function weekLabel(w) {
  if (!w) return '';
  if (w.kind === 'break') return 'Study break · ' + w.term.name;
  if (w.kind === 'exams') return 'Exams · ' + w.term.name;
  return w.week ? 'Week ' + w.week + ' of ' + w.of + ' · ' + w.term.name : '';
}

/** The month's header chip, from weekOf() for each row of the grid: "Weeks 6 – 11 · Autumn 2026". */
export function weekRange(cal, weeks) {
  if (!cal) return '';
  const first = weeks.find((w) => w && w.kind === 'week' && w.week);
  if (!first) {
    const other = weeks.find(Boolean);
    return other ? '<span class="wkr">' + esc(weekLabel(other)) + '</span>' : '';
  }
  const nums = weeks.filter((w) => w && w.term === first.term && w.kind === 'week' && w.week).map((w) => w.week);
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return '<span class="wkr">' + (lo === hi ? 'Week ' + lo : 'Weeks ' + lo + ' – ' + hi) + ' · ' + esc(first.term.name) + '</span>';
}
