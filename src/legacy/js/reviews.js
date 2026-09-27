// Spaced review after lectures. The day after each timetabled lecture a task appears,
// "Review 1/4 · PHARM Lecture Mon 14 Sep"; marking it done creates the next step, dated
// from the day it was done: +2, +4, +14 days, which on schedule is days 1, 3, 7 and 21.
//
// The setting lives in this browser only (localStorage, per account) with a watermark,
// `through`, the last lecture date already handled. Ids are derived from the lecture, so
// two devices that both generate a step write the same row.

import { parse, addDays, iso, diffDays, shortDate } from './dates.js';
import { classWeekday } from './school.js';

const STEPS = 4;
const GAP = { 1: 2, 2: 4, 3: 14 };          /* days from finishing step n to step n + 1 */
const KEY = 'rounds.reviews';
const ID = /^rv[0-9a-z]{7}([1-4])$/;
const MAX_SPAN = 120;                         /* never walk more than this many days at once */

const keyFor = (account) => KEY + ':' + account;

export function readSetting(account) {
  try {
    /* the setting was once kept for the browser, not the account */
    const v = JSON.parse(localStorage.getItem(keyFor(account)) || localStorage.getItem(KEY) || 'null');
    return v && typeof v.on === 'boolean' ? { on: v.on, through: typeof v.through === 'string' ? v.through : null } : { on: false, through: null };
  } catch { return { on: false, through: null }; }
}
export function writeSetting(account, v) {
  try { localStorage.setItem(keyFor(account), JSON.stringify(v)); } catch {}
}

/**
 * A review step as generated, not yet touched: when another device already made the
 * same row, or deleted it, this copy can simply give way without a saved copy.
 */
export function untouchedReview(op) {
  const b = op.body;
  return op.op === 'put' && op.key.startsWith('items:') && ID.test(op.key.slice(6)) && reviewStep(b) > 0
    && b.status === 'todo' && !b.notes && !b.checklist?.length && !b.links?.length;
}

/** Every Lecture meeting of every live course, on each date in [from, to]; with a school
    calendar, only on days with classes, and by the timetable the day follows. */
export function lectureDates(courses, from, to, cal = null) {
  const out = [];
  if (!from || !to || from > to) return out;
  let d = parse(from), n = 0;
  const last = parse(to);
  while (d <= last && n++ <= MAX_SPAN * 3) {
    const date = iso(d), wd = classWeekday(cal, date);
    for (const c of courses) {
      if (c.archived) continue;
      for (const m of c.meetings || []) if (m.kind === 'Lecture' && m.weekday === wd) out.push({ course: c, meeting: m, date });
    }
    d = addDays(d, 1);
  }
  return out;
}

/** 32-bit FNV-1a, as seven base-36 digits. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

export function reviewId(courseId, meetingId, date, step) {
  return 'rv' + hash(courseId + '|' + meetingId + '|' + date) + step;
}

export function reviewStep(it) {
  const m = it && typeof it.id === 'string' ? it.id.match(ID) : null;
  return m && /^Review \d\/\d · /.test(it.title || '') ? +m[1] : 0;
}


function row(id, step, title, courseId, date) {
  return { id, type: 'task', title: 'Review ' + step + '/' + STEPS + ' · ' + title, courseId, date, status: 'todo' };
}

/** Step 1 for every lecture in [from, to] that does not exist yet. */
export function firstReviews(courses, items, from, to, cal = null) {
  if (from && to && diffDays(from, to) > MAX_SPAN) from = iso(addDays(parse(to), -MAX_SPAN));
  const have = new Set(items.map((it) => it.id));
  const out = [];
  for (const { course, meeting, date } of lectureDates(courses, from, to, cal)) {
    const id = reviewId(course.id, meeting.id, date, 1);
    if (have.has(id)) continue;
    have.add(id);
    out.push(row(id, 1, course.code + ' Lecture ' + shortDate(date), course.id, iso(addDays(parse(date), 1))));
  }
  return out;
}

/** The step after a finished review, dated from `today`; null after the last step. */
export function nextReview(it, today, items = []) {
  const step = reviewStep(it);
  if (!step || step >= STEPS) return null;
  const id = it.id.slice(0, -1) + (step + 1);
  if (items.some((x) => x.id === id)) return null;
  const what = it.title.replace(/^Review \d\/\d · /, '');
  return row(id, step + 1, what, it.courseId, iso(addDays(parse(today), GAP[step])));
}

/**
 * What to create now, and the watermark to store. Turning the setting on sets the
 * watermark to yesterday, so nothing before today is backfilled.
 */
export function dueReviews(setting, courses, items, today, cal = null) {
  const yesterday = iso(addDays(parse(today), -1));
  if (!setting.on) return { rows: [], through: setting.through };
  if (!setting.through) return { rows: [], through: yesterday };
  if (setting.through >= yesterday) return { rows: [], through: setting.through };
  const from = iso(addDays(parse(setting.through), 1));
  return { rows: firstReviews(courses, items, from, yesterday, cal), through: yesterday };
}
