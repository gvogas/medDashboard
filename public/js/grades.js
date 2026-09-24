// Weighted grades for a course. Pure: give it the course's items, get the numbers back.
// A weight is the share of the course grade an item carries, 0–100; a missed item
// with a weight counts as graded 0.

export const GRADABLE = ['exam', 'assignment', 'lab', 'project'];
export const TARGETS = [50, 60, 70];

const weightOf = (it) => (typeof it.weight === 'number' && it.weight > 0 ? it.weight : 0);
const scoreOf = (it) => (it.status === 'missed' ? 0 : it.status === 'graded' && typeof it.grade === 'number' ? it.grade : null);

/**
 * { current, graded, total, remaining, needed(target) }
 * current:   weighted average of graded items, or null when nothing is graded
 * graded:    weight already graded; total: all weight entered
 * remaining: weight still to come, counting weight not entered yet when the total is under 100
 * needed(t): average needed on the remaining weight to finish at t, assuming the
 *            course totals 100; null when nothing remains
 */
export function courseGrade(items) {
  let graded = 0, total = 0, points = 0;
  for (const it of items) {
    const w = weightOf(it);
    if (!w) continue;
    total += w;
    const s = scoreOf(it);
    if (s === null) continue;
    graded += w;
    points += s * w;
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const remaining = total ? Math.max(total, 100) - graded : 0;
  return {
    current: graded ? r1(points / graded) : null,
    graded: r1(graded), total: r1(total), remaining: r1(remaining),
    needed(target) {
      if (remaining <= 0) return null;
      return r1((target * 100 - points) / remaining);
    },
  };
}

/** How a needed average reads: '≥ 62%', 'secured', 'out of reach'. */
export function neededLabel(n) {
  if (n === null) return '';
  if (n <= 0) return 'secured';
  if (n > 100) return 'out of reach';
  return '≥ ' + n + '%';
}
