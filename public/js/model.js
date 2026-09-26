// What the app knows about itself: the eight built-in types and the person's own,
// their status sets, the course colours, and the derived predicates. Nothing here
// touches the DOM or storage; the type list is read through a getter main.js sets.

import { diffDays, today, parse, addDays, iso } from './dates.js';

export const TYPES = {
  exam:       { label: 'Exam',         plural: 'Exams',        color: '#C0392B' },
  quiz:       { label: 'Quiz',         plural: 'Quizzes',      color: '#B03A7A' },
  assignment: { label: 'Assignment',   plural: 'Assignments',  color: '#B77505' },
  lab:        { label: 'Lab',          plural: 'Labs',         color: '#1E628F' },
  tutoring:   { label: 'Tutorial',     plural: 'Tutorials',    color: '#5A46A8' },   /* key kept for stored rows */
  office:     { label: 'Office hours', plural: 'Office hours', color: '#4C7370' },
  task:       { label: 'Task',         plural: 'Tasks',        color: '#0E7C74' },
  project:    { label: 'Project',      plural: 'Projects',     color: '#C2571A' },
};
export const ORDER = ['exam', 'quiz', 'assignment', 'lab', 'tutoring', 'office', 'project', 'task'];
export const STATUS = {
  exam:       [['todo', 'Upcoming'],  ['done', 'Taken'],         ['graded', 'Graded']],
  quiz:       [['todo', 'Upcoming'],  ['done', 'Taken'],         ['graded', 'Graded']],
  assignment: [['todo', 'Open'],      ['submitted', 'Submitted'], ['graded', 'Graded']],
  lab:        [['todo', 'Scheduled'], ['done', 'Attended'],      ['missed', 'Missed']],
  tutoring:   [['todo', 'Scheduled'], ['done', 'Attended'],      ['missed', 'Cancelled']],
  office:     [['todo', 'Planned'],   ['done', 'Went'],          ['missed', 'Skipped']],
  task:       [['todo', 'To do'],     ['done', 'Done']],
  project:    [['todo', 'In progress'], ['done', 'Shipped'],     ['missed', 'Dropped']],   /* milestones are the checklist */
};
/* Custom types behave like a built-in: its statuses, its weight field. */
export const TYPE_KINDS = [['todo', 'To-do', 'task'], ['event', 'Event', 'lab'], ['graded', 'Graded', 'assignment']];
export const TYPE_COLOURS = ['#C0392B', '#B77505', '#1E628F', '#5A46A8', '#4C7370', '#0E7C74', '#C2571A', '#B03A7A', '#3F7A2E', '#6B5B45'];
export const MAX_CUSTOM_TYPES = 12;
const CUSTOM_TYPE = /^c-[a-z0-9]{1,12}$/;
const FALLBACK = { label: 'Item', plural: 'Items', color: '#4C7370' };   /* a custom type this device has not heard of yet */

let prefsOf = () => [];
/** main.js points this at the profile's type list, so every view reads the current one. */
export function useTypePrefs(get) { prefsOf = get; }

function isTypeId(t) {
  return !!TYPES[t] || CUSTOM_TYPE.test(t);
}

export function pluralOf(label) {
  if (/iz$/i.test(label)) return label + 'zes';
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + 'es';
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + 'ies';
  return label + 's';
}

/**
 * Every type in sidebar order: { id, label, plural, color, kind, custom, hidden }.
 * Built-ins come from TYPES with the person's changes on top; a built-in missing
 * from the list keeps its default place. Projects are hidden on Med by default, and
 * Quizzes when the person has a Quiz type of their own, unless one already exists.
 */
