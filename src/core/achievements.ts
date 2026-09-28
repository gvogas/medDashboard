// Achievements, worked out from what is already logged: study hours, streaks, big days,
// things done, exams taken and exam grades. Pure: give it sessions, items and the study
// prefs, get every badge back with whether it is earned, the day it was, and how far
// along a locked one is. Nothing is stored; a badge follows the data it came from.

import { iso } from './dates.ts';
import { minutesByDay, runs } from './history.ts';
import { isComplete, isTest } from './model.ts';
import type { Achievement, Badge, Course, Item, StudyPrefs, StudySession } from './types.ts';

type Sessions = Pick<StudySession, 'startedAt' | 'studyMinutes' | 'courseId'>[];
type Done = Pick<Item, 'id' | 'type' | 'status' | 'grade' | 'date' | 'completedAt' | 'updatedAt'>;

export const GROUPS: [string, string][] = [
  ['hours', 'Study hours'], ['streak', 'Streak'], ['days', 'Big days'],
  ['tasks', 'Tasks done'], ['exams', 'Exams'], ['grades', 'Grades'],
];

const HOURS: [number, string][] = [[1, 'First hour'], [10, '10 hours'], [25, '25 hours'], [50, '50 hours'], [100, 'Century'], [250, '250 hours']];
const STREAKS: [number, string][] = [[3, '3 in a row'], [7, 'Full week'], [30, 'Month strong'], [100, '100 days']];
const TASKS: [number, string][] = [[1, 'First tick'], [10, '10 done'], [50, '50 done'], [100, '100 done']];
const EXAMS: [number, string][] = [[1, 'First exam'], [5, '5 exams'], [10, '10 exams'], [25, '25 exams']];
const GRADES: [number, string][] = [[80, 'Solid'], [90, 'Top marks'], [100, 'Perfect']];
const MARATHON = 240;

const r1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's');

/** The local day an item was finished: when it was marked, else last saved, else its date. */
const doneDay = (it: Done): string => {
  const at = it.completedAt ?? it.updatedAt;
  return typeof at === 'number' ? iso(new Date(at)) : it.date;
};

function badge(group: string, id: string | number, tier: string, name: string, blurb: string, goal: number, have: number, earnedOn: string | null | undefined, progress: string): Badge {
  return { id: group + '-' + id, group, tier, name, blurb, goal, have, frac: goal ? Math.min(1, Math.max(0, have / goal)) : 0,
    earned: !!earnedOn, earnedOn: earnedOn || null, progress };
}

/** Days in date order with a running total: the first day the total reaches `min` minutes. */
function crossedOn(days: [string, number][], min: number): string | null {
  let sum = 0;
  for (const [d, m] of days) { sum += m; if (sum >= min) return d; }
  return null;
}

/** The nth item finished (1-based) in the order they were done: its day, or null. */
function nthDone(list: string[], n: number): string | null {
  return list.length >= n ? list[n - 1] : null;
}

/**
 * Every built-in badge, in group order:
 * {id, group, tier, name, blurb, goal, have, frac, earned, earnedOn, progress}.
 */
