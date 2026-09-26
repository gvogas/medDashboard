// Weighted grades for a course. Pure: give it the course's items, get the numbers back.
// A weight is the share of the course grade an item carries, 0–100; a missed item
// with a weight counts as graded 0.

export const GRADABLE = ['exam', 'quiz', 'assignment', 'lab', 'project'];
export const TARGETS = [50, 60, 70];

const weightOf = (it) => (typeof it.weight === 'number' && it.weight > 0 ? it.weight : 0);
const guessOf = (g, id) => (typeof g[id] === 'number' && g[id] >= 0 && g[id] <= 100 ? g[id] : null);
const scoreOf = (it) => (it.status === 'missed' ? 0 : it.status === 'graded' && typeof it.grade === 'number' ? it.grade : null);

/**
 * { current, graded, total, remaining, needed(target) }
 * guesses:   what-if scores by item id, counted as grades for items not graded yet
 * current:   weighted average of graded (and guessed) items, or null when there are none
 * graded:    weight already graded; total: all weight entered
 * remaining: weight still to come, counting weight not entered yet when the total is under 100
 * needed(t): average needed on the remaining weight to finish at t, assuming the
 *            course totals 100; null when nothing remains
 */
export function courseGrade(items, guesses = {}) {
  let graded = 0, total = 0, points = 0;
  for (const it of items) {
    const w = weightOf(it);
    if (!w) continue;
    total += w;
    const s = scoreOf(it) ?? guessOf(guesses, it.id);
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

/** Weighted items with no grade yet: what a what-if score can be entered for. */
export function ungraded(items) {
  return items.filter((it) => weightOf(it) && scoreOf(it) === null);
}

/** The targets to show: 50, 60, 70 and the course's own, in order, without repeats. */
export function targetsFor(target) {
  return [...new Set([...TARGETS, ...(target ? [target] : [])])].sort((a, b) => a - b);
}

/** How a needed average reads: '≥ 62%', 'secured', 'out of reach'. */
export function neededLabel(n) {
  if (n === null) return '';
  if (n <= 0) return 'secured';
  if (n > 100) return 'out of reach';
  return '≥ ' + n + '%';
}
