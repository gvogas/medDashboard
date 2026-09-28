// How the school calendar names a week, for the top bar and the month's header.

/** "Week 7 of 16 · Autumn 2026", "Study break · Winter 2027", or '' outside school. */
export function weekLabel(w) {
  if (!w) return '';
  if (w.kind === 'break') return 'Study break · ' + w.term.name;
  if (w.kind === 'exams') return 'Exams · ' + w.term.name;
  return w.week ? 'Week ' + w.week + ' of ' + w.of + ' · ' + w.term.name : '';
}