export function typeList(bg, items = []) {
  const prefs = prefsOf() || [];
  const byId = new Map(prefs.map((p) => [p.id, p]));
  /* someone who made their own Quiz type before the built-in one keeps just theirs */
  const ownQuiz = prefs.some((p) => CUSTOM_TYPE.test(p.id) && /^quiz(zes)?$/i.test((p.label || '').trim()));
  const ids = prefs.map((p) => p.id).filter((id) => isTypeId(id));
  ORDER.forEach((id, i) => {
    if (byId.has(id)) return;
    const after = ORDER.slice(0, i).reverse().find((x) => ids.includes(x));
    ids.splice(after ? ids.indexOf(after) + 1 : 0, 0, id);
  });
  return ids.map((id) => {
    const p = byId.get(id) || {}, base = TYPES[id];
    const label = p.label || (base ? base.label : 'Item');
    return {
      id, label,
      plural: base && !p.label ? base.plural : pluralOf(label),
      color: p.color || (base ? base.color : FALLBACK.color),
      kind: base ? null : p.kind || 'todo',
      custom: !base,
      hiddenSet: p.hidden !== undefined,
      hidden: p.hidden !== undefined ? !!p.hidden
        : (id === 'project' && bg !== 'cs' || id === 'quiz' && ownQuiz) && !items.some((it) => it.type === id),
    };
  });
}

/**
 * The stored form of an edited list: every type in order, and for a built-in only
 * what differs from its default, so Projects still follow the background.
 */
export function typePrefsFrom(list) {
  return list.map((t) => {
    const base = TYPES[t.id];
    if (!base) return { id: t.id, label: t.label, color: t.color, kind: t.kind, hidden: !!t.hidden };
    const out = { id: t.id };
    if (t.label && t.label !== base.label) out.label = t.label;
    if (t.color && t.color !== base.color) out.color = t.color;
    if (t.hiddenSet) out.hidden = !!t.hidden;
    return out;
  });
}

/** The built-in a type behaves like: itself, or its kind's model. */
export function baseOf(t) {
  if (TYPES[t]) return t;
  const kind = (prefsOf() || []).find((p) => p.id === t)?.kind;
  return (TYPE_KINDS.find((k) => k[0] === kind) || TYPE_KINDS[0])[2];
}

export function statusesFor(t) {
  return STATUS[baseOf(t)] || STATUS.task;
}

const COMPLETE = { done: 1, graded: 1, submitted: 1 };   /* light-pink states */
const CLOSED = { done: 1, graded: 1, submitted: 1, missed: 1 };
export const KINDS = ['Lecture', 'Lab', 'Seminar', 'Tutorial', 'PBL', 'Clinical'];

/* the twelve course colours; the first five are also the coat colours */
export const PALETTE = [
  { name: 'Pink',         hex: '#E4749B' },
  { name: 'Purple',       hex: '#8B5CC7' },
  { name: 'Turquoise',    hex: '#17B3AE' },
  { name: 'Baby blue',    hex: '#79B6EA' },
  { name: 'Little lilac', hex: '#BCA6E6' },
  { name: 'Coral',        hex: '#F08A6C' },
  { name: 'Sunflower',    hex: '#E8B33A' },
  { name: 'Mint',         hex: '#4FBF8B' },
  { name: 'Sage',         hex: '#8FAE86' },
  { name: 'Royal blue',   hex: '#4F74D9' },
  { name: 'Berry',        hex: '#B8457E' },
  { name: 'Slate',        hex: '#7D8A99' },
];
export const COAT_PALETTE = PALETTE.slice(0, 5);
export const HEXES = PALETTE.map((p) => p.hex);
export const DEFAULT_COAT = '#17B3AE';

