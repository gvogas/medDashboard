// Crunch: the stretches where too much falls together. Pure: give it the items, get the
// crunches back, each with the dates it covers and a line saying what piles up.
//
// Three kinds, each counted over open items with a date (weekly slots never count):
//   day    two or more exams or quizzes on one day
//   week   three or more exams in one week, Monday to Sunday (quizzes leave this alone)
//   burst  three or more weighted deadlines within 48 hours: on a day and the day after

import { addDays, dayMonth, diffDays, iso, monday, parse, shortDate } from './dates.ts';
import { isOpen, isTest, tmeta } from './model.ts';
import type { Item } from './types.ts';

/** What crunch reads of an item. */
export type Loaded = Pick<Item, 'id' | 'type' | 'date' | 'status' | 'weight' | 'recur'>;

export type CrunchKind = 'day' | 'week' | 'burst';

export interface Crunch {
  kind: CrunchKind;
  from: string;
  to: string;
  count: number;
  /** "2 exams or quizzes on Tue 13 Oct", "3 exams the week of 12 Oct", "3 weighted deadlines in 48 hours" */
  text: string;
}

export const DAY_TESTS = 2;
export const WEEK_EXAMS = 3;
export const BURST_DEADLINES = 3;

const counts = (it: Loaded) => !!it.date && it.recur !== 'weekly' && isOpen(it);
/** An exam, or a type of the person's own called a test, exam or midterm: a quiz is not one. */
const isExam = (it: Loaded) => isTest(it.type) && it.type !== 'quiz' && !/\bquiz/i.test(tmeta(it.type).label);
const weighted = (it: Loaded) => typeof it.weight === 'number' && it.weight > 0;

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

/**
 * Every crunch touching [from, to], by date. A week counts whole even when the range cuts
 * it; bursts that overlap are one burst.
 */
export function crunches(items: Loaded[], from: string, to: string): Crunch[] {
  const live = items.filter(counts);
  const out: Crunch[] = [];

  /* day: tests by date */
  const tests = new Map<string, number>();
  for (const it of live) if (isTest(it.type) && it.date >= from && it.date <= to) tests.set(it.date, (tests.get(it.date) || 0) + 1);
  for (const [date, n] of tests) if (n >= DAY_TESTS) out.push({ kind: 'day', from: date, to: date, count: n, text: n + ' exams or quizzes on ' + shortDate(date) });

  /* week: exams by Monday, over the weeks the range touches */
  const lo = iso(monday(parse(from))), hi = to;
  const exams = new Map<string, number>();
  for (const it of live) {
    if (!isExam(it)) continue;
    const mon = iso(monday(parse(it.date)));
    if (mon >= lo && mon <= hi) exams.set(mon, (exams.get(mon) || 0) + 1);
  }
  for (const [mon, n] of exams) if (n >= WEEK_EXAMS) out.push({ kind: 'week', from: mon, to: iso(addDays(parse(mon), 6)), count: n, text: plural(n, 'exam', 'exams') + ' the week of ' + dayMonth(mon) });

  /* burst: weighted deadlines on a day and the next; overlapping windows merge */
  const due = new Map<string, number>();
  for (const it of live) if (weighted(it)) due.set(it.date, (due.get(it.date) || 0) + 1);
  const starts = [...due.keys()].filter((d) => d >= iso(addDays(parse(from), -1)) && d <= to).sort();
  let open: Crunch | null = null;
  for (const d of starts) {
    const next = iso(addDays(parse(d), 1));
    const n = (due.get(d) || 0) + (due.get(next) || 0);
    if (n < BURST_DEADLINES) continue;
    if (open && diffDays(open.to, d) <= 0) {
      /* this window starts inside the last: count every deadline the two cover */
      open.to = next;
      open.count = [...due].filter(([x]) => x >= open!.from && x <= open!.to).reduce((s, [, v]) => s + v, 0);
    } else {
      open = { kind: 'burst', from: d, to: next, count: n, text: '' };
      out.push(open);
    }
  }
  for (const c of out) if (c.kind === 'burst') c.text = c.count + ' weighted deadlines ' + (diffDays(c.from, c.to) <= 1 ? 'in 48 hours' : 'from ' + shortDate(c.from) + ' to ' + shortDate(c.to));

  /* a burst that ends before the range is not in it */
  return out.filter((c) => c.to >= from && c.from <= to).sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
}

/** The crunches that hold `date`. */
export const crunchesOn = (list: Crunch[], date: string): Crunch[] => list.filter((c) => c.from <= date && c.to >= date);

/**
 * The line to show while saving `draft`: a crunch it makes or adds to, else null.
 * The saved copy of the item (same id) is left out, so a re-dated item counts once.
 */
export function crunchHint(items: Loaded[], draft: Loaded): string | null {
  if (!counts(draft)) return null;
  const others = items.filter((it) => it.id !== draft.id);
  const was = crunches(others, iso(addDays(parse(draft.date), -7)), iso(addDays(parse(draft.date), 7)));
  const now = crunches([...others, draft], draft.date, draft.date);
  /* the crunch this item is part of: on its day for tests, in its week for exams, in its burst for a weighted deadline */
  const mine = now.filter((c) => (c.kind === 'day' && isTest(draft.type)) || (c.kind === 'week' && isExam(draft)) || (c.kind === 'burst' && weighted(draft)));
  const hit = mine.find((c) => !was.some((w) => w.kind === c.kind && w.from === c.from && w.count >= c.count)) ?? null;
  if (!hit) return null;
  if (hit.kind === 'day') return 'This makes ' + hit.count + ' exams or quizzes on ' + shortDate(hit.from);
  if (hit.kind === 'week') return 'This makes ' + hit.count + ' exams the week of ' + dayMonth(hit.from);
  return 'This makes ' + hit.count + ' weighted deadlines within 48 hours';
}
