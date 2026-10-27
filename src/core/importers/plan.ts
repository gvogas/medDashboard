// Turn parsed .ics events or CSV rows into an import plan the preview can show:
// courses (existing or proposed) with the classes to add, and items to create.
// Nothing here writes; the import sheet saves the ticked rows after the preview.
//
// plan = {
//   courses: [{ id, code, name, color, isNew, meetings: [{ id, kind, weekday, start, end, room, until?, include }] }],
//   items:   [{ include, duplicate, row }],       row is ready for normalizeItem()
//   notes:   ['…'],                               what was trimmed or dropped, and why
// }

import { KINDS, HEXES, TYPES, uid, classEnd } from '../model.ts';
import { parse, DOW, iso, addDays, monday } from '../dates.ts';
import type { Course, Item, Meeting } from '../types.ts';
import type { IcsEvent } from './ics.ts';
import { MEETINGS_MAX } from '../shared.ts';

/** A CSV row, or one planOutline makes: a class from an outline has its kind and weekday. */
export interface ImportRow { type: string; course: string; courseName?: string; title: string; date: string; start: string; end: string; room?: string; weight: number | null; kind?: string; weekday?: number }

/** What the plan is checked against: the store's courses and items. */
export interface PlanData { courses?: (Pick<Course, 'id' | 'code' | 'name' | 'color' | 'meetings'> & { term?: string; archived?: boolean })[]; items?: Pick<Item, 'type' | 'title' | 'date' | 'start' | 'courseId' | 'recur' | 'weekday'>[] }

export interface PlanMeeting extends Meeting { include: boolean }
export interface PlanCourse {
  id: string; code: string; name: string; color: string; isNew: boolean; meetings: PlanMeeting[];
  /* the classes it already has, while planning */
  existing?: Meeting[];
  /* a new course from an outline: its teacher and whether to keep it with nothing ticked; term: the semester to save (a new course's, or the one picked for a course that exists; undefined leaves it as it is) */
  instructor?: string; term?: string; keep?: boolean;
  /* a class schedule: the course as the timetable named it, the classes yours already has, and whether
     the ticked classes replace them (true) or join them (false or unset) */
  read?: { code: string; name: string }; had?: Meeting[]; replace?: boolean;
}
/** An item to create, ready for normalizeItem(). */
export interface PlanRow { type: string; title: string; courseId: string | null; date: string; start: string; end: string; where: string; status: string; weight: number | null; recur?: 'weekly'; weekday?: number }
/** An item to create; against a class (src/data/class-import.ts), `match` is the class's item it would change and `was` what that item says now. */
export interface PlanItem { include: boolean; duplicate?: boolean; week?: number; row: PlanRow; match?: string; was?: string }
export interface Plan { courses: PlanCourse[]; items: PlanItem[]; notes: string[]; week1?: string; termStart?: string; kind?: 'outline' | 'schedule'; outline?: Outline }

/** A course outline as the Worker reads it (worker/outline.js). */
export interface Outline {
  code?: string; name?: string; instructor?: string; term?: string; termStart?: string; truncated?: boolean;
  classes: { kind: string; weekday: number; start: string; end: string; room: string }[];
  officeHours?: { weekday: number; start: string; end: string; room?: string }[];
  assessments: { type: string; title: string; date?: string; week?: number; start: string; end: string; room?: string; weight: number | null }[];
}

/** A class schedule as the Worker reads it (worker/schedule.js). */
export interface Schedule {
  term?: string; truncated?: boolean;
  courses: { code: string; name: string; classes: { kind: string; weekday: number; start: string; end: string; room: string }[] }[];
}

/* A class or a single item on its way into the plan. */
interface PlanClass { code: string; name: string; title: string; weekdays: number[]; start: string; end: string; room?: string; kind: string; until: string }
interface PlanSingle { code: string; name?: string; explicit: boolean; title: string; date: string; start: string; end: string; room?: string; weight: number | null; type: string }

const ITEM_TYPES = Object.keys(TYPES);
const CLASS_TYPES: Record<string, string> = { class: 'Lecture', lecture: 'Lecture', seminar: 'Seminar', tutorial: 'Tutorial', pbl: 'PBL', clinical: 'Clinical' };

