// The term recap: what a semester (or any range of days) added up to. Hours studied, in
// all and per course, the sessions, the best day and the longest streak inside the range,
// the items completed by type, the exams and quizzes taken, and each course's grade.
// Pure: give it the rows, get the numbers back.

import { addDays, iso, parse } from './dates.ts';
import { dayOf, minutesByDay, runs, type Logged, type StreakRules } from './history.ts';
import { courseGrade, type GradeCategory, type Graded } from './grades.ts';
import { isComplete } from './model.ts';
import type { Item } from './types.ts';

type Dated = Graded & Pick<Item, 'type' | 'date' | 'courseId'>;

export interface Recap {
  from: string;
  to: string;
  minutes: number;
  sessions: number;
  daysStudied: number;
  best: { date: string; minutes: number } | null;
  longestStreak: number;
  /* the most studied first; courseId null is study with no course */
  byCourse: { courseId: string | null; minutes: number }[];
  completed: { type: string; count: number }[];
  completedTotal: number;
  /* exams and quizzes dated in the range, up to today, that were not missed */
  tests: number;
  grades: { courseId: string; current: number | null }[];
}

/** A course's grade categories, by its id (none: the items' own weights). */
export type CategoriesOf = (courseId: string) => readonly GradeCategory[] | null | undefined;

/** The range's grade line per course: today's courseGrade over the course's items in the range, with its categories. */
export function rangeGrades(items: Dated[], courseIds: string[], categoriesOf: CategoriesOf = () => null): Recap['grades'] {
  return courseIds
    .map((courseId) => ({ courseId, current: courseGrade(items.filter((it) => it.courseId === courseId), {}, categoriesOf(courseId)).current }))
    .filter((g) => g.current !== null);
}

/**
 * The recap of `from`..`to` (inclusive), counted up to `today` when the range runs on past
 * it. Sessions count on the day they started; items on their date.
 */
export function termRecap(
  sessions: Logged[], items: Dated[], from: string, to: string, today: string, rules: StreakRules = {}, categoriesOf?: CategoriesOf,
): Recap {
  const end = to < today ? to : today;
  const inRange = (d: string) => d >= from && d <= end;
  const mine = sessions.filter((s) => inRange(dayOf(s)));
  const byDay = minutesByDay(mine);
  let minutes = 0, best: Recap['best'] = null;
  for (const [date, m] of byDay) {
    minutes += m;
    if (!best || m > best.minutes || (m === best.minutes && date < best.date)) best = { date, minutes: m };
  }
  const perCourse = new Map<string | null, number>();
  for (const s of mine) perCourse.set(s.courseId ?? null, (perCourse.get(s.courseId ?? null) || 0) + (s.studyMinutes || 0));
  const byCourse = [...perCourse].map(([courseId, m]) => ({ courseId, minutes: m })).filter((c) => c.minutes > 0).sort((a, b) => b.minutes - a.minutes);

  const dated = items.filter((it) => it.date && inRange(it.date));
  const done = new Map<string, number>();
  for (const it of dated) if (isComplete(it)) done.set(it.type, (done.get(it.type) || 0) + 1);
  const completed = [...done].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const tests = dated.filter((it) => (it.type === 'exam' || it.type === 'quiz') && it.status !== 'missed' && it.date <= today).length;

  const courseIds = [...new Set(dated.map((it) => it.courseId).filter((c): c is string => !!c))];
  return {
    from, to, minutes, sessions: mine.length,
    daysStudied: [...byDay.values()].filter((m) => m > 0).length,
    best, longestStreak: end >= from ? runs(byDay, end, rules).longest : 0,
    byCourse, completed, completedTotal: completed.reduce((n, c) => n + c.count, 0), tests,
    grades: rangeGrades(dated, courseIds, categoriesOf),
  };
}

/** A range when there is no school calendar: the last 16 weeks through today. */
export function defaultRange(today: string): { from: string; to: string } {
  return { from: iso(addDays(parse(today), -16 * 7 + 1)), to: today };
}
