// Read a course outline (PDF, Word, text) with Workers AI and return what it says:
// the course, its weekly classes and its assessments. Nothing is saved here; the
// browser shows the result in the import preview and saves what the person ticks.
//
// Cost: toMarkdown is free for documents; the extraction is one Llama call, bounded
// by MAX_CHARS in and MAX_TOKENS out, and by OUTLINE_DAILY_LIMIT per person per day.

import { HttpError } from './http.js';

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_CHARS = 48_000;          /* about 12k tokens of outline */
const MAX_TOKENS = 3000;

const KINDS = ['Lecture', 'Lab', 'Seminar', 'Tutorial', 'PBL', 'Clinical'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TYPES = ['exam', 'assignment', 'lab', 'project', 'task'];
const TEXT_TYPES = /^text\/(plain|markdown|csv)\b/i;

const SCHEMA = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    instructor: { type: 'string' },
    term: { type: 'string' },
    termStart: { type: 'string' },
    classes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          day: { type: 'string', enum: DAYS },
          start: { type: 'string' },
          end: { type: 'string' },
          room: { type: 'string' },
        },
        required: ['kind', 'day', 'start'],
      },
    },
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: TYPES },
          date: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          room: { type: 'string' },
          weight: { type: 'number' },
        },
        required: ['title', 'type'],
      },
    },
  },
  required: ['code', 'name', 'classes', 'assessments'],
};

export function prompt(text, today, termStart) {
  return [
    {
      role: 'system',
      content: 'You extract structured data from a university course outline (syllabus). Answer only with JSON matching the schema. '
        + 'code: the course code as written (e.g. "PHARM101"), or "" if none. name: the course title. instructor: the lead teacher\'s name, or "". term: e.g. "Autumn 2026", or "". termStart: the first day of teaching as YYYY-MM-DD if the outline states it, otherwise "". '
        + 'classes: the recurring weekly timetable only (lectures, labs, seminars, tutorials, PBL, clinical sessions): one entry per weekday, times as 24-hour HH:MM, room as written. '
        + 'assessments: every graded or scheduled piece of work: exams, quizzes, OSCEs, assignments, essays, lab reports, presentations, projects. '
        + 'type is exam for exams/quizzes/tests/OSCEs, assignment for written work, lab for lab reports/practicals, project for projects, otherwise task. '
        + 'date as YYYY-MM-DD when the outline gives one (resolve "Week N" from the term start if given), otherwise "". weight is the percentage of the final grade as a number, omitted if not stated. '
        + 'Never invent classes, dates or weights that the outline does not state.',
    },
    {
      role: 'user',
      content: 'Today is ' + today + '.' + (termStart ? ' The term started on ' + termStart + '.' : '') + '\n\nCourse outline:\n\n' + text,
    },
  ];
}

const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** "9:00", "0900", "2pm", "14.30" → "HH:MM", or '' */
export function cleanTime(v) {
  const m = String(v || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return '';
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function cleanDate(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}

/** Whatever the model returned, made safe and bounded. */
export function cleanOutline(raw) {
  let o = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  if (!o || typeof o !== 'object') throw new HttpError(502, { error: 'outline_unreadable' });
  const code = clip(o.code, 16).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
  const classes = (Array.isArray(o.classes) ? o.classes : []).map((c) => {
    const start = cleanTime(c?.start), end = cleanTime(c?.end);
    return {
      kind: KINDS.includes(c?.kind) ? c.kind : 'Lecture',
      weekday: DAYS.indexOf(c?.day),
      start, end: end > start ? end : '',
      room: clip(c?.room, 40),
    };
  }).filter((c) => c.weekday >= 0 && c.start).slice(0, 12);
  const assessments = (Array.isArray(o.assessments) ? o.assessments : []).map((a) => {
    const w = typeof a?.weight === 'number' ? a.weight : parseFloat(a?.weight);
    const start = cleanTime(a?.start), end = cleanTime(a?.end);
    return {
      title: clip(a?.title, 140),
      type: TYPES.includes(a?.type) ? a.type : 'task',
      date: cleanDate(a?.date),
      start, end: start && end > start ? end : '',
      room: clip(a?.room, 80),
      weight: Number.isFinite(w) && w > 0 && w <= 100 ? Math.round(w * 10) / 10 : null,
    };
  }).filter((a) => a.title).slice(0, 60);
  return { code, name: clip(o.name, 80), instructor: clip(o.instructor, 60), term: clip(o.term, 40), termStart: cleanDate(o.termStart), classes, assessments };
}

/**
 * The outline's text: plain text as sent, anything else through toMarkdown.
 * `ai` is env.AI (or a fake in tests).
 */
export async function outlineText(ai, bytes, type, name) {
  if (TEXT_TYPES.test(type || '')) return new TextDecoder().decode(bytes);
  const result = await ai.toMarkdown({ name: name || 'outline', blob: new Blob([bytes], { type: type || 'application/octet-stream' }) });
  const doc = Array.isArray(result) ? result[0] : result;
  if (!doc || doc.format === 'error' || typeof doc.data !== 'string') throw new HttpError(422, { error: 'outline_unsupported' });
  return doc.data;
}

export async function readOutline(ai, { bytes, type, name, today, termStart }) {
  let text = (await outlineText(ai, bytes, type, name)).trim();
  if (text.length < 40) throw new HttpError(422, { error: 'outline_empty' });
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);
  const out = await ai.run(MODEL, {
    messages: prompt(text, today, termStart),
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: MAX_TOKENS,
    temperature: 0,
  });
  return { ...cleanOutline(out?.response ?? out), truncated };
}
