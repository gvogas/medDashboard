// Exam prep: fill an exam's checklist with the lectures it covers, and say how fast
// the remaining topics need to go.

import { parse, addDays, iso, diffDays, shortDate } from './dates.ts';
import { lectureDates } from './reviews.ts';
import { uid } from './model.ts';
import type { SchoolCalendar } from './school.ts';
import type { ChecklistEntry, Course, Item } from './types.ts';

/** How an exam's prep is going, from prepPace. */
export interface Pace { done: number; total: number; days: number; pace: number; hot: boolean }

/** What an exam window reads of an item. */
type Dated = Pick<Item, 'id' | 'type' | 'date' | 'courseId'>;

const MAX_STEPS = 50;
const LOOKBACK_DAYS = 70;

/**
 * The lectures an exam covers: from the day after the course's previous exam (or term
 * start, or ten weeks back, whichever is latest) up to the day before the exam.
 */
export function examWindow(exam: Dated, items: Dated[], termStart: string | null | undefined): { from: string; to: string } {
  const before = iso(addDays(parse(exam.date), -1));
  let from = iso(addDays(parse(exam.date), -LOOKBACK_DAYS));
  if (termStart && termStart > from) from = termStart;
  for (const it of items) {
    /* an exam starts after the last exam; a quiz after the last quiz or exam */
    if ((it.type !== 'exam' && it.type !== exam.type) || it.id === exam.id || it.courseId !== exam.courseId || it.date >= exam.date) continue;
    const after = iso(addDays(parse(it.date), 1));
    if (after > from) from = after;
  }
  return { from, to: before };
}

/**
 * The exam's checklist with a step per lecture appended; existing text is not repeated.
 * Returns { checklist, added, left } — left is how many did not fit under the cap.
 */
export function fillTopics(exam: Dated & Pick<Item, 'checklist'>, course: Pick<Course, 'id' | 'code' | 'archived' | 'meetings'>, items: Dated[], termStart: string | null | undefined, cal: SchoolCalendar | null = null): { checklist: ChecklistEntry[]; added: number; left: number } {
  const { from, to } = examWindow(exam, items, termStart);
  const list = (exam.checklist || []).slice();
  const have = new Set(list.map((s) => s.text.trim().toLowerCase()));
  let added = 0, left = 0;
  for (const { date } of lectureDates([course], from, to, cal)) {
    const text = course.code + ' Lecture · ' + shortDate(date);
    if (have.has(text.toLowerCase())) continue;
    have.add(text.toLowerCase());
    if (list.length >= MAX_STEPS) { left++; continue; }
    list.push({ id: uid(), text, done: false });
    added++;
  }
  return { checklist: list, added, left };
}

/** { done, total, days, pace, hot } for an open exam with steps, else null. Today counts as a day. */
export function prepPace(exam: Pick<Item, 'date' | 'checklist'>, today: string): Pace | null {
  const cl = exam.checklist || [];
  if (!cl.length) return null;
  const done = cl.filter((s) => s.done).length;
  const days = Math.max(1, diffDays(today, exam.date));
  const pace = Math.round(((cl.length - done) / days) * 10) / 10;
  return { done, total: cl.length, days, pace, hot: pace > 3 };
}

export function prepLabel(p: Pace | null): string {
  return p ? p.done + '/' + p.total + ' topics · ' + p.pace + '/day' : '';
}
