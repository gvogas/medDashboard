// Up next: what to work on now, ranked. Pure: give it the items and today, get the
// rows back, each with a line saying why it is there.
//
// A row's score adds three things. How soon it is due: overdue first, then today,
// tomorrow, and less each day after, nothing past two weeks. What it is worth: its
// grade weight, or a little for an exam, quiz, assignment or project without one. How
// far behind its prep is: an exam or quiz with topics left to cover climbs with the
// topics it needs a day (prepPace), and is looked at three weeks out.
//
// Lecture reviews (core/reviews.ts) count only once they are due. Weekly slots, office
// hours and anything closed never show; nor does work left overdue for over a month.

import { diffDays } from './dates.ts';
import { isOpen, isTest, tmeta } from './model.ts';
import { prepPace, type Pace } from './prep.ts';
import { REVIEW_ID } from './shared.ts';
import type { Item } from './types.ts';

/** What Up next reads of an item. */
export type Ranked = Pick<Item, 'id' | 'type' | 'title' | 'date' | 'start' | 'end' | 'status' | 'weight' | 'checklist' | 'recur'>;

export interface NextRow<T extends Ranked = Ranked> {
  item: T;
  /** days until it is due: negative when overdue */
  days: number;
  score: number;
  /** "Overdue 2 days · worth 30%", "Exam in 4 days · 8 topics left · ~2 a day" */
  reason: string;
  prep: Pace | null;
}

export const NEXT_SHOWN = 7;

const AHEAD = 14;            /* days ahead an item is looked at */
const PREP_AHEAD = 21;       /* and an exam with topics left */
const STALE = 30;            /* overdue longer than this is left out */

/** A lecture review step: a task whose id the review chain made. */
export const isReview = (it: Pick<Item, 'id' | 'type'>): boolean => it.type === 'task' && REVIEW_ID.test(it.id);

const weightOf = (it: Ranked) => (typeof it.weight === 'number' && it.weight > 0 ? it.weight : 0);

/** How soon: 100 overdue, 90 today, 75 tomorrow, then 6 less a day, 0 from two weeks. */
function urgency(days: number): number {
  if (days < 0) return 100;
  if (days === 0) return 90;
  if (days === 1) return 75;
  return Math.max(0, 70 - days * 6);
}

/** What it is worth: its weight up to 30, else a little by type. */
function worth(it: Ranked): number {
  const w = weightOf(it);
  if (w) return Math.min(30, w);
  if (isTest(it.type)) return 15;
  if (it.type === 'assignment' || it.type === 'project') return 8;
  return 0;
}

/** "Overdue 2 days", "Overdue", "Due today", "Due tomorrow", "In 4 days". */
export function whenText(days: number): string {
  if (days < -1) return 'Overdue ' + -days + ' days';
  if (days === -1) return 'Overdue 1 day';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return 'In ' + days + ' days';
}

/** The reason line: when, then the weight, then the prep still to do. */
export function reasonFor(it: Ranked, days: number, prep: Pace | null): string {
  const left = prep ? prep.total - prep.done : 0;
  let when = whenText(days);
  /* an exam reads "Exam in 4 days", "Exam today", "Exam tomorrow" */
  if (isTest(it.type) && days >= 0) when = tmeta(it.type).label + (days === 0 ? ' today' : days === 1 ? ' tomorrow' : ' in ' + days + ' days');
  const parts = [when];
  const w = weightOf(it);
  if (w) parts.push('worth ' + w + '%');
  if (left > 0) parts.push(left + ' topic' + (left === 1 ? '' : 's') + ' left', '~' + Math.ceil(prep!.pace) + ' a day');
  if (isReview(it)) parts.push('lecture review');
  return parts.join(' · ');
}

/**
 * The open items worth doing now, best first, at most `limit`. Ties go to the earlier
 * date, then the earlier time, then the title.
 */
export function upNext<T extends Ranked>(items: T[], today: string, limit = NEXT_SHOWN): NextRow<T>[] {
  const rows: NextRow<T>[] = [];
  for (const it of items) {
    if (!it.date || it.recur === 'weekly' || it.type === 'office' || !isOpen(it)) continue;
    const days = diffDays(today, it.date);
    if (days < -STALE) continue;
    if (isReview(it) && days > 0) continue;
    const prep = isTest(it.type) && days >= 0 ? prepPace(it, today) : null;
    const left = prep ? prep.total - prep.done : 0;
    if (days > (left > 0 ? PREP_AHEAD : AHEAD)) continue;
    const behind = left > 0 ? Math.min(30, Math.round(prep!.pace * 8)) + (prep!.hot ? 10 : 0) : 0;
    const score = urgency(days) + worth(it) + behind;
    if (score <= 0) continue;
    rows.push({ item: it, days, score, reason: reasonFor(it, days, prep), prep });
  }
  return rows
    .sort((a, b) => b.score - a.score || a.item.date.localeCompare(b.item.date)
      || (a.item.start || a.item.end || '~').localeCompare(b.item.start || b.item.end || '~') || a.item.title.localeCompare(b.item.title))
    .slice(0, limit);
}