export function achievements(sessions: Sessions, items: Done[], prefs: Pick<StudyPrefs, 'goal' | 'dayMin' | 'rest'>, todayIso: string): Badge[] {
  const byDay = minutesByDay(sessions.filter((s) => s.studyMinutes > 0));
  const days = [...byDay].sort((a, b) => a[0].localeCompare(b[0]));
  const totalMin = days.reduce((a, [, m]) => a + m, 0);
  const best = days.reduce((a, [, m]) => Math.max(a, m), 0);
  const out: Badge[] = [];

  const hours = r1(totalMin / 60);
  for (const [h, name] of HOURS) {
    out.push(badge('hours', h, h + 'h', name, 'Study ' + plural(h, 'hour') + ' in total', h, hours,
      crossedOn(days, h * 60), hours + ' / ' + h + ' h'));
  }

  const st = runs(byDay, todayIso, prefs);
  for (const [n, name] of STREAKS) {
    out.push(badge('streak', n, n + 'd', name, 'Study ' + n + ' days in a row', n, st.longest,
      st.reached(n), st.longest + ' / ' + n + ' days'));
  }

  const firstDay = days[0]?.[0] || null;
  out.push(badge('days', 'first', '1st', 'First session', 'Log your first study session', 1, firstDay ? 1 : 0,
    firstDay, 'Log a session to start'));
  const goal = prefs.goal || 0;
  out.push(badge('days', 'goal', 'Goal', 'Goal met', 'Reach your daily goal', goal, goal ? best : 0,
    goal ? days.find(([, m]) => m >= goal)?.[0] : null,
    goal ? 'Best day ' + best + ' / ' + goal + ' min' : 'Set a daily goal'));
  out.push(badge('days', 'marathon', '4h', 'Marathon day', 'Study 4 hours in one day', MARATHON / 60, r1(best / 60),
    days.find(([, m]) => m >= MARATHON)?.[0], r1(best / 60) + ' / 4 h in one day'));

  const done = items.filter(isComplete).map((it) => ({ it, day: doneDay(it) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const tasks = done.filter((d) => !isTest(d.it.type)).map((d) => d.day);
  const exams = done.filter((d) => isTest(d.it.type)).map((d) => d.day);
  for (const [n, name] of TASKS) {
    out.push(badge('tasks', n, String(n), name, 'Finish ' + plural(n, 'task') + ', assignment' + (n === 1 ? '' : 's') + ' or lab' + (n === 1 ? '' : 's'),
      n, tasks.length, nthDone(tasks, n), tasks.length + ' / ' + n));
  }
  for (const [n, name] of EXAMS) {
    out.push(badge('exams', n, String(n), name, 'Sit ' + plural(n, 'exam') + ' or quiz' + (n === 1 ? '' : 'zes'),
      n, exams.length, nthDone(exams, n), exams.length + ' / ' + n));
  }

  const graded = done.filter((d): d is { it: Done & { grade: number }; day: string } => isTest(d.it.type) && d.it.status === 'graded' && typeof d.it.grade === 'number');
  const top = graded.reduce((a, d) => Math.max(a, d.it.grade), 0);
  for (const [g, name] of GRADES) {
    out.push(badge('grades', g, g === 100 ? '100' : g + '+', name, 'Score ' + (g === 100 ? '100' : g + ' or more') + ' on an exam or quiz',
      g, top, graded.find((d) => d.it.grade >= g)?.day, graded.length ? 'Best ' + r1(top) : 'No graded exams yet'));
  }
  return out;
}

/** The locked badges closest to done, grades and an unset goal left out. */
export function nextUp(list: Badge[], n = 3): Badge[] {
  return list.filter((b) => !b.earned && b.group !== 'grades' && b.goal > 0)
    .sort((a, b) => b.frac - a.frac).slice(0, n);
}

/**
 * Your own achievements, each with the same fields as a built-in badge plus its
 * sticker and rule. Hours: study minutes on the course reach target × 60, dated the
 * day they did. Grade: the exam or quiz is graded target or more, dated when it was.
 * A course or item that is gone leaves it locked.
 */
export function ownAchievements(own: Achievement[], sessions: Sessions, items: Done[], courses: Pick<Course, 'id'>[] = []): Badge[] {
  return own.map((a) => {
    const base = { sticker: a.sticker, rule: a.rule, courseId: a.courseId, itemId: a.itemId };
    const make = (have: number, earnedOn: string | null, progress: string): Badge => ({
      ...badge('own', a.id, '', a.name, '', a.target, have, earnedOn, progress), id: 'own-' + a.id, ownId: a.id, ...base });
    if (a.rule === 'grade') {
      const it = items.find((x) => x.id === a.itemId);
      if (!it) return make(0, null, 'Exam removed');
      const graded = it.status === 'graded' && typeof it.grade === 'number';
      const have = graded ? it.grade as number : 0;
      return make(have, graded && have >= a.target ? doneDay(it) : null,
        graded ? 'Got ' + r1(have) + ', need ' + a.target : 'Not graded yet');
    }
    if (courses.length && !courses.some((c) => c.id === a.courseId)) return make(0, null, 'Course removed');
    const days = [...minutesByDay(sessions.filter((s) => s.courseId === a.courseId && s.studyMinutes > 0))]
      .sort((x, y) => x[0].localeCompare(y[0]));
    const hours = r1(days.reduce((t, [, m]) => t + m, 0) / 60);
    return make(hours, crossedOn(days, a.target * 60), hours + ' / ' + a.target + ' h');
  });
}
