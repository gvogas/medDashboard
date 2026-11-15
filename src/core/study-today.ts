// The Study plan card's view of the plan: a target for today that stays put, and the days
// after it. study-plan.ts spreads an exam's open topics from today to the day before the
// exam, so on its own it has no "done for today": tick a topic off and the next one moves
// into today. Here today's topics are fixed once (the target, which the caller keeps for
// the day, data/study-plan.ts), ticked topics stay in it as done, and everything else is
// planned from tomorrow, so no topic shows twice. Pure: the card renders the result.
// The items are the effective list (data/effective.ts), as in study-timeline.ts.

import { addDays, diffDays, iso, parse } from './dates.ts';
import { isOpen, isTest } from './model.ts';
import { studyPlan } from './study-plan.ts';
import { TIMELINE_DAYS, type TimelineEntry, type TimelineItem } from './study-timeline.ts';

/** Today's topics by exam key, as they stood when the day's target was first made. */
export type Target = Record<string, string[]>

export interface TodayTopic { text: string; done: boolean }
export interface TodayExam { examKey: string; exam: string; date: string; daysLeft: number; topics: TodayTopic[] }
export interface PlanView {
  /** today's target by exam, the soonest exam first; exams with nothing today are left out */
  today: TodayExam[];
  /** the study days after today, inside the window */
  upcoming: TimelineEntry[];
  /** the target to keep for the rest of the day */
  target: Target;
  /** topics in today's target still open, and all of them */
  left: number;
  total: number;
  /** upcoming exams that have open topics, and ones with no topics at all yet */
  exams: number;
  bare: number;
  /** the soonest exam with no topics yet, for the card's Add topics; null with none */
  bareKey: string | null;
}

const text = (s: { text: string }) => s.text.trim();

export function planView(items: TimelineItem[], today: string, rest: number[] = [], saved: Target | null = null, days = TIMELINE_DAYS): PlanView {
  const tomorrow = iso(addDays(parse(today), 1)), end = iso(addDays(parse(today), days));
  const out: PlanView = { today: [], upcoming: [], target: {}, left: 0, total: 0, exams: 0, bare: 0, bareKey: null };
  let bareDate = '';
  for (const it of items) {
    /* the same exams as the timeline: open, upcoming tests that are yours to sit */
    if (it.source === 'project' || it.removed) continue;
    if (!isTest(it.type) || !isOpen(it) || !it.date || it.date <= today) continue;
    const steps = (it.checklist || []).filter((s) => text(s));
    const open = steps.filter((s) => !s.done);
    const key = it.key ?? it.id;
    if (!steps.length) {
      out.bare++;
      if (!out.bareKey || it.date < bareDate) { out.bareKey = key; bareDate = it.date; }
      continue;
    }
    if (open.length) out.exams++;
    const openText = new Set(open.map(text)), anyText = new Set(steps.map(text));
    /* the day's target: what was kept, less what has left the checklist; else today's share of the plan */
    let mine = Object.hasOwn(saved ?? {}, key)
      ? saved![key].filter((t) => anyText.has(t))
      : studyPlan(it, today, rest).days.find((d) => d.date === today)?.topics ?? [];
    mine = [...new Set(mine)];
    /* the rest is planned from tomorrow; with no study day left after today, it is today's too */
    const held = new Set(mine);
    const later = studyPlan({ date: it.date, checklist: open.filter((s) => !held.has(text(s))) }, tomorrow, rest);
    if (later.noStudyDays) mine = [...mine, ...new Set(open.map(text).filter((t) => !held.has(t)))];
    out.target[key] = mine;
    const exam = it.title.trim() || 'Untitled';
    if (mine.length) {
      const topics = mine.map((t) => ({ text: t, done: !openText.has(t) }));
      out.today.push({ examKey: key, exam, date: it.date, daysLeft: diffDays(today, it.date), topics });
      out.total += topics.length;
      out.left += topics.filter((x) => !x.done).length;
    }
    for (const day of later.days) if (day.date <= end) out.upcoming.push({ date: day.date, examKey: key, exam, topics: day.topics });
  }
  out.today.sort((a, b) => a.date.localeCompare(b.date) || a.exam.localeCompare(b.exam));
  out.upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.exam.localeCompare(b.exam));
  return out;
}