export function guessKind(text: unknown): string {
  const t = String(text).toLowerCase();
  if (/\bpbl\b|problem[- ]based/.test(t)) return 'PBL';
  if (/\blab\b|laborator|practical/.test(t)) return 'Lab';
  if (/tutorial|\btut\b/.test(t)) return 'Tutorial';
  if (/seminar/.test(t)) return 'Seminar';
  if (/clinic|ward|placement|bedside/.test(t)) return 'Clinical';
  return 'Lecture';
}

export function guessType(text: unknown): string {
  const t = String(text).toLowerCase();
  if (/\bquiz(zes)?\b/.test(t)) return 'quiz';
  if (/\b(exam|osce|test|midterm|mid-term|final)s?\b/.test(t)) return 'exam';
  if (/\b(due|assignment|essay|submission|deadline)\b/.test(t)) return 'assignment';
  if (/\b(lab|practical)\b/.test(t)) return 'lab';
  return 'task';
}

/** The course code a summary starts with: its first word, upper-cased, at most 8 characters. */
export function codeToken(summary: unknown): string {
  const m = String(summary).trim().match(/^[A-Za-z0-9][A-Za-z0-9-]*/);
  return m ? m[0].toUpperCase().slice(0, 8) : '';
}

const clip = (s: unknown, n: number) => String(s || '').trim().slice(0, n);

/**
 * events: from parseIcs or parseCsv; a calendar event is told from a row by its `summary`.
 * data:   the store's { courses, items }.
 */
