// Turn parsed .ics events or CSV rows into an import plan the preview can show:
// courses (existing or proposed) with the classes to add, and items to create.
// Nothing here writes; main.js saves the ticked rows after the preview.
//
// plan = {
//   courses: [{ id, code, name, color, isNew, meetings: [{ id, kind, weekday, start, end, room, include }] }],
//   items:   [{ include, duplicate, row }],       row is ready for normalizeItem()
//   notes:   ['…'],                               what was trimmed or dropped, and why
// }

import { KINDS, HEXES, TYPES, uid } from '../model.js';
import { parse, DOW, iso, addDays, monday } from '../dates.js';

const MAX_MEETINGS = 12;
const ITEM_TYPES = Object.keys(TYPES);
const CLASS_TYPES = { class: 'Lecture', lecture: 'Lecture', seminar: 'Seminar', tutorial: 'Tutorial', pbl: 'PBL', clinical: 'Clinical' };

export function guessKind(text) {
  const t = String(text).toLowerCase();
  if (/\bpbl\b|problem[- ]based/.test(t)) return 'PBL';
  if (/\blab\b|laborator|practical/.test(t)) return 'Lab';
  if (/tutorial|\btut\b/.test(t)) return 'Tutorial';
  if (/seminar/.test(t)) return 'Seminar';
  if (/clinic|ward|placement|bedside/.test(t)) return 'Clinical';
  return 'Lecture';
}

export function guessType(text) {
  const t = String(text).toLowerCase();
  if (/\bquiz(zes)?\b/.test(t)) return 'quiz';
  if (/\b(exam|osce|test|midterm|mid-term|final)s?\b/.test(t)) return 'exam';
  if (/\b(due|assignment|essay|submission|deadline)\b/.test(t)) return 'assignment';
  if (/\b(lab|practical)\b/.test(t)) return 'lab';
  return 'task';
}

/** The course code a summary starts with: its first word, upper-cased, at most 8 characters. */
export function codeToken(summary) {
  const m = String(summary).trim().match(/^[A-Za-z0-9][A-Za-z0-9-]*/);
  return m ? m[0].toUpperCase().slice(0, 8) : '';
}

const clip = (s, n) => String(s || '').trim().slice(0, n);

/**
 * events: from parseIcs (source 'ics') or parseCsv (source 'csv').
 * data:   the store's { courses, items }.
 */
