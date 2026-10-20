// Spaced review after lectures. The day after each timetabled lecture a task appears,
// "Review 1/4 · PHARM Lecture Mon 14 Sep"; marking it done creates the next step, dated
// from the day it was done: +2, +4, +14 days, which on schedule is days 1, 3, 7 and 21.
//
// Whether reviews are on syncs with the account: studyPrefs.reviews is the day they were
// turned on (null = off). Each browser keeps its own watermark (localStorage, per account),
// `through`, the last lecture date it has handled: writing it to the profile every day
// from every device would make profile conflicts. Ids are derived from the lecture, so two
// devices that both generate a step write the same row.

import { parse, addDays, iso, diffDays, shortDate } from './dates.ts';
import { classWeekday, courseRunsOn } from './school.ts';
import type { SchoolCalendar } from './school.ts';
import type { Course, Item, Meeting } from './types.ts';
import { REVIEW_ID as ID } from './shared.ts';

/** The setting, per account: on or off, and the last lecture date already handled. In
    localStorage `on` is what this browser last saw, so it knows when reviews were turned
    off and back on in between; `effectiveSetting` gives the setting to act on. */
export interface ReviewSetting { on: boolean; through: string | null }

/** A review step as generated, before normalizeItem fills the rest. */
export interface ReviewRow { id: string; type: 'task'; title: string; courseId: string | null; classId: string | null; date: string; status: 'todo' }

/** A queued operation, as far as untouchedReview reads it. */
/** What reviews read of a course. */
/* A class's course carries its space id: its reviews are yours, filed under the class (a
   personal row cannot point at a class's course), and the chain keeps them there (spec §8). */
type Timetabled = Pick<Course, 'id' | 'code' | 'archived' | 'meetings'> & { term?: string; spaceId?: string };

interface Op { op: string; key: string; body: Record<string, unknown> | null }

const STEPS = 4;
const GAP: Record<number, number> = { 1: 2, 2: 4, 3: 14 };          /* days from finishing step n to step n + 1 */
const KEY = 'rounds.reviews';
const MAX_SPAN = 120;                         /* never walk more than this many days at once */

const keyFor = (account: string) => KEY + ':' + account;

export function readSetting(account: string): ReviewSetting {
  try {
    /* the setting was once kept for the browser, not the account */
    const v = JSON.parse(localStorage.getItem(keyFor(account)) || localStorage.getItem(KEY) || 'null');
    return v && typeof v.on === 'boolean' ? { on: v.on, through: typeof v.through === 'string' ? v.through : null } : { on: false, through: null };
  } catch { return { on: false, through: null }; }
}
export function writeSetting(account: string, v: ReviewSetting): void {
  try { localStorage.setItem(keyFor(account), JSON.stringify(v)); } catch {}
}

/**
 * The setting to act on, from the synced day reviews were turned on (null = off) and this
 * browser's own copy. A browser that has handled nothing since then starts from today, as
 * turning reviews on always has, and never backfills lectures from before they were on.
 */
export function effectiveSetting(since: string | null, local: ReviewSetting): ReviewSetting {
  if (!since) return { on: false, through: null };
  const floor = iso(addDays(parse(since), -1));
  if (!local.on || !local.through) return { on: true, through: null };
  return { on: true, through: local.through > floor ? local.through : floor };
}

/**
 * What to do with a setting kept only in this browser, from before it synced: the day to
 * save as turned on (today, keeping the watermark), or null when there is nothing to move up.
 */
export function legacyReviews(synced: string | null | undefined, local: ReviewSetting, today: string): string | null {
  return synced === undefined && local.on ? today : null;
}

/**
 * A review step as generated, not yet touched: when another device already made the
 * same row, or deleted it, this copy can simply give way without a saved copy.
 */
export function untouchedReview(op: Op): boolean {
  const b = op.body as { id?: unknown; title?: unknown; status?: unknown; notes?: unknown; checklist?: unknown[]; links?: unknown[] };
  return op.op === 'put' && op.key.startsWith('items:') && ID.test(op.key.slice(6)) && reviewStep(b) > 0
    && b.status === 'todo' && !b.notes && !b.checklist?.length && !b.links?.length;
}