export function planImport(events: (IcsEvent | ImportRow)[], data: PlanData): Plan {
  const notes: string[] = [];
  const byCode = new Map<string, PlanCourse>();          /* CODE → plan course */
  const courses: PlanCourse[] = [];
  const existing = data.courses || [];

  const findCourse = (code: string) => {
    if (!code) return null;
    if (byCode.has(code)) return byCode.get(code);
    const hit = existing.find((c) => c.code.toUpperCase() === code);
    if (!hit) return null;
    const pc: PlanCourse = { id: hit.id, code: hit.code, name: hit.name, color: hit.color, isNew: false, meetings: [], existing: hit.meetings || [] };
    byCode.set(code, pc); courses.push(pc);
    return pc;
  };
  const proposeCourse = (code: string, name: string | undefined) => {
    const pc: PlanCourse = {
      id: uid(), code, name: clip(name || code, 80), isNew: true, meetings: [], existing: [],
      color: HEXES[(existing.length + courses.filter((c) => c.isNew).length) % HEXES.length],
    };
    byCode.set(code, pc); courses.push(pc);
    return pc;
  };

  const classes: PlanClass[] = [], singles: PlanSingle[] = [];
  /* each event is a CSV or outline row, or a calendar event (only it has a summary) */
  for (const ev of events) {
    if (!('summary' in ev)) {
      const t = ev.type;
      const weekday = Number.isInteger(ev.weekday) ? ev.weekday as number : ev.date ? parse(ev.date).getDay() : -1;
      if (CLASS_TYPES[t] && weekday >= 0) classes.push({ code: clip(ev.course, 8).toUpperCase(), name: ev.courseName || ev.course, title: ev.title, weekdays: [weekday], start: ev.start, end: ev.end, room: ev.room, kind: KINDS.includes(ev.kind as string) ? ev.kind as string : t === 'class' ? guessKind(ev.title) : CLASS_TYPES[t], until: '' });
      else if (ev.title && ev.date) singles.push({ code: clip(ev.course, 8).toUpperCase(), name: ev.courseName, explicit: !!ev.course, title: ev.title, date: ev.date, start: ev.start, end: ev.end, room: ev.room, weight: ev.weight, type: ITEM_TYPES.includes(t) ? t : guessType(ev.title) });
      else notes.push('Skipped a row without a title or a readable date.');
    } else if (ev.weekly) {
      const code = codeToken(ev.summary);
      const rest = ev.summary.trim().slice(code.length).trim();
      /* a class is weekly with no end date, so every 2 weeks cannot be said: skipped, not made weekly */
      if (ev.interval > 1) { notes.push('Skipped ' + clip(ev.summary, 60) + ': it repeats every ' + ev.interval + ' weeks, and classes can only repeat weekly.'); continue; }
      classes.push({ code, name: rest || ev.summary, title: ev.summary, weekdays: ev.weekdays, start: ev.start, end: ev.end, room: ev.location, kind: guessKind(ev.summary), until: ev.until });
    } else {
      singles.push({ code: codeToken(ev.summary), explicit: false, title: ev.summary, date: ev.date, start: ev.start, end: ev.end, room: ev.location, weight: null, type: guessType(ev.summary) });
    }
  }

  for (const cl of classes) {
    if (!cl.code) { notes.push('Skipped a class with no course code: ' + clip(cl.title, 60) + '.'); continue; }
    if (!cl.start) { notes.push('Skipped a class with no start time: ' + clip(cl.title, 60) + '.'); continue; }
    const pc = findCourse(cl.code) || proposeCourse(cl.code, cl.name);
    for (const weekday of cl.weekdays) {
      /* as saved, so a class already imported without an end is known again; a different last day is still the same class */
      const end = classEnd(cl.start, cl.end);
      const same = (m: Meeting) => m.weekday === weekday && m.start === cl.start && m.end === end;
      if (pc.existing!.some(same) || pc.meetings.some(same)) continue;
      if (pc.existing!.length + pc.meetings.length >= MEETINGS_MAX) {
        notes.push(pc.code + ' already has ' + MEETINGS_MAX + ' classes; dropped ' + DOW[weekday] + ' ' + cl.start + '.');
        continue;
      }
      pc.meetings.push({ id: uid(), kind: KINDS.includes(cl.kind) ? cl.kind : 'Lecture', weekday, start: cl.start, end, room: clip(cl.room, 40), ...(cl.until ? { until: cl.until } : {}), include: true });
    }
  }

  const seen = new Set((data.items || []).map((it) => [it.courseId || '', it.title.trim().toLowerCase(), it.date].join('|')));
  const items: PlanItem[] = [];
  for (const s of singles) {
    const pc = s.code ? (findCourse(s.code) || (s.explicit ? proposeCourse(s.code, s.name || s.code) : null)) : null;
    const courseId = pc ? pc.id : null;
    const title = clip(s.title, 140);
    if (s.title.trim().length > 140) notes.push('Shortened a title to 140 characters: ' + clip(s.title, 40) + '….');
    const key = [courseId || '', title.toLowerCase(), s.date].join('|');
    const duplicate = seen.has(key);
    seen.add(key);
    items.push({
      include: !duplicate, duplicate,
      row: { type: s.type, title, courseId, date: s.date, start: s.start, end: s.start && s.end > s.start ? s.end : '', where: clip(s.room, 80), status: 'todo', weight: s.weight },
    });
  }

  for (const pc of courses) delete pc.existing;
  return { courses: courses.filter((c) => c.isNew || c.meetings.length || items.some((i) => i.row.courseId === c.id)), items, notes };
}

/** The Monday of week `n`, counting the week that contains `week1` as week 1. */
export function weekDate(week1: string, n: number): string {
  return iso(addDays(monday(parse(week1)), (n - 1) * 7));
}

/** The first date on or after `from` that falls on `weekday`. */
function onOrAfter(from: string, weekday: number): string {
  let d = parse(from);
  for (let i = 0; i < 7 && d.getDay() !== weekday; i++) d = addDays(d, 1);
  return iso(d);
}

/**
 * A course outline read by the Worker (worker/outline.js) → the same plan.
 * Classes become meetings; office hours become weekly office-hours items; assessments
 * with a date become items. Assessments given only as "Week N" are dated from week 1
 * (plan.week1: the profile's term start, else the outline's) — the Monday of that
 * week, so nothing is shown later than it is — and wait unticked until week 1 is known.
 * Assessments with neither are listed in the notes.
 */