export function planImport(events, data, source) {
  const notes = [];
  const byCode = new Map();          /* CODE → plan course */
  const courses = [];
  const existing = data.courses || [];

  const findCourse = (code) => {
    if (!code) return null;
    if (byCode.has(code)) return byCode.get(code);
    const hit = existing.find((c) => c.code.toUpperCase() === code);
    if (!hit) return null;
    const pc = { id: hit.id, code: hit.code, name: hit.name, color: hit.color, isNew: false, meetings: [], existing: hit.meetings || [] };
    byCode.set(code, pc); courses.push(pc);
    return pc;
  };
  const proposeCourse = (code, name) => {
    const pc = {
      id: uid(), code, name: clip(name || code, 80), isNew: true, meetings: [], existing: [],
      color: HEXES[(existing.length + courses.filter((c) => c.isNew).length) % HEXES.length],
    };
    byCode.set(code, pc); courses.push(pc);
    return pc;
  };

  const classes = [], singles = [];
  for (const ev of events) {
    if (source === 'csv') {
      const t = ev.type;
      const weekday = Number.isInteger(ev.weekday) ? ev.weekday : ev.date ? parse(ev.date).getDay() : -1;
      if (CLASS_TYPES[t] && weekday >= 0) classes.push({ code: clip(ev.course, 8).toUpperCase(), name: ev.courseName || ev.course, title: ev.title, weekdays: [weekday], start: ev.start, end: ev.end, room: ev.room, kind: KINDS.includes(ev.kind) ? ev.kind : t === 'class' ? guessKind(ev.title) : CLASS_TYPES[t] });
      else if (ev.title && ev.date) singles.push({ code: clip(ev.course, 8).toUpperCase(), name: ev.courseName, explicit: !!ev.course, title: ev.title, date: ev.date, start: ev.start, end: ev.end, room: ev.room, weight: ev.weight, type: ITEM_TYPES.includes(t) ? t : guessType(ev.title) });
      else notes.push('Skipped a row without a title or a readable date.');
    } else if (ev.weekly) {
      const code = codeToken(ev.summary);
      const rest = ev.summary.trim().slice(code.length).trim();
      classes.push({ code, name: rest || ev.summary, title: ev.summary, weekdays: ev.weekdays, start: ev.start, end: ev.end, room: ev.location, kind: guessKind(ev.summary) });
    } else {
      singles.push({ code: codeToken(ev.summary), explicit: false, title: ev.summary, date: ev.date, start: ev.start, end: ev.end, room: ev.location, weight: null, type: guessType(ev.summary) });
    }
  }

  for (const cl of classes) {
    if (!cl.code) { notes.push('Skipped a class with no course code: ' + clip(cl.title, 60) + '.'); continue; }
    if (!cl.start) { notes.push('Skipped a class with no start time: ' + clip(cl.title, 60) + '.'); continue; }
    const pc = findCourse(cl.code) || proposeCourse(cl.code, cl.name);
    for (const weekday of cl.weekdays) {
      const end = cl.end && cl.end > cl.start ? cl.end : cl.start;
      const same = (m) => m.weekday === weekday && m.start === cl.start && m.end === end;
      if (pc.existing.some(same) || pc.meetings.some(same)) continue;
      if (pc.existing.length + pc.meetings.length >= MAX_MEETINGS) {
        notes.push(pc.code + ' already has 12 classes; dropped ' + DOW[weekday] + ' ' + cl.start + '.');
        continue;
      }
      pc.meetings.push({ id: uid(), kind: KINDS.includes(cl.kind) ? cl.kind : 'Lecture', weekday, start: cl.start, end, room: clip(cl.room, 40), include: true });
    }
  }

  const seen = new Set((data.items || []).map((it) => [it.courseId || '', it.title.trim().toLowerCase(), it.date].join('|')));
  const items = [];
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
export function weekDate(week1, n) {
  return iso(addDays(monday(parse(week1)), (n - 1) * 7));
}

/** The first date on or after `from` that falls on `weekday`. */
function onOrAfter(from, weekday) {
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
export function planOutline(o, data, termStart = '') {
  const code = (o.code || String(o.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'NEW').toUpperCase().slice(0, 8);
  const name = o.name || code;
  const rows = [
    ...o.classes.map((c) => ({ type: 'class', kind: c.kind, weekday: c.weekday, course: code, courseName: name, title: c.kind, date: '', start: c.start, end: c.end, room: c.room, weight: null })),
    ...o.assessments.filter((a) => a.date).map((a) => ({ type: a.type, course: code, courseName: name, title: a.title, date: a.date, start: a.start, end: a.end, room: a.room, weight: a.weight })),
  ];
  const plan = planImport(rows, data, 'csv');
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
      row: { type: a.type, title: a.title, courseId: pc.id, date: plan.week1 ? weekDate(plan.week1, a.week) : '', start: a.start, end: a.end, where: a.room || '', status: 'todo', weight: a.weight },
    });
  }
  const undated = o.assessments.filter((a) => !a.date && !a.week);
  if (undated.length) {
    plan.notes.push('No date in the outline for: ' + undated.map((a) => a.title + (a.weight ? ' (' + a.weight + '%)' : '')).join(', ') + '. Add them from the board once you know the dates.');
  }
  plan.termStart = o.termStart || '';
  if (o.truncated) plan.notes.push('The outline was long, so only the first part was read. Check the end of it by hand.');
  return plan;
}

/** Set week 1 and date every week-numbered item from it; newly dated ones get ticked. */
export function setWeek1(plan, week1) {
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
export function planSummary(plan) {
  const nc = plan.courses.filter((c) => c.isNew && (c.keep || c.meetings.some((m) => m.include) || plan.items.some((i) => i.include && i.row.courseId === c.id))).length;
  const nm = plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length, 0);
  const ni = plan.items.filter((i) => i.include).length;
  const part = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  return [nc ? part(nc, 'new course', 'new courses') : '', part(nm, 'class', 'classes'), part(ni, 'item', 'items')].filter(Boolean).join(' · ');
}
