// The study timeline: every open exam's study plan (study-plan.ts) merged into one day-by-day
// list, from today for a fixed number of days. Pure: the Timer tab's card renders the result.

import { addDays, iso, parse } from './dates.ts';
import { isOpen, isTest } from './model.ts';
import { studyPlan } from './study-plan.ts';
import type { Item } from './types.ts';

export const TIMELINE_DAYS = 14;

export interface TimelineEntry { date: string; examId: string; exam: string; topics: string[] }

export function studyTimeline(items: Item[], today: string, rest: number[] = [], days = TIMELINE_DAYS): TimelineEntry[] {
  const end = iso(addDays(parse(today), days));
  const out: TimelineEntry[] = [];
  for (const it of items) {
    if (!isTest(it.type) || !isOpen(it) || !it.date || it.date <= today) continue;
    const exam = it.title.trim() || 'Untitled';
    for (const day of studyPlan(it, today, rest).days) {
      if (day.date >= end) continue;
      out.push({ date: day.date, examId: it.id, exam, topics: day.topics });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.exam.localeCompare(b.exam));
}