export function planOutline(o: Outline, data: PlanData, termStart = ''): Plan {
  const code = (o.code || String(o.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'NEW').toUpperCase().slice(0, 8);
  const name = o.name || code;
  const rows: ImportRow[] = [
    ...o.classes.map((c) => ({ type: 'class', kind: c.kind, weekday: c.weekday, course: code, courseName: name, title: c.kind, date: '', start: c.start, end: c.end, room: c.room, weight: null })),
    ...o.assessments.filter((a) => a.date).map((a) => ({ type: a.type, course: code, courseName: name, title: a.title, date: a.date as string, start: a.start, end: a.end, room: a.room, weight: a.weight })),
  ];
  const plan = planImport(rows, data);
  let pc = plan.courses.find((c) => c.code.toUpperCase() === code);
  if (!pc) {
    /* nothing dated and no classes: still offer the course itself, or use the one that exists */
    const live = (data.courses || []).find((c) => c.code.toUpperCase() === code);
    pc = live
      ? { id: live.id, code: live.code, name: live.name, color: live.color, isNew: false, meetings: [] }
      : { id: uid(), code, name: name.slice(0, 80), isNew: true, meetings: [], color: HEXES[(data.courses || []).length % HEXES.length] };
    plan.courses.push(pc);
  }
  if (pc.isNew) { pc.instructor = o.instructor || ''; pc.term = o.term || ''; pc.name = name.slice(0, 80); pc.keep = true; }
  else pc.term = (data.courses || []).find((c) => c.id === pc!.id)?.term ?? '';

  plan.week1 = termStart || o.termStart || '';
  const from = plan.week1 || iso(new Date());
  const items = data.items || [];
  for (const h of o.officeHours || []) {
    const same = items.some((it) => it.type === 'office' && it.courseId === pc.id && it.recur === 'weekly' && it.weekday === h.weekday && it.start === h.start);
    plan.items.push({
      include: !same, duplicate: same,
      row: {
        type: 'office', title: (o.instructor ? o.instructor + ' — office hours' : 'Office hours').slice(0, 140), courseId: pc.id,
        date: onOrAfter(from, h.weekday), start: h.start, end: h.end, where: h.room || '', status: 'todo',
        recur: 'weekly', weekday: h.weekday, weight: null,
      },
    });
  }
  for (const a of o.assessments.filter((x) => !x.date && x.week)) {
    plan.items.push({
      include: !!plan.week1, duplicate: false, week: a.week,
      row: { type: a.type, title: a.title, courseId: pc.id, date: plan.week1 ? weekDate(plan.week1, a.week!) : '', start: a.start, end: a.end, where: a.room || '', status: 'todo', weight: a.weight },
    });
  }
  const undated = o.assessments.filter((a) => !a.date && !a.week);
  if (undated.length) {
    plan.notes.push('No date in the outline for: ' + undated.map((a) => a.title + (a.weight ? ' (' + a.weight + '%)' : '')).join(', ') + '. Add them from the board once you know the dates.');
  }
  plan.termStart = o.termStart || '';
  if (o.truncated) plan.notes.push('The outline was long, so only the first part was read. Check the end of it by hand.');
  plan.kind = 'outline';
  return plan;
}

/** Set week 1 and date every week-numbered item from it; newly dated ones get ticked. */
export function setWeek1(plan: Plan, week1: string | null | undefined): void {
  plan.week1 = week1 || '';
  for (const it of plan.items) {
    if (!it.week) continue;
    const had = !!it.row.date;
    it.row.date = plan.week1 ? weekDate(plan.week1, it.week) : '';
    if (!had && it.row.date) it.include = true;
    if (!it.row.date) it.include = false;
  }
}

/** "3 new courses · 14 classes · 9 items", counting only what is ticked. */
export function planSummary(plan: Plan): string {
  const nc = plan.courses.filter((c) => c.isNew && (c.keep || c.meetings.some((m) => m.include) || plan.items.some((i) => i.include && i.row.courseId === c.id))).length;
  const nm = plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length, 0);
  const ni = plan.items.filter((i) => i.include).length;
  const part = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
  return [nc ? part(nc, 'new course', 'new courses') : '', part(nm, 'class', 'classes'), part(ni, 'item', 'items')].filter(Boolean).join(' · ');
}

