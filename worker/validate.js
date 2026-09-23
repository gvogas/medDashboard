// Shape rules, mirroring migrations/0001_init.sql, so a bad request gets a 400
// naming the field instead of a raw SQLite error. Each validator returns a clean
// object containing only known fields, in API (camelCase) shape.

import { HttpError } from './http.js';

const COLOURS = ['#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6'];
export const TYPES = ['exam', 'assignment', 'lab', 'tutoring', 'office', 'task'];
const STATUSES = ['todo', 'submitted', 'graded', 'done', 'missed'];
export const KINDS = ['Lecture', 'Lab', 'Seminar', 'Tutorial', 'PBL', 'Clinical'];
const THEMES = ['light', 'dark', 'system'];
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
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

export function validateId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 24 || /[\u0000-\u001f\u007f]/.test(id)) fail('id');
  return id;
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
    termStart: optDate(body.termStart, 'termStart'),
  };
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
  return out;
}

export function validateCourse(body) {
  obj(body, 'body');
  return {
    code: str(body.code, 'code', 8, 1),
    name: str(body.name, 'name', 80, 1),
    color: oneOf(body.color, 'color', COLOURS),
    instructor: str(body.instructor ?? '', 'instructor', 60),
    term: str(body.term ?? '', 'term', 40),
    archived: bool(body.archived ?? false, 'archived'),
    meetings: list(body.meetings ?? [], 'meetings', 12, meeting),
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
    type: oneOf(body.type, 'type', TYPES),
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
    checklist: list(body.checklist ?? [], 'checklist', 50, checklistEntry),
    links: list(body.links ?? [], 'links', 20, linkEntry),
    recur: body.recur === null || body.recur === undefined ? null : oneOf(body.recur, 'recur', ['weekly']),
    weekday: body.weekday === null || body.weekday === undefined ? null : int(body.weekday, 'weekday', 0, 6),
    recurUntil: optDate(body.recurUntil, 'recurUntil'),
    dept: str(body.dept ?? '', 'dept', 40),
    completedAt: optInt(body.completedAt, 'completedAt'),
  };
  if (out.recur === 'weekly' && out.weekday === null) fail('weekday');
  return out;
}

export function validateQuote(body) {
  obj(body, 'body');
  return {
    text: str(body.text, 'text', 300, 1),
    source: str(body.source ?? '', 'source', 80),
  };
}
