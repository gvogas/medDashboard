// A school's academic calendar: its semesters (first and last day of classes) and its
// special days, days with no classes, a study break, the exam period, a day that runs
// another weekday's timetable, and plain markers. Pure and time-zone free: every date is
// a 'YYYY-MM-DD' string worked on in UTC, so the Worker's calendar feed shares it.

export type SchoolKind = 'off' | 'break' | 'exams' | 'swap' | 'note';
export const SCHOOL_KINDS: SchoolKind[] = ['off', 'break', 'exams', 'swap', 'note'];
export const KIND_LABELS: Record<SchoolKind, string> = { off: 'No classes', break: 'Study break', exams: 'Exams', swap: 'Follows another day', note: 'Marker' };
export const SCHOOL_LIMITS = { terms: 4, days: 80, name: 80, term: 40, label: 60 };

/** A semester: its name and its first and last day of classes. */
export interface Term { name: string; start: string; end: string }
/** A special day or run of days; a swap day says which weekday's classes it follows. */
export interface SchoolDay { from: string; to: string; kind: SchoolKind; label: string; follows?: number }
export interface SchoolCalendar { name: string; terms: Term[]; days: SchoolDay[] }

/** What a school day is, from dayInfo. */
export interface DayInfo {
  kind: SchoolKind | 'none' | 'class';
  label: string;
  follows?: number;
  notes: string[];
  term: Term | null;
}

/** Where a week sits in the school year, from weekOf. */
export interface WeekInfo { term: Term; kind: 'week' | 'break' | 'exams'; week: number | null; of: number | null }

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const validDate = (d: unknown): d is string => typeof d === 'string' && DATE.test(d) && iso(ms(d)) === d;
const plusDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const weekdayOf = (d: string): number => new Date(ms(d)).getUTCDay();
const mondayOf = (d: string) => plusDays(d, -((weekdayOf(d) + 6) % 7));
const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const isKind = (k: unknown): k is SchoolKind => SCHOOL_KINDS.includes(k as SchoolKind);

/** A stored or read calendar made safe: {name, terms, days}, or null when it has no semester. */
export function normalizeSchool(raw: unknown): SchoolCalendar | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { name?: unknown; terms?: unknown; days?: unknown };
  const terms = (Array.isArray(r.terms) ? r.terms as Record<string, unknown>[] : [])
    .filter((t): t is { name?: unknown; start: string; end: string } => t && validDate(t.start) && validDate(t.end) && t.start <= t.end)
    .map((t) => ({ name: cut(t.name, SCHOOL_LIMITS.term) || 'Semester', start: t.start, end: t.end }))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, SCHOOL_LIMITS.terms);
  if (!terms.length) return null;
  const days = (Array.isArray(r.days) ? r.days as Record<string, unknown>[] : [])
    .filter((d): d is { from: string; to?: unknown; kind: SchoolKind; label?: unknown; follows?: unknown } => d && validDate(d.from) && isKind(d.kind))
    .map((d) => {
      const to = validDate(d.to) && d.to >= d.from ? d.to : d.from;
      const out: SchoolDay = { from: d.from, to, kind: d.kind, label: cut(d.label, SCHOOL_LIMITS.label) };
      if (d.kind === 'swap') out.follows = Number.isInteger(d.follows) && (d.follows as number) >= 0 && (d.follows as number) <= 6 ? d.follows as number : 1;
      return out;
    })
    .sort((a, b) => a.from.localeCompare(b.from)).slice(0, SCHOOL_LIMITS.days);
  return { name: cut(r.name, SCHOOL_LIMITS.name), terms, days };
}

/** The semester whose classes run on `date`, or null. */
const termOf = (cal: SchoolCalendar | null, date: string) => cal?.terms.find((t) => t.start <= date && date <= t.end) || null;

/**
 * What kind of school day `date` is: {kind, label, follows, notes, term}. kind is
 * 'off', 'break' or 'exams' from a special day; 'none' outside every semester; 'swap'
 * when it runs the `follows` weekday's classes; else 'class'. notes are marker labels.
 */
export function dayInfo(cal: SchoolCalendar | null, date: string): DayInfo {
  const hits = cal ? cal.days.filter((d) => d.from <= date && date <= d.to) : [];
  const notes = hits.filter((d) => d.kind === 'note').map((d) => d.label).filter(Boolean);
  const term = termOf(cal, date);
  const strong = hits.find((d) => d.kind === 'off') || hits.find((d) => d.kind === 'break') || hits.find((d) => d.kind === 'exams');
  if (strong) return { kind: strong.kind, label: strong.label || KIND_LABELS[strong.kind], notes, term };
  if (cal && !term) return { kind: 'none', label: 'No school', notes, term: null };
  const swap = hits.find((d) => d.kind === 'swap');
  if (swap) return { kind: 'swap', label: swap.label, follows: swap.follows, notes, term };
  return { kind: 'class', label: '', notes, term };
}

/** Whose timetable runs on `date`: a weekday 0–6, or null for no classes. No calendar: its own. */
export function classWeekday(cal: SchoolCalendar | null, date: string): number | null {
  if (!cal) return weekdayOf(date);
  const info = dayInfo(cal, date);
  /* a swap day always has `follows`: normalizeSchool sets it */
  return info.kind === 'class' ? weekdayOf(date) : info.kind === 'swap' ? info.follows as number : null;
}