/**
 * A class schedule read by the Worker → the plan: each course read matched to one of yours
 * by code, else by name ("Matches your course"), or proposed ("New course"); its classes as
 * meetings, ticked. Codes are compared without case or spaces, so a course the timetable
 * lists twice ("MATH 205", "math205") becomes one course with both lists of classes.
 * A course read with no code and no match gets a code made from its name ("Waves" → WAVE),
 * with a digit added when one of yours or another course in this read has it already (WAVE2),
 * so two new courses never merge and a new one never lands in a course of yours by chance;
 * the same name read twice gets the same code.
 * planImport leaves out the classes a course already has, or that it lists twice, and keeps
 * a course to 12. A course that matches one of yours is listed even when all its classes are
 * there, so that its semester can still be set (it keeps its own `term` until then); a new
 * course is listed only when it has a class to add, and gets `term`.
 */
export function planSchedule(s: Schedule, data: PlanData, term = ''): Plan {
  const existing = data.courses || [];
  const notes: string[] = [];
  const courses: PlanCourse[] = [];
  /* the codes a made-up one must not take: yours, and those read with a course */
  const used = new Set([...existing.map((x) => codeKey(x.code)), ...s.courses.map((c) => codeKey(c.code).slice(0, 8)).filter(Boolean)]);
  const made = new Map<string, string>();               /* name → the code made for it */
  const makeCode = (name: string) => {
    const n = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (made.has(n)) return made.get(n)!;
    const base = (String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'NEW').toUpperCase();
    let code = base;
    for (let i = 2; used.has(code); i++) code = base.slice(0, 8 - String(i).length) + i;
    used.add(code); made.set(n, code);
    return code;
  };
  for (const c of s.courses) {
    const read = { code: codeKey(c.code).slice(0, 8) || makeCode(c.name), name: clip(c.name || c.code, 80) };
    const live = matchCourse(read, existing.filter((x) => !x.archived));
    /* one timetable course twice (its rows apart), or two put on one of yours: the second's classes join the first's */
    const pc = courses.find((p) => p.read?.code === read.code || (live && p.id === live.id)) || planned(read, live, existing, courses, term);
    for (const k of c.classes) {
      if (!k.start || !(k.weekday >= 0)) { notes.push('Skipped a class of ' + read.code + ' with no day or start time.'); continue; }
      const end = classEnd(k.start, k.end);
      if (pc.meetings.some((m) => m.weekday === k.weekday && m.start === k.start && m.end === end)) continue;
      if (pc.meetings.length >= MEETINGS_MAX) { notes.push(pc.code + ' already has ' + MEETINGS_MAX + ' classes; dropped ' + DOW[k.weekday] + ' ' + k.start + '.'); continue; }
      pc.meetings.push({ id: uid(), kind: KINDS.includes(k.kind) ? k.kind : 'Lecture', weekday: k.weekday, start: k.start, end, room: clip(k.room, 40), include: true });
    }
  }
  for (const pc of courses) settle(pc);
  if (s.truncated) notes.push('The timetable was long, so only the first part was read. Check the last courses by hand.');
  return { courses, items: [], notes, kind: 'schedule' };
}

type Mine = NonNullable<PlanData['courses']>[number];

/* A plan course for what the timetable read: on the course of yours it matched, or a new one. */
function planned(read: { code: string; name: string }, live: Mine | null, existing: Mine[], courses: PlanCourse[], term: string): PlanCourse {
  const pc: PlanCourse = live
    ? { id: live.id, code: live.code, name: live.name, color: live.color, isNew: false, meetings: [], had: live.meetings || [], term: live.term ?? '', read }
    : { id: uid(), code: read.code, name: read.name || read.code, color: HEXES[(existing.length + courses.filter((c) => c.isNew).length) % HEXES.length], isNew: true, meetings: [], had: [], term, read };
  courses.push(pc);
  return pc;
}

const sameMeeting = (a: Meeting, b: Meeting) => a.weekday === b.weekday && a.start === b.start && a.end === b.end;

/**
 * Once the timetable's classes are in, or the course they go to was changed: a course of yours
 * whose classes are not the timetable's is offered to have them replaced (on: the timetable was
 * read just now). Every class starts ticked, but none at all when yours has exactly these already.
 */
