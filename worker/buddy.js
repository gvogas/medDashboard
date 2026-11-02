// Study Buddy (docs/superpowers/specs/2026-10-14-study-buddy-spec.md §4): the Gameplay switch,
// coins, XP, tier, health and streak. XP, health and streak are worked out on every read from
// synced rows; coins are ledger rows that the same read writes for anything not yet paid, keyed
// by source so nothing pays twice. This first half is the rules on plain rows, with no D1.

import {
  BIG_FINISH_COINS, BIG_TYPES, DAY_MINUTES, FINISH_COINS, FINISH_XP, HEALTH, LOG_WINDOW_MS,
  MINUTES_PER_COIN, PERSONAL_FINISH_LIMIT, REVIEW_FINISH_LIMIT, STREAK_COINS, STREAK_MAX, STREAK_MINUTES, isReview,
} from '../src/core/buddy-rules.ts';
import { localNow } from './push.js';
import { addDays } from './time.js';

/** The local YYYY-MM-DD of a time in the zone `tz`. */
export const dayOf = (ms, tz) => localNow(tz, ms).day;

/**
 * Each timed session's minutes that count, filling every local day up to DAY_MINUTES in start
 * order: [{id, day, counted}]. Typed-in logs, deleted sessions, sessions from before `since`,
 * and sessions saved more than LOG_WINDOW_MS after they began count for nothing.
 */
export function countSessions(rows, tz, since) {
  const live = rows
    .filter((s) => !s.manual && !s.deleted_at && s.started_at >= since && s.created_at - s.started_at <= LOG_WINDOW_MS)
    .sort((a, b) => a.started_at - b.started_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Map();
  const out = [];
  for (const s of live) {
    const day = dayOf(s.started_at, tz);
    const left = DAY_MINUTES - (used.get(day) || 0);
    const counted = Math.max(0, Math.min(left, s.study_minutes));
    used.set(day, (used.get(day) || 0) + counted);
    if (counted > 0) out.push({ id: s.id, day, counted });
  }
  return out;
}

/** Coins for counted sessions: one per MINUTES_PER_COIN minutes, scaled by `rate` (Focus Engine, Stage 2). */
export function sessionAwards(counted, rate = 1) {
  return counted
    .map(({ id, day, counted: m }) => ({ source: 'session:' + id, amount: Math.floor(Math.floor(m / MINUTES_PER_COIN) * rate), day }))
    .filter((a) => a.amount > 0);
}

/**
 * Coins for finishes not yet paid. Rows: {key, scope: 'u'|'c', id, type, title, completed_at};
 * `key` is 'u:<id>' or 'c:<space>:<id>'. Each is dated by its completed_at clamped to [from, now],
 * so it can't be backdated past the Worker's last look. Personal finishes share
 * PERSONAL_FINISH_LIMIT a day and lecture reviews have REVIEW_FINISH_LIMIT apart from that, both
 * counted on from `used` ({day: {personal, review}}, what earlier reads already paid); class
 * finishes have no limit. Over a limit the amount is 0, which still records the finish.
 */
export function finishAwards(rows, { tz, from, now, used = {} }) {
  const dated = rows
    .map((r) => ({ ...r, t: Math.min(now, Math.max(from, r.completed_at ?? now)) }))
    .sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const count = Object.fromEntries(Object.entries(used).map(([d, c]) => [d, { personal: c.personal || 0, review: c.review || 0 }]));
  return dated.map((r) => {
    const day = dayOf(r.t, tz);
    const c = (count[day] ||= { personal: 0, review: 0 });
    let amount = r.scope === 'c' && BIG_TYPES.includes(r.type) ? BIG_FINISH_COINS : FINISH_COINS;
    if (r.scope === 'u') {
      const kind = isReview(r.id, r.title || '') ? 'review' : 'personal';
      const limit = kind === 'review' ? REVIEW_FINISH_LIMIT : PERSONAL_FINISH_LIMIT;
      if (c[kind] >= limit) amount = 0;
      else c[kind]++;
    }
    return { source: 'item:' + r.key, amount, day };
  });
}

/** XP: counted minutes, 10 per paid finish still finished, and the admin bonus. */
export function xpOf({ counted, finishes, bonus = 0 }) {
  return counted.reduce((s, c) => s + c.counted, 0) + FINISH_XP * finishes + bonus;
}

/**
 * Health over `window` (days in order) from 100: each day's events, then the idle rule (the
 * HEALTH.idleFrom-th day in a row with no timed minutes and every one after costs HEALTH.idle),
 * then +1 per 10 timed minutes; clamped to 0-100 after each step.
 */
export function healthOf({ window, minutesByDay, events }) {
  const clamp = (h) => Math.max(0, Math.min(100, h));
  let h = 100, idle = 0;
  for (const day of window) {
    for (const e of events) if (e.day === day) h = clamp(h + e.change);
    const m = minutesByDay[day] || 0;
    idle = m > 0 ? 0 : idle + 1;
    if (idle >= HEALTH.idleFrom) h = clamp(h + HEALTH.idle);
    h = clamp(h + Math.floor(m / 10) * HEALTH.perTenMinutes);
  }
  return h;
}

/**
 * The streak from `fromDay` to `today`: a day with STREAK_MINUTES or more extends it and pays
 * min(STREAK_MAX, STREAK_COINS × length); a past day under it resets the run. Today counts once
 * it qualifies and, while it doesn't yet, leaves the run standing. Returns {awards, streak}.
 */
export function streakAwards(minutesByDay, fromDay, today) {
  const awards = [];
  let run = 0;
  for (let day = fromDay; day <= today; day = addDays(day, 1)) {
    if ((minutesByDay[day] || 0) >= STREAK_MINUTES) {
      run++;
      awards.push({ source: 'streak:' + day, amount: Math.min(STREAK_MAX, STREAK_COINS * run), day });
    } else if (day !== today) {
      run = 0;
    }
  }
  return { awards, streak: run };
}
