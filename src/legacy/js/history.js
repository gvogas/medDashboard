// Study history, worked out from the logged sessions: minutes per day, a week, a month,
// the streak, and the term's heatmap. Pure: give it sessions and dates, get numbers
// back. Days are local calendar days, the day a session started.

import { iso, parse, addDays, monday } from './dates.js';

/** The local day a session belongs to, 'YYYY-MM-DD'. */
export const dayOf = (s) => iso(new Date(s.startedAt));

/** Minutes studied per day: Map of 'YYYY-MM-DD' → minutes. */
export function minutesByDay(sessions) {
  const out = new Map();
  for (const s of sessions) { const d = dayOf(s); out.set(d, (out.get(d) || 0) + s.studyMinutes); }
  return out;
}

const byNewest = (a, b) => b.startedAt - a.startedAt;

function perCourse(sessions) {
  const out = new Map();
  for (const s of sessions) { const k = s.courseId || ''; out.set(k, (out.get(k) || 0) + s.studyMinutes); }
  return [...out].sort((a, b) => b[1] - a[1]);
}

/**
 * The week holding `anyDay`, Monday to Sunday: {from, to, days, total, count,
 * perCourse, sessions}. Each day is {date, total, byCourse: [[courseId, minutes]]}.
 */
export function week(sessions, anyDay) {
  const start = monday(parse(anyDay)), from = iso(start), to = iso(addDays(start, 6));
  const inWeek = sessions.filter((s) => { const d = dayOf(s); return d >= from && d <= to; });
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = iso(addDays(start, i));
    const mine = inWeek.filter((s) => dayOf(s) === date);
    return { date, total: mine.reduce((a, s) => a + s.studyMinutes, 0), byCourse: perCourse(mine) };
  });
  return {
    from, to, days,
    total: inWeek.reduce((a, s) => a + s.studyMinutes, 0),
    count: inWeek.length,
    perCourse: perCourse(inWeek),
    sessions: inWeek.sort(byNewest),
  };
}

/**
 * A calendar month (month 0-11): {total, count, daysStudied, best: {date, total} | null,
 * groups: [{date, total, sessions}]} with the newest day first and empty days left out.
 */
export function month(sessions, year, monthIndex) {
  const prefix = year + '-' + String(monthIndex + 1).padStart(2, '0') + '-';
  const inMonth = sessions.filter((s) => dayOf(s).startsWith(prefix)).sort(byNewest);
  const groups = [];
  for (const s of inMonth) {
    const date = dayOf(s);
    let g = groups[groups.length - 1];
    if (!g || g.date !== date) groups.push(g = { date, total: 0, sessions: [] });
    g.total += s.studyMinutes;
    g.sessions.push(s);
  }
  const best = groups.reduce((b, g) => (!b || g.total > b.total ? g : b), null);
  return {
    total: inMonth.reduce((a, s) => a + s.studyMinutes, 0),
    count: inMonth.length,
    daysStudied: groups.length,
    best: best ? { date: best.date, total: best.total } : null,
    groups,
  };
}

/**
 * The streak: days in a row that reached `dayMin` minutes, counting back from today.
 * Rest days (weekday numbers, 0 = Sunday) never break it: studied, they count; skipped,
 * they are passed over. Today only counts once reached, and never breaks it before
 * the day is over. {current, longest, today: true when today already counts}.
 */
export function streak(byDay, todayIso, { dayMin = 15, rest = [] } = {}) {
  const counts = (d) => (byDay.get(d) || 0) >= dayMin;
  const isRest = (d) => rest.includes(parse(d).getDay());

  const first = firstDay(byDay);
  let current = 0, d = todayIso;
  const today = counts(todayIso);
  if (!today) d = iso(addDays(parse(todayIso), -1));
  for (; first && d >= first; d = iso(addDays(parse(d), -1))) {
    if (counts(d)) current++;
    else if (!isRest(d)) break;
  }

  return { current, longest: Math.max(current, runs(byDay, todayIso, { dayMin, rest }).longest), today };
}

/**
 * The streak walked forward from the first day studied, by the same rules:
 * {longest, reached(n)}, where reached(n) is the day a run first got to n days.
 */
export function runs(byDay, todayIso, { dayMin = 15, rest = [] } = {}) {
  const reached = new Map(), first = firstDay(byDay);
  let longest = 0, run = 0;
  for (let day = first; first && day <= todayIso; day = iso(addDays(parse(day), 1))) {
    if ((byDay.get(day) || 0) >= dayMin) run++;
    else if (!rest.includes(parse(day).getDay()) && day !== todayIso) run = 0;
    if (run > longest) { longest = run; reached.set(run, day); }
  }
  return { longest, reached: (n) => reached.get(n) || null };
}

function firstDay(byDay) {
  let first = null;
  for (const d of byDay.keys()) if (!first || d < first) first = d;
  return first;
}

/**
 * The heatmap's range: from the Monday of the term start (when it is set, in the past
 * and under half a year back) or of twelve weeks ago, through the Sunday of the week
 * holding today or of the sixteenth week, whichever is later. {from, to, weeks, since}.
 */
export function heatRange(termStart, todayIso) {
  const thisMonday = monday(parse(todayIso));
  let start = addDays(thisMonday, -7 * 12), since = null;
  if (termStart && termStart <= todayIso) {
    const t = monday(parse(termStart));
    if (Math.round((thisMonday - t) / 86_400_000) <= 7 * 26) { start = t; since = termStart; }
  }
  const upToNow = Math.round((thisMonday - start) / (7 * 86_400_000)) + 1;
  const weeks = Math.max(16, upToNow);
  return { from: iso(start), to: iso(addDays(start, weeks * 7 - 1)), weeks, since };
}

/** 0-4: how dark a day's square is. With a goal, relative to it; else by the hour. */
export function level(minutes, goal = 0) {
  if (!minutes) return 0;
  const [a, b, c] = goal ? [goal * 0.375, goal * 0.75, goal * 1.25] : [45, 90, 150];
  return minutes < a ? 1 : minutes < b ? 2 : minutes < c ? 3 : 4;
}
