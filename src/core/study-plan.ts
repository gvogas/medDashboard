// A day-by-day study plan for an exam: its open topics spread over the days from today up to
// the day before the exam, skipping rest weekdays. Topics keep their checklist order, and each
// day gets a near-equal share of them. Pure: the item sheet renders the result.

import { parse, addDays, iso, diffDays } from './dates.ts';
import type { ChecklistEntry, Item } from './types.ts';

export interface PlanDay { date: string; topics: string[] }
export interface StudyPlan {
  days: PlanDay[];
  /** open topics in the plan */
  open: number;
  /** topics exist but no study day is left before the exam (or today is the exam) */
  noStudyDays: boolean;
}

export function studyPlan(exam: Pick<Item, 'date' | 'checklist'>, today: string, rest: number[] = []): StudyPlan {
  const topics = (exam.checklist || []).filter((s: ChecklistEntry) => !s.done).map((s) => s.text.trim()).filter(Boolean);
  const span = Math.max(0, diffDays(today, exam.date));
  const dates: string[] = [];
  for (let i = 0; i < span; i++) {
    const d = addDays(parse(today), i);
    if (!rest.includes(d.getDay())) dates.push(iso(d));
  }
  if (!topics.length) return { days: [], open: 0, noStudyDays: false };
  if (!dates.length) return { days: [], open: topics.length, noStudyDays: true };
  const days = new Map<number, string[]>();
  const k = dates.length, n = topics.length;
  /* topic i goes to day floor(i*k/n): the topics spread across all the days, or across as many as there are topics */
  topics.forEach((text, i) => {
    const d = Math.floor((i * k) / n);
    days.set(d, [...(days.get(d) || []), text]);
  });
  const out = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([d, list]) => ({ date: dates[d], topics: list }));
  return { days: out, open: n, noStudyDays: false };
}
