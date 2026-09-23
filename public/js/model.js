// What the app knows about itself: the six types, their status sets, the five
// colours, and the derived predicates. Nothing here touches the DOM or storage.

import { diffDays, today, parse, addDays, iso } from './dates.js';

export const TYPES = {
  exam:       { label: 'Exam',         plural: 'Exams',        color: '#C0392B' },
  assignment: { label: 'Assignment',   plural: 'Assignments',  color: '#B77505' },
  lab:        { label: 'Lab',          plural: 'Labs',         color: '#1E628F' },
  tutoring:   { label: 'Tutorial',     plural: 'Tutorials',    color: '#5A46A8' },   /* key kept for stored rows */
  office:     { label: 'Office hours', plural: 'Office hours', color: '#4C7370' },
  task:       { label: 'Task',         plural: 'Tasks',        color: '#0E7C74' },
};
export const ORDER = ['exam', 'assignment', 'lab', 'tutoring', 'office', 'task'];
export const STATUS = {
  exam:       [['todo', 'Upcoming'],  ['done', 'Sat'],           ['graded', 'Graded']],
  assignment: [['todo', 'Open'],      ['submitted', 'Submitted'], ['graded', 'Graded']],
  lab:        [['todo', 'Scheduled'], ['done', 'Attended'],      ['missed', 'Missed']],
  tutoring:   [['todo', 'Scheduled'], ['done', 'Attended'],      ['missed', 'Cancelled']],
  office:     [['todo', 'Planned'],   ['done', 'Went'],          ['missed', 'Skipped']],
  task:       [['todo', 'To do'],     ['done', 'Done']],
};
const COMPLETE = { done: 1, graded: 1, submitted: 1 };   /* light-pink states */
const CLOSED = { done: 1, graded: 1, submitted: 1, missed: 1 };
export const KINDS = ['Lecture', 'Lab', 'Seminar', 'Tutorial', 'PBL', 'Clinical'];

/* the five course colours, which are also the coat colours */
export const PALETTE = [
  { name: 'Pink',         hex: '#E4749B' },
  { name: 'Purple',       hex: '#8B5CC7' },
  { name: 'Turquoise',    hex: '#17B3AE' },
  { name: 'Baby blue',    hex: '#79B6EA' },
  { name: 'Little lilac', hex: '#BCA6E6' },
];
export const HEXES = PALETTE.map((p) => p.hex);
export const DEFAULT_COAT = '#17B3AE';

export function colourName(hex) {
  const p = PALETTE.find((x) => x.hex.toLowerCase() === String(hex).toLowerCase());
  return p ? p.name : 'Custom';
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function tmeta(t) {
  return TYPES[t] || TYPES.task;
}
export function statusLabel(it) {
  const list = STATUS[it.type] || STATUS.task;
  const hit = list.find((p) => p[0] === it.status);
  return (hit || list[0])[1];
}
export function isOpen(it) {
  return !CLOSED[it.status];
}
export function isComplete(it) {
  return !!COMPLETE[it.status];
}
export function isOverdue(it) {
  return isOpen(it) && it.recur !== 'weekly' && diffDays(today(), it.date) < 0;
}
export function dueSoon(it) {
  const d = diffDays(today(), it.date);
  return isOpen(it) && d >= 0 && d <= 2;
}

/** Expand an item onto [from, to]: one entry, or one per week for a weekly slot. */
export function occurrences(it, from, to) {
  if (it.recur !== 'weekly') return it.date >= from && it.date <= to ? [{ item: it, date: it.date }] : [];
  const out = [];
  let d = parse(from), g = 0;
  while (d.getDay() !== it.weekday && g++ < 8) d = addDays(d, 1);
  while (iso(d) <= to && g++ < 400) {
    if (iso(d) >= it.date && (!it.recurUntil || iso(d) <= it.recurUntil)) out.push({ item: it, date: iso(d) });
    d = addDays(d, 7);
  }
  return out;
}

/** Fill every field the API expects, so views never meet `undefined`. */
export function normalizeItem(raw) {
  return {
    id: raw.id || uid(),
    type: TYPES[raw.type] ? raw.type : 'task',
    title: raw.title || '',
    courseId: raw.courseId || raw.course || null,
    date: raw.date || today(),
    start: raw.start || '',
    end: raw.end || '',
    where: raw.where || '',
    status: raw.status || 'todo',
    grade: typeof raw.grade === 'number' ? raw.grade : null,
    weight: typeof raw.weight === 'number' ? raw.weight : null,
    notes: raw.notes || '',
    checklist: Array.isArray(raw.checklist) ? raw.checklist.map((c) => ({ id: c.id || uid(), text: c.text || '', done: !!c.done })) : [],
    links: Array.isArray(raw.links)
      ? raw.links.filter((l) => l && /^https?:\/\//i.test(l.url || '')).map((l) => ({ label: l.label || '', url: l.url }))
      : [],
    recur: raw.recur === 'weekly' ? 'weekly' : null,
    weekday: raw.recur === 'weekly' ? (Number.isInteger(raw.weekday) ? raw.weekday : parse(raw.date || today()).getDay()) : null,
    recurUntil: raw.recurUntil || null,
    dept: raw.dept || '',
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}

export function normalizeCourse(raw, index = 0) {
  return {
    id: raw.id || uid(),
    code: (raw.code || '').slice(0, 8),
    name: raw.name || '',
    color: HEXES.includes(raw.color) ? raw.color : HEXES[index % HEXES.length],
    instructor: raw.instructor || '',
    term: raw.term || '',
    archived: !!raw.archived,
    meetings: Array.isArray(raw.meetings)
      ? raw.meetings.slice(0, 12).map((m) => ({
          id: m.id || uid(),
          kind: KINDS.includes(m.kind) ? m.kind : 'Lecture',
          weekday: Number.isInteger(m.weekday) ? m.weekday : 1,
          start: m.start || '09:00',
          end: m.end || '10:00',
          room: m.room || '',
        }))
      : [],
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}

export function normalizeQuote(raw) {
  return { id: raw.id || uid(), text: raw.text || '', source: raw.source || '', createdAt: raw.createdAt ?? null, revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null };
}