function settle(pc: PlanCourse) {
  const had = pc.had || [];
  const same = had.length === pc.meetings.length && had.every((h) => pc.meetings.some((m) => sameMeeting(h, m)));
  pc.replace = !pc.isNew && had.length > 0 && !same ? true : undefined;
  for (const m of pc.meetings) m.include = !same;
}

/**
 * Put the timetable's course at index `i` on another of your courses (`id`), or on a new one
 * (null), as picked in the preview. Its classes stay as they are, and so does the name the
 * timetable gave it; whether they replace yours is worked out again.
 */
export function remapCourse(plan: Plan, i: number, id: string | null, data: PlanData): Plan {
  const pc = plan.courses[i], existing = data.courses || [];
  const read = pc.read || { code: pc.code, name: pc.name };
  const live = id ? existing.find((x) => x.id === id) : null;
  const next: PlanCourse = live
    ? { ...pc, read, id: live.id, code: live.code, name: live.name, color: live.color, isNew: false, had: live.meetings || [], term: live.term ?? '' }
    : { ...pc, read, id: pc.isNew ? pc.id : uid(), code: read.code, name: read.name || read.code, isNew: true, had: [],
        color: pc.isNew ? pc.color : HEXES[(existing.length + plan.courses.filter((c) => c.isNew).length) % HEXES.length] };
  settle(next);
  return { ...plan, courses: plan.courses.map((c, k) => (k === i ? next : c)) };
}

/** A course code to compare: upper case, letters and digits only ("420-541-VA" and "420541va" are one). */
export const codeKey = (code: unknown) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* A name's words to compare: no case, accents or punctuation, a plural "s" off ("Networks" is "Network"). */
const words = (name: unknown) => String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

/* "prog" and "programming": one word the start of the other, 3 letters at least; numbers only the same */
const wordsMeet = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && !/\d/.test(a + b) && (a.startsWith(b) || b.startsWith(a)));

/**
 * How surely a course read from a timetable is one of yours, 0 to 1. The same code is 1 (dashes,
 * spaces and case aside, or one the start of the other: "420541VA" and "420-541"); else the
 * names word by word, each word allowed to be the start of the other's ("Game Prog" and "Game
 * Programming 2", "Advanced Network" and "Advanced Networks"): the share of the shorter name's
 * words found in the longer, so an abbreviation scores as high as the full name. One word in
 * common is not enough, unless each name is that one word.
 */
export function courseScore(read: { code?: string; name?: string }, mine: { code?: string; name?: string }): number {
  const a = codeKey(read.code), b = codeKey(mine.code);
  if (a && b && (a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))))) return 1;
  const x = words(read.name), y = words(mine.name);
  if (!x.length || !y.length) return 0;
  /* "IoT" and "IoT: Internet of Things": a title before its colon; "IoT" and "Internet of Things": the initials */
  const head = (n: unknown) => words(String(n || '').split(':')[0]).join(' ')
  const initials = (ws: string[]) => ws.map((w) => w[0]).join('')
  const one = (a: string[], bName: unknown, b: string[]) => a.length === 1 && a[0].length >= 2 && (a[0] === head(bName) || (b.length >= 2 && a[0] === initials(b)) || a[0] === initials(words(String(bName || '').split(':').pop())))
  if (one(x, mine.name, y) || one(y, read.name, x)) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const hits = short.filter((w) => long.some((v) => wordsMeet(w, v))).length;
  if (hits < 2 && !(short.length === 1 && long.length === 1)) return hits ? 0.4 : 0;
  return hits / short.length;
}

/** The course of yours a timetable's course is: the surest at 0.75 or more, a matching code first; else null. */
export function matchCourse<C extends { code?: string; name?: string }>(read: { code?: string; name?: string }, mine: C[]): C | null {
  const byCode = mine.find((c) => courseScore({ code: read.code }, { code: c.code }) === 1);
  if (byCode) return byCode;
  let best: C | null = null, top = 0.75;
  for (const c of mine) {
    const score = courseScore(read, c);
    if (score > top || (!best && score >= top)) { best = c; top = score; }
  }
  return best;
}