export function colourName(hex) {
  const p = PALETTE.find((x) => x.hex.toLowerCase() === String(hex).toLowerCase());
  return p ? p.name : 'Custom';
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/** Exams, quizzes, and any type of the person's own called a quiz, test or exam. */
export function isTest(t) {
  return t === 'exam' || t === 'quiz' || (!TYPES[t] && /\b(quiz|test|exam|midterm)/i.test(tmeta(t).label));
}

/**
 * Where an exam or quiz sits when it falls on a day the course meets: the room of
 * the class its time overlaps, else of that day's lecture, else of the day's first
 * class with a room. '' when there is none.
 */
export function classRoom(it, c) {
  if (!c || !isTest(it.type) || it.recur === 'weekly') return '';
  const day = parse(it.date).getDay();
  const held = (c.meetings || []).filter((m) => m.weekday === day && m.room)
    .sort((a, b) => a.start.localeCompare(b.start));
  const hit = held.find((m) => it.start && it.start >= m.start && it.start < m.end)
    || held.find((m) => m.kind === 'Lecture') || held[0];
  return hit ? hit.room : '';
}

export function tmeta(t) {
  const hit = typeList('cs').find((x) => x.id === t);
  return hit || (CUSTOM_TYPE.test(t) ? FALLBACK : TYPES.task);
}
export function statusLabel(it) {
  const list = statusesFor(it.type);
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
const minutes = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const clock = (m) => m >= 24 * 60 ? '23:59' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
/** An end that is not after the start becomes an hour after it, or none if the day has
   no room left: the server refuses it. */
const fixEnd = (start, end) => {
  if (!start || !end || end > start) return end;
  return start < '23:59' ? clock(minutes(start) + 60) : '';
};

/** The end after the start moves from `was` to `now`, keeping the length. */
export function shiftEnd(was, end, now) {
  if (!was || !end || !now) return end;
  return clock(Math.max(0, minutes(end) - minutes(was)) + minutes(now));
}

/* Text is cut to what the server stores (worker/validate.js): a longer value is refused,
   and a refused edit leaves the board for the conflicts list. */
const cut = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
/* A link the server takes. Browsers let a space into a host name; the server's URL
   parser does not, so that is refused here rather than trusted to `new URL`. */
export const httpUrl = (u) => {
  if (typeof u !== 'string' || u.length > 500 || !/^https?:\/\/[^\s/?#]+([/?#]|$)/i.test(u)) return false;
  try { new URL(u); return true; } catch { return false; }
};

export function normalizeItem(raw) {
  const date = raw.date || today(), start = raw.start || '';
  return {
    id: raw.id || uid(),
    type: isTypeId(raw.type) ? raw.type : 'task',
    title: cut(raw.title, 140),
    courseId: raw.courseId || raw.course || null,
    date,
    start,
    end: fixEnd(start, raw.end || ''),
    where: cut(raw.where, 80),
    status: raw.status || 'todo',
    grade: typeof raw.grade === 'number' ? raw.grade : null,
    weight: typeof raw.weight === 'number' ? raw.weight : null,
    notes: cut(raw.notes, 5000),
    checklist: Array.isArray(raw.checklist) ? raw.checklist.slice(0, 50).map((c) => ({ id: c.id || uid(), text: cut(c.text, 140), done: !!c.done })) : [],
    links: Array.isArray(raw.links)
      ? raw.links.filter((l) => l && httpUrl(l.url)).slice(0, 20).map((l) => ({ label: cut(l.label, 60), url: l.url }))
      : [],
    recur: raw.recur === 'weekly' ? 'weekly' : null,
    weekday: raw.recur === 'weekly' ? (Number.isInteger(raw.weekday) ? raw.weekday : parse(raw.date || today()).getDay()) : null,
    recurUntil: raw.recurUntil && raw.recurUntil >= date ? raw.recurUntil : null,
    dept: cut(raw.dept, 40),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}

export function normalizeCourse(raw, index = 0) {
  return {
    id: raw.id || uid(),
    code: (raw.code || '').slice(0, 8),
    name: cut(raw.name, 80),
    color: HEXES.includes(raw.color) ? raw.color : HEXES[index % HEXES.length],
    instructor: cut(raw.instructor, 60),
    term: cut(raw.term, 40),
    archived: !!raw.archived,
    target: Number.isInteger(raw.target) && raw.target >= 1 && raw.target <= 100 ? raw.target : null,
    meetings: Array.isArray(raw.meetings)
      ? raw.meetings.slice(0, 12).map((m) => {
          const start = m.start || '09:00';
          return {
            id: m.id || uid(),
            kind: KINDS.includes(m.kind) ? m.kind : 'Lecture',
            weekday: Number.isInteger(m.weekday) ? m.weekday : 1,
            /* the server refuses a class that ends when it starts: with no end, it lasts an hour */
            start, end: m.end && m.end > start ? m.end : clock(minutes(start) + 60),
            room: cut(m.room, 40),
          };
        })
      : [],
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}

export function normalizeQuote(raw) {
  return { id: raw.id || uid(), text: raw.text || '', source: raw.source || '', createdAt: raw.createdAt ?? null, revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null };
}

/* ── the study timer ── */
export const DEFAULT_FLOW = { steps: [['study', 25], ['break', 5]], rounds: 4 };
export const FLOW_PRESETS = [
  ['Classic 25/5', { steps: [['study', 25], ['break', 5]], rounds: 4 }],
  ['Deep 50/10', { steps: [['study', 50], ['break', 10]], rounds: 3 }],
  ['Anki then read', { steps: [['study', 20], ['break', 5], ['study', 40], ['break', 15]], rounds: 2 }],
];
const clampInt = (v, lo, hi, dflt) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : dflt;

/** A flow the server accepts: 1-12 steps of 1-180 minutes, at least one Study, 1-12 rounds. */
export function normalizeFlow(raw) {
  const steps = (Array.isArray(raw?.steps) ? raw.steps : [])
    .filter((s) => Array.isArray(s) && (s[0] === 'study' || s[0] === 'break'))
    .slice(0, 12)
    .map(([k, m]) => [k, clampInt(m, 1, 180, k === 'study' ? 25 : 5)]);
  if (!steps.some(([k]) => k === 'study')) return structuredClone(DEFAULT_FLOW);
  return { steps, rounds: clampInt(raw.rounds, 1, 12, 1) };
}

/* The study goal and streak rules: a daily goal in minutes (0 = none), the least that
   makes a day count toward the streak, rest days (0 = Sunday) that never break it, and
   whether to celebrate. The server keeps what it is given; this fills the gaps. */
const DEFAULT_PREFS = { goal: 0, dayMin: 15, rest: [], celebrate: true };
export function normalizePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const rest = Array.isArray(p.rest) ? [...new Set(p.rest.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort().slice(0, 6) : [];
  return {
    goal: clampInt(p.goal, 0, 720, DEFAULT_PREFS.goal),
    dayMin: clampInt(p.dayMin, 1, 240, DEFAULT_PREFS.dayMin),
    rest,
    celebrate: p.celebrate === undefined ? true : !!p.celebrate,
  };
}

export function normalizeStudySession(raw) {
  return {
    id: raw.id || uid(),
    courseId: raw.courseId || null,
    itemId: raw.itemId || null,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : Date.now(),
    studyMinutes: clampInt(raw.studyMinutes, 1, 1440, 1),
    roundsDone: clampInt(raw.roundsDone, 0, 12, 0),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '',
    manual: !!raw.manual,
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}

/* Your own achievement: a sticker picture, a name, and what earns it (see achievements.js). */
export const ACHIEVEMENT_LIMIT = 30;
export function normalizeAchievement(raw) {
  const rule = raw.rule === 'grade' ? 'grade' : 'hours';
  return {
    id: raw.id || uid(),
    name: cut(raw.name, 40),
    sticker: typeof raw.sticker === 'string' && raw.sticker.startsWith('data:image/') ? raw.sticker : '',
    rule,
    courseId: rule === 'hours' ? raw.courseId || null : null,
    itemId: rule === 'grade' ? raw.itemId || null : null,
    target: clampInt(raw.target, 1, rule === 'grade' ? 100 : 1000, rule === 'grade' ? 90 : 10),
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}
