// The study timeline: every open exam's study plan (study-plan.ts) merged into one day-by-day
// list, from today for a fixed number of days. Pure: the Timer tab's card renders the result.
// The input is the effective item list (data/effective.ts): your own items, and your classes'
// items with your mark (status, checklist) applied, so a class's midterm counts as your own.

import { addDays, iso, parse } from './dates.ts';
import { isOpen, isTest } from './model.ts';
import { studyPlan } from './study-plan.ts';
import type { Item } from './types.ts';

export const TIMELINE_DAYS = 14;

/** An effective item: an Item, plus where it came from (`source`), its key, and a removal tombstone. */
export type TimelineItem = Item & { key?: string; source?: string; removed?: unknown };
export interface TimelineEntry { date: string; examKey: string; exam: string; topics: string[] }

export function studyTimeline(items: TimelineItem[], today: string, rest: number[] = [], days = TIMELINE_DAYS): TimelineEntry[] {
  const end = iso(addDays(parse(today), days));
  const out: TimelineEntry[] = [];
  for (const it of items) {
    /* project items are a team's tasks, not exams; a class item an editor removed is kept only for your note */
    if (it.source === 'project' || it.removed) continue;
    if (!isTest(it.type) || !isOpen(it) || !it.date || it.date <= today) continue;
    const exam = it.title.trim() || 'Untitled';
    const examKey = it.key ?? it.id;
    for (const day of studyPlan(it, today, rest).days) {
      if (day.date >= end) continue;
      out.push({ date: day.date, examKey, exam, topics: day.topics });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.exam.localeCompare(b.exam));
}
