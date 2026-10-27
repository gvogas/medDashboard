// Shape rules, mirroring migrations/0001_schema.sql and later, so a bad request gets a 400
// naming the field instead of a raw SQLite error. Each validator returns a clean
// object containing only known fields, in API (camelCase) shape.

import { HttpError } from './http.js';
import { SCHOOL_KINDS, SCHOOL_LIMITS, validDate } from '../src/core/school.ts';
import { CHECKLIST_MAX, MARK_DEFAULTS, MEETINGS_MAX, SHARED_FIELDS, STICKER_MAX, stable } from '../src/core/shared.ts';
import { MAX_CATEGORIES, MAX_DROP, MAX_PASS, MAX_STEPS } from '../src/core/grades.ts';

const COLOURS = ['#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6'];   /* the coat's */
export const COURSE_COLOURS = [...COLOURS, '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99'];
const TYPES = ['exam', 'quiz', 'assignment', 'lab', 'tutoring', 'office', 'task', 'project'];
const STATUSES = ['todo', 'submitted', 'graded', 'done', 'missed'];
// Custom item types: an id, and the swatches and behaviours a type can have.
const CUSTOM_TYPE = /^c-[a-z0-9]{1,12}$/;
const TYPE_COLOURS = ['#C0392B', '#B77505', '#1E628F', '#5A46A8', '#4C7370', '#0E7C74', '#C2571A', '#B03A7A', '#3F7A2E', '#6B5B45'];
const TYPE_KINDS = ['todo', 'event', 'graded'];
const KINDS = ['Lecture', 'Lab', 'Seminar', 'Tutorial', 'PBL', 'Clinical'];
const THEMES = ['light', 'dark', 'system'];
const BACKGROUNDS = ['med', 'cs', 'law', 'pilot', 'sports', 'eng'];
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

function fail(field) {
  throw new HttpError(400, { error: 'invalid', field });
}

function obj(v, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(field);
  return v;
}

function str(v, field, max, min = 0) {
  if (typeof v !== 'string' || v.length < min || v.length > max || v.includes('\0')) fail(field);
  return v;
}

function optStr(v, field, max) {
  return v === null || v === undefined ? null : str(v, field, max);
}

function bool(v, field) {
  if (typeof v !== 'boolean') fail(field);
  return v;
}

function oneOf(v, field, set) {
  if (!set.includes(v)) fail(field);
  return v;
}

function int(v, field, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) fail(field);
  return v;
}

function optNum(v, field, lo, hi) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(field);
  return v;
}

function optInt(v, field) {
  if (v === null || v === undefined) return null;
  if (!Number.isSafeInteger(v) || v < 0) fail(field);
  return v;
}