/* A semester's weeks, Monday to Sunday. A week is not counted when every weekday of it
   inside the semester is a study break. */
function weeksOf(cal: SchoolCalendar, term: Term) {
  const out: { monday: string; week: number | null }[] = [];
  let n = 0;
  for (let mon = mondayOf(term.start); mon <= term.end; mon = plusDays(mon, 7)) {
    const weekdays = [0, 1, 2, 3, 4].map((i) => plusDays(mon, i)).filter((d) => d >= term.start && d <= term.end);
    const rest = weekdays.length > 0 && weekdays.every((d) => dayInfo(cal, d).kind === 'break');
    out.push({ monday: mon, week: rest ? null : ++n });
  }
  return { weeks: out, of: n };
}

/**
 * Where the week holding `date` sits: null outside school, else {term, kind, week, of}.
 * kind 'week' is a numbered week ("Week 7 of 16"); 'break' a study break week, with
 * `week` the number the next week will have; 'exams' an exam week after classes end.
 */
export function weekOf(cal: SchoolCalendar | null, date: string): WeekInfo | null {
  if (!cal) return null;
  const mon = mondayOf(date), days = [0, 1, 2, 3, 4, 5, 6].map((i) => plusDays(mon, i));
  const term = days.map((d) => termOf(cal, d)).find(Boolean);
  if (term) {
    const { weeks, of } = weeksOf(cal, term);
    const i = weeks.findIndex((w) => w.monday === mon);
    const w = weeks[i];
    if (w && w.week === null) return { term, kind: 'break', week: weeks.slice(i).find((x) => x.week)?.week ?? null, of };
    return { term, kind: 'week', week: w ? w.week : null, of };
  }
  if (days.some((d) => dayInfo(cal, d).kind === 'exams')) {
    const before = [...cal.terms].reverse().find((t) => t.end < mon) || cal.terms[0];
    return { term: before, kind: 'exams', week: null, of: null };
  }
  return null;
}

/** The semester that counts now: the latest to have started by `today`, else the next one. */
export function currentTerm(cal: SchoolCalendar | null, today: string): Term | null {
  if (!cal) return null;
  return [...cal.terms].reverse().find((t) => t.start <= today) || cal.terms[0];
}

/** The semester a course's `term` names, matched by name with case and spacing aside. Null
    means all year: an empty term, one that names no semester, or no calendar. */
export function courseTerm(cal: SchoolCalendar | null, text: string | null | undefined): Term | null {
  const want = (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cal || !want) return null;
  return cal.terms.find((t) => t.name.toLowerCase() === want) || null;
}

/** Whether a course of semester `text` can have classes on `date`: all-year courses always. */
export function courseRunsOn(cal: SchoolCalendar | null, text: string | null | undefined, date: string): boolean {
  const t = courseTerm(cal, text);
  return !t || (t.start <= date && date <= t.end);
}

/** Whether a course goes under semester `term` in the sidebar: its own, or all year. */
export function inTerm(cal: SchoolCalendar | null, text: string | null | undefined, term: Term | null): boolean {
  const t = courseTerm(cal, text);
  return !t || !term || t === term;
}

/** The semester the sidebar shows: the one picked while the calendar still has it, else the current one. */
export function pickedTerm(cal: SchoolCalendar | null, picked: string | null, today: string): Term | null {
  if (!cal) return null;
  return cal.terms.find((t) => t.name === picked) || currentTerm(cal, today);
}

/**
 * When a weekly item can repeat until, for an item dated `date`: the end of each semester
 * still to end, then the school year's last day (its last exam day) when that is later.
 * The first is the default. Empty without a calendar.
 */
export function repeatEnds(cal: SchoolCalendar | null, date: string): { end: string; term: Term | null }[] {
  if (!cal) return [];
  const out: { end: string; term: Term | null }[] = cal.terms.filter((t) => t.end >= date).map((t) => ({ end: t.end, term: t }));
  const last = cal.days.filter((d) => d.kind === 'exams').map((d) => d.to)
    .reduce((a, b) => (b > a ? b : a), cal.terms[cal.terms.length - 1].end);
  if (last >= date && !out.some((o) => o.end === last)) out.push({ end: last, term: null });
  return out;
}

/** The term start the app goes by: the school calendar's current semester, else the one set. */
export function termStartFor(profile: { schoolCalendar?: unknown; termStart?: string | null } | null | undefined, today: string): string | null {
  const cal = normalizeSchool(profile?.schoolCalendar);
  return cal ? currentTerm(cal, today)!.start : profile?.termStart || null;
}

/** One line about where `today` is in the school year, for Settings. */
export function schoolStatus(cal: SchoolCalendar | null, today: string, fmt: (d: string) => string = (d) => d): string {
  if (!cal) return '';
  const w = weekOf(cal, today), last = cal.terms[cal.terms.length - 1];
  if (w?.kind === 'week' && w.week) return w.term.name + ' · week ' + w.week + ' of ' + w.of;
  if (w?.kind === 'break') return w.term.name + ' · study break';
  if (w?.kind === 'exams') return w.term.name + ' · exams';
  const next = cal.terms.find((t) => t.start > today);
  if (next) return next.name + ' starts ' + fmt(next.start);
  return 'Ended with ' + last.name;
}