/** Every Lecture meeting of every live course, on each date in [from, to]; with a school
    calendar, only on days with classes, and by the timetable the day follows. */
export function lectureDates(courses: Timetabled[], from: string | null | undefined, to: string | null | undefined, cal: SchoolCalendar | null = null) {
  const out: { course: (typeof courses)[number]; meeting: Meeting; date: string }[] = [];
  if (!from || !to || from > to) return out;
  let d = parse(from), n = 0;
  const last = parse(to);
  while (d <= last && n++ <= MAX_SPAN * 3) {
    const date = iso(d), wd = classWeekday(cal, date);
    for (const c of courses) {
      if (c.archived || !courseRunsOn(cal, c.term, date)) continue;
      for (const m of c.meetings || []) if (m.kind === 'Lecture' && m.weekday === wd) out.push({ course: c, meeting: m, date });
    }
    d = addDays(d, 1);
  }
  return out;
}

/** 32-bit FNV-1a, as seven base-36 digits. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

export function reviewId(courseId: string, meetingId: string, date: string, step: number): string {
  return 'rv' + hash(courseId + '|' + meetingId + '|' + date) + step;
}

export function reviewStep(it: { id?: unknown; title?: unknown } | null | undefined): number {
  const m = it && typeof it.id === 'string' ? it.id.match(ID) : null;
  return m && /^Review \d\/\d · /.test((it!.title || '') as string) ? +m[1] : 0;
}


function row(id: string, step: number, title: string, courseId: string | null, date: string, classId: string | null = null): ReviewRow {
  return { id, type: 'task', title: 'Review ' + step + '/' + STEPS + ' · ' + title, courseId, classId, date, status: 'todo' };
}

/** Step 1 for every lecture in [from, to] that does not exist yet. */
export function firstReviews(courses: Timetabled[], items: Pick<Item, 'id'>[], from: string, to: string, cal: SchoolCalendar | null = null): ReviewRow[] {
  if (from && to && diffDays(from, to) > MAX_SPAN) from = iso(addDays(parse(to), -MAX_SPAN));
  const have = new Set(items.map((it) => it.id));
  const out: ReviewRow[] = [];
  for (const { course, meeting, date } of lectureDates(courses, from, to, cal)) {
    const id = reviewId(course.id, meeting.id, date, 1);
    if (have.has(id)) continue;
    have.add(id);
    out.push(row(id, 1, course.code + ' Lecture ' + shortDate(date), course.spaceId ? null : course.id, iso(addDays(parse(date), 1)), course.spaceId ?? null));
  }
  return out;
}

/** The step after a finished review, dated from `today`; null after the last step. */
export function nextReview(it: Pick<Item, 'id' | 'title' | 'courseId' | 'classId'>, today: string, items: Pick<Item, 'id'>[] = []): ReviewRow | null {
  const step = reviewStep(it);
  if (!step || step >= STEPS) return null;
  const id = it.id.slice(0, -1) + (step + 1);
  if (items.some((x) => x.id === id)) return null;
  const what = it.title.replace(/^Review \d\/\d · /, '');
  return row(id, step + 1, what, it.courseId, iso(addDays(parse(today), GAP[step])), it.classId ?? null);
}

/**
 * What to create now, and the watermark to store. Turning the setting on sets the
 * watermark to yesterday, so nothing before today is backfilled.
 */
export function dueReviews(setting: ReviewSetting, courses: Timetabled[], items: Pick<Item, 'id'>[], today: string, cal: SchoolCalendar | null = null): { rows: ReviewRow[]; through: string | null } {
  const yesterday = iso(addDays(parse(today), -1));
  if (!setting.on) return { rows: [], through: setting.through };
  if (!setting.through) return { rows: [], through: yesterday };
  if (setting.through >= yesterday) return { rows: [], through: setting.through };
  const from = iso(addDays(parse(setting.through), 1));
  return { rows: firstReviews(courses, items, from, yesterday, cal), through: yesterday };
}