function date(v, field) {
  if (typeof v !== 'string' || !DATE.test(v)) fail(field);
  const parsed = new Date(`${v}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) fail(field);
  return v;
}

function optDate(v, field) {
  return v === null || v === undefined ? null : date(v, field);
}

function time(v, field) {
  if (typeof v !== 'string' || !TIME.test(v)) fail(field);
  return v;
}

function optTime(v, field) {
  if (v === null || v === undefined || v === '') return '';
  return time(v, field);
}

function list(v, field, max, each) {
  if (!Array.isArray(v) || v.length > max) fail(field);
  return v.map((entry, i) => each(obj(entry, `${field}[${i}]`), `${field}[${i}]`));
}

export const SPACE_ID = /^[a-z0-9]{12}$/;
/* A label on your own row naming a space (spec §5): its shape only, since it opens nothing.
   Absent (an old client) is undefined, and the stored value stays (spec §16); null clears. */
function spaceLabel(v, field) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !SPACE_ID.test(v)) fail(field);
  return v;
}

/* What you hid from your Week and Month (spec §9): 'course:<id>', 'space:<sid>', 'personal'. */
const SOURCE = /^(?:course:[^\u0000-\u001f\u007f]{1,24}|space:[a-z0-9]{12}|personal)$/;
function sourceList(v) {
  if (!Array.isArray(v) || v.length > 40) fail('hiddenSources');
  v.forEach((s, i) => { if (typeof s !== 'string' || !SOURCE.test(s)) fail(`hiddenSources[${i}]`); });
  if (new Set(v).size !== v.length) fail('hiddenSources');
  return v;
}

export function validateId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 24 || /[\u0000-\u001f\u007f]/.test(id)) fail('id');
  return id;
}

function itemType(v, field) {
  if (typeof v !== 'string' || !(TYPES.includes(v) || CUSTOM_TYPE.test(v))) fail(field);
  return v;
}

/* The type list: built-ins may be relabelled, recoloured or hidden; custom types
 * also need a kind. Order in the array is the order in the sidebar. */
function typeEntry(t, f) {
  if (typeof t.id !== 'string') fail(`${f}.id`);
  const custom = CUSTOM_TYPE.test(t.id);
  if (!custom && !TYPES.includes(t.id)) fail(`${f}.id`);
  const out = { id: t.id };
  const label = str(t.label ?? '', `${f}.label`, 24).trim();
  if (label) out.label = label;
  else if (custom) fail(`${f}.label`);
  if (t.color !== undefined && t.color !== null) out.color = oneOf(t.color, `${f}.color`, TYPE_COLOURS);
  else if (custom) fail(`${f}.color`);
  if (custom) out.kind = oneOf(t.kind, `${f}.kind`, TYPE_KINDS);
  // Left out, a built-in keeps its default (Projects follow the background).
  if (t.hidden !== undefined) out.hidden = bool(t.hidden, `${f}.hidden`);
  return out;
}

function typeList(v) {
  const out = list(v, 'types', 20, typeEntry);
  const seen = new Set();
  for (const [i, t] of out.entries()) {
    if (seen.has(t.id)) fail(`types[${i}].id`);
    seen.add(t.id);
  }
  if (out.filter((t) => t.kind).length > 12) fail('types');
  return out;
}

export function validateProfile(body) {
  obj(body, 'body');
  const coat = obj(body.coat, 'coat');
  return {
    displayName: str(body.displayName ?? '', 'displayName', 60),
    coatName: str(coat.name ?? '', 'coat.name', 28),
    coatRole: str(coat.role ?? '', 'coat.role', 34),
    coatColor: oneOf(coat.color, 'coat.color', COLOURS),
    theme: oneOf(body.theme, 'theme', THEMES),
    // Older clients do not send a background; they keep Med.
    bg: oneOf(body.bg ?? 'med', 'bg', BACKGROUNDS),
    termStart: optDate(body.termStart, 'termStart'),
    // Older clients do not send types; the stored list is kept (null here).
    types: body.types === undefined ? null : typeList(body.types),
    // Older clients do not send a flow; the stored one is kept (null here).
    studyFlow: body.studyFlow === undefined ? null : studyFlow(body.studyFlow),
    // Nor study prefs; the stored ones are kept (null here).
    studyPrefs: body.studyPrefs === undefined ? null : studyPrefs(body.studyPrefs),
    // Nor a school calendar; {} removes it.
    schoolCalendar: body.schoolCalendar === undefined ? null : schoolCalendar(body.schoolCalendar),
    // Nor hidden sources; the stored ones are kept (null here).
    hiddenSources: body.hiddenSources === undefined ? null : sourceList(body.hiddenSources),
    // Nor grading; the stored one is kept (null here), and {} goes back to the defaults.
    grading: body.grading === undefined ? null : grading(body.grading),
  };
}

/* How a person grades: a scale of letters, each from a percentage and worth grade points,
   and their pass marks. Either may be left out for the default (src/core/grades.ts). */
function grading(v) {
  obj(v, 'grading');
  const out = {};
  if (v.scale !== undefined) {
    out.scale = list(v.scale, 'grading.scale', MAX_STEPS, (s, f) => ({
      letter: str(s.letter, `${f}.letter`, 4, 1), min: optNum(s.min, `${f}.min`, 0, 100) ?? fail(`${f}.min`), points: optNum(s.points, `${f}.points`, 0, 10) ?? fail(`${f}.points`),
    }));
    if (new Set(out.scale.map((s) => s.min)).size !== out.scale.length) fail('grading.scale');
  }
  if (v.pass !== undefined) {
    if (!Array.isArray(v.pass) || v.pass.length > MAX_PASS) fail('grading.pass');
    out.pass = v.pass.map((p, i) => int(p, `grading.pass[${i}]`, 1, 100));
  }
  return out;
}

/* The school's academic calendar: semesters and special days (src/core/school.ts).
   An empty object is none. */
function schoolDate(v, field) {
  if (!validDate(v)) fail(field);
  return v;
}
export function schoolCalendar(v) {
  obj(v, 'schoolCalendar');
  if (!Object.keys(v).length) return {};
  if (!Array.isArray(v.terms) || v.terms.length < 1 || v.terms.length > SCHOOL_LIMITS.terms) fail('schoolCalendar.terms');
  if (!Array.isArray(v.days) || v.days.length > SCHOOL_LIMITS.days) fail('schoolCalendar.days');
  const terms = v.terms.map((t, i) => {
    const f = `schoolCalendar.terms[${i}]`;
    obj(t, f);
    const out = { name: str(t.name, f + '.name', SCHOOL_LIMITS.term, 1), start: schoolDate(t.start, f + '.start'), end: schoolDate(t.end, f + '.end') };
    if (out.end < out.start) fail(f + '.end');
    return out;
  });
  const days = v.days.map((d, i) => {
    const f = `schoolCalendar.days[${i}]`;
    obj(d, f);
    const out = { from: schoolDate(d.from, f + '.from'), to: schoolDate(d.to ?? d.from, f + '.to'), kind: oneOf(d.kind, f + '.kind', SCHOOL_KINDS), label: str(d.label ?? '', f + '.label', SCHOOL_LIMITS.label) };
    if (out.to < out.from) fail(f + '.to');
    if (out.kind === 'swap') out.follows = int(d.follows, f + '.follows', 0, 6);
    return out;
  });
  return { name: str(v.name ?? '', 'schoolCalendar.name', SCHOOL_LIMITS.name), terms, days };
}

/* The study goal and streak rules: minutes a day to aim for (0 = no goal), the least
   that makes a day count toward the streak, rest days (0 = Sunday) that never break
   it, whether to celebrate, whether the calendar feed carries reminders, the day spaced
   reviews were turned on (null = off; left out by clients from before reviews were kept here,
   so they cannot tell off from unknown), and setupDone, kept only when true: the first-run
   setup was finished or skipped. */
export function studyPrefs(v) {
  obj(v, 'studyPrefs');
  const rest = v.rest ?? [];
  if (!Array.isArray(rest) || rest.length > 6) fail('studyPrefs.rest');
  rest.forEach((d, i) => int(d, `studyPrefs.rest[${i}]`, 0, 6));
  if (new Set(rest).size !== rest.length) fail('studyPrefs.rest');
  return {
    goal: int(v.goal ?? 0, 'studyPrefs.goal', 0, 720),
    dayMin: int(v.dayMin ?? 15, 'studyPrefs.dayMin', 1, 240),
    rest: [...rest].sort((a, b) => a - b),
    celebrate: bool(v.celebrate ?? true, 'studyPrefs.celebrate'),
    /* left out (a tab from before alarms), the stored choice stays (worker/db.js PREFS_SQL); none stored is on */
    ...(v.alarms !== undefined && { alarms: bool(v.alarms, 'studyPrefs.alarms') }),
    ...(v.reviews !== undefined && { reviews: optDate(v.reviews, 'studyPrefs.reviews') }),
    ...(bool(v.setupDone ?? false, 'studyPrefs.setupDone') ? { setupDone: true } : {}),
  };
}

/* The study timer's flow: Study and Break steps repeated for a number of rounds. */
const STEP_KINDS = ['study', 'break'];
export function studyFlow(v) {
  obj(v, 'studyFlow');
  if (!Array.isArray(v.steps) || v.steps.length < 1 || v.steps.length > 12) fail('studyFlow.steps');
  const steps = v.steps.map((s, i) => {
    if (!Array.isArray(s) || s.length !== 2) fail(`studyFlow.steps[${i}]`);
    return [oneOf(s[0], `studyFlow.steps[${i}]`, STEP_KINDS), int(s[1], `studyFlow.steps[${i}]`, 1, 180)];
  });
  if (!steps.some(([k]) => k === 'study')) fail('studyFlow.steps');
  return { steps, rounds: int(v.rounds, 'studyFlow.rounds', 1, 12) };
}

function meeting(m, f) {
  const out = {
    id: str(m.id, `${f}.id`, 24, 1),
    kind: oneOf(m.kind, `${f}.kind`, KINDS),
    weekday: int(m.weekday, `${f}.weekday`, 0, 6),
    start: time(m.start, `${f}.start`),
    end: time(m.end, `${f}.end`),
    room: str(m.room ?? '', `${f}.room`, 40),
  };
  if (out.end <= out.start) fail(`${f}.end`);
  /* the last day it meets; '' or absent is none, and only a date is kept */
  if (m.until !== undefined && m.until !== null && m.until !== '') out.until = date(m.until, `${f}.until`);
  return out;
}

/* A grade category: a share of the course grade, split over its items, dropping the lowest scores. */
function category(c, f) {
  return { id: str(c.id, `${f}.id`, 24, 1), name: str(c.name, `${f}.name`, 40, 1), weight: optNum(c.weight, `${f}.weight`, 0, 100) ?? fail(`${f}.weight`), drop: int(c.drop ?? 0, `${f}.drop`, 0, MAX_DROP) };
}
function categories(v) {
  if (v === undefined) return undefined;
  const out = list(v, 'gradeCategories', MAX_CATEGORIES, category);
  if (new Set(out.map((c) => c.id)).size !== out.length) fail('gradeCategories');
  return out;
}
/* Grades fields an old client never sends (added after the first clients shipped): absent is undefined, and the stored value stays. */
const kept = (v, read) => (v === undefined ? undefined : read(v));

export function validateCourse(body) {
  obj(body, 'body');
  return {
    code: str(body.code, 'code', 8, 1),
    name: str(body.name, 'name', 80, 1),
    color: oneOf(body.color, 'color', COURSE_COLOURS),
    instructor: str(body.instructor ?? '', 'instructor', 60),
    term: str(body.term ?? '', 'term', 40),
    archived: bool(body.archived ?? false, 'archived'),
    meetings: list(body.meetings ?? [], 'meetings', MEETINGS_MAX, meeting),
    target: body.target === null || body.target === undefined ? null : int(body.target, 'target', 1, 100),
    credits: kept(body.credits, (v) => optNum(v, 'credits', 0, 30)),
    gradeCategories: categories(body.gradeCategories),
  };
}

function checklistEntry(c, f) {
  return { id: str(c.id, `${f}.id`, 24, 1), text: str(c.text ?? '', `${f}.text`, 140), done: bool(c.done ?? false, `${f}.done`) };
}

function linkEntry(l, f) {
  const url = str(l.url, `${f}.url`, 500, 1);
  if (!/^https?:\/\//i.test(url)) fail(`${f}.url`);
  try { new URL(url); } catch { fail(`${f}.url`); }
  return { label: str(l.label ?? '', `${f}.label`, 60), url };
}

export function validateItem(body) {
  obj(body, 'body');
  const out = {
    type: itemType(body.type, 'type'),
    title: str(body.title, 'title', 140, 1),
    courseId: optStr(body.courseId, 'courseId', 40) || null,
    date: date(body.date, 'date'),
    start: optTime(body.start, 'start'),
    end: optTime(body.end, 'end'),
    where: str(body.where ?? '', 'where', 80),
    status: oneOf(body.status, 'status', STATUSES),
    grade: optNum(body.grade, 'grade', 0, 100),
    weight: optNum(body.weight, 'weight', 0, 100),
    notes: str(body.notes ?? '', 'notes', 5000),
    checklist: list(body.checklist ?? [], 'checklist', CHECKLIST_MAX, checklistEntry),
    links: list(body.links ?? [], 'links', 20, linkEntry),
    recur: body.recur === null || body.recur === undefined ? null : oneOf(body.recur, 'recur', ['weekly']),
    weekday: body.weekday === null || body.weekday === undefined ? null : int(body.weekday, 'weekday', 0, 6),
    recurUntil: optDate(body.recurUntil, 'recurUntil'),
    dept: str(body.dept ?? '', 'dept', 40),
    completedAt: optInt(body.completedAt, 'completedAt'),
    classId: spaceLabel(body.classId, 'classId'),
    category: kept(body.category, (v) => optStr(v, 'category', 24) || null),
  };
  if (out.recur === 'weekly' && out.weekday === null) fail('weekday');
  // A personal item is under a course of yours or filed under a class, never both (the u: CHECK).
  if (out.classId && out.courseId) fail('classId');
  // The client sets a weekday only on a weekly item (normalizeItem in src/core/model.ts).
  if (out.recur === null && out.weekday !== null) fail('weekday');
  if (out.start && out.end && out.end <= out.start) fail('end');
  if (out.recurUntil && out.recurUntil < out.date) fail('recurUntil');
  return out;
}

export function validateStudySession(body) {
  obj(body, 'body');
  return {
    courseId: optStr(body.courseId, 'courseId', 40) || null,
    itemId: optStr(body.itemId, 'itemId', 24) || null,
    startedAt: int(body.startedAt, 'startedAt', 1, Number.MAX_SAFE_INTEGER),
    studyMinutes: int(body.studyMinutes, 'studyMinutes', 1, 1440),
    roundsDone: int(body.roundsDone ?? 0, 'roundsDone', 0, 12),
    note: str(body.note ?? '', 'note', 200),
    manual: bool(body.manual ?? false, 'manual'),
    spaceId: spaceLabel(body.spaceId, 'spaceId'),
    roomId: roomLabel(body.roomId),
  };
}

/* The study room a session was studied in (worker/rooms.js): left out, the stored one stays. */
function roomLabel(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !SPACE_ID.test(v)) fail('roomId');
  return v;
}

export function validateQuote(body) {
  obj(body, 'body');
  return {
    text: str(body.text, 'text', 300, 1),
    source: str(body.source ?? '', 'source', 80),
  };
}

/* Your own achievement: a sticker picture as a small data: URL, a name, and what earns
   it, hours on a course (1–1000) or a grade on one exam or quiz (1–100). */
const STICKER = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export function validateAchievement(body) {
  obj(body, 'body');
  const sticker = str(body.sticker, 'sticker', STICKER_MAX, 1);
  if (!STICKER.test(sticker)) fail('sticker');
  const rule = oneOf(body.rule, 'rule', ['hours', 'grade']);
  return {
    name: str(body.name, 'name', 40, 1),
    sticker,
    rule,
    courseId: rule === 'hours' ? str(body.courseId, 'courseId', 40, 1) : null,
    itemId: rule === 'grade' ? str(body.itemId, 'itemId', 24, 1) : null,
    target: int(body.target, 'target', 1, rule === 'grade' ? 100 : 1000),
    spaceId: spaceLabel(body.spaceId, 'spaceId'),
  };
}

/* A class's course: the class's facts. Each member's target and "archived in my sidebar"
   are theirs (space_prefs, Stage 4), never on the shared row (the schema's CHECK). */
export function validateSharedCourse(body) {
  return { ...validateCourse(body), target: null, archived: false };
}

/* A task's assignees: user ids, or ["*"] for everyone. Membership is checked in the write. */
function assigneeList(v) {
  if (!Array.isArray(v) || v.length > 30) fail('assignees');
  v.forEach((u, i) => str(u, `assignees[${i}]`, 64, 1));
  if (new Set(v).size !== v.length || (v.includes('*') && v.length > 1)) fail('assignees');
  return v;
}

/**
 * A class's or a project's item, in the shape its scope allows. A class row holds the
 * class's facts: status, grade, checklist and completion are each member's own (marks,
 * Stage 4), so they are stored empty. A project row carries no grade, weight or course;
 * its type is task, or project for the space's one 'project' item.
 */
export function validateSharedItem(body, kind, id) {
  const out = validateItem(body);
  if (kind === 'class') {
    if (CUSTOM_TYPE.test(out.type)) fail('type');
    if (!out.courseId) fail('courseId');
    return { ...out, status: 'todo', grade: null, checklist: [], completedAt: null, assignees: [], classId: null };
  }
  if (!['task', 'project'].includes(out.type) || (out.type === 'project') !== (id === 'project')) fail('type');
  if (out.courseId !== null) fail('courseId');
  if (out.grade !== null) fail('grade');
  if (out.weight !== null) fail('weight');
  if (out.category) fail('category');
  return { ...out, assignees: assigneeList(body.assignees ?? []), classId: null };
}

/** `changed`: {field: value before}, naming only the shared fields of `set` ('courses', 'class' or 'project'); absent for a whole-row write. */
export function validateChanged(body, set) {
  if (body.changed === undefined || body.changed === null) return undefined;
  const changed = obj(body.changed, 'changed');
  for (const f of Object.keys(changed)) if (!SHARED_FIELDS[set].includes(f)) fail('changed');
  return changed;
}

/**
 * Your mark on a shared item (spec §3, §4). On a project's item the status and checklist are
 * the team's, and it carries no grade or weight: only your notes and hidden may be set.
 */
export function validateMark(body, kind) {
  obj(body, 'body');
  const out = {
    status: oneOf(body.status ?? 'todo', 'status', STATUSES),
    grade: optNum(body.grade, 'grade', 0, 100),
    weight: optNum(body.weight, 'weight', 0, 100),
    notes: str(body.notes ?? '', 'notes', 5000),
    checklist: list(body.checklist ?? [], 'checklist', CHECKLIST_MAX, checklistEntry),
    completedAt: optInt(body.completedAt, 'completedAt'),
    hidden: bool(body.hidden ?? false, 'hidden'),
  };
  if (kind === 'project') {
    for (const f of ['status', 'grade', 'weight', 'checklist', 'completedAt']) if (stable(out[f]) !== stable(MARK_DEFAULTS[f])) fail(f);
  }
  return out;
}

/** Your prefs for a space: a colour of the twelve, a target, your semester, archived in your sidebar. */
export function validatePref(body) {
  obj(body, 'body');
  return {
    color: oneOf(body.color, 'color', COURSE_COLOURS),
    target: body.target === null || body.target === undefined ? null : int(body.target, 'target', 1, 100),
    term: str(body.term ?? '', 'term', 40),
    archived: bool(body.archived ?? false, 'archived'),
  };
}
