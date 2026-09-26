// Read a course outline (PDF, Word, text) with Workers AI and return what it says:
// the course, its weekly classes and its assessments. Nothing is saved here; the
// browser shows the result in the import preview and saves what the person ticks.
//
// PDFs arrive as text: the browser reads them with PDF.js (public/js/pdftext.js),
// because toMarkdown drops the text of many tables. Word and other files still go
// through toMarkdown here.
//
// Cost: toMarkdown is free for documents; the extraction is one gpt-oss-120b call
// (about 300 neurons for a 10-page outline), bounded by MAX_CHARS in and MAX_TOKENS
// out, and by OUTLINE_DAILY_LIMIT model calls per person per day. On three real outlines it
// scored 18/21 against 14/21 for Llama 3.3 70B; see the study-tools spec.

import { HttpError } from './http.js';

export const MODEL = '@cf/openai/gpt-oss-120b';
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_CHARS = 48_000;          /* about 12k tokens of outline */
const MAX_TOKENS = 6000;            /* a reasoning model: its thinking counts too */

const KINDS = ['Lecture', 'Lab', 'Seminar', 'Tutorial', 'PBL', 'Clinical'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TYPES = ['exam', 'quiz', 'assignment', 'lab', 'project', 'task'];
const TEXT_TYPES = /^text\/(plain|markdown|csv)\b/i;

/* The shape asked for in the prompt; gpt-oss answers in JSON text rather than JSON mode. */
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
    officeHours: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS },
          start: { type: 'string' },
          end: { type: 'string' },
          room: { type: 'string' },
        },
        required: ['day', 'start'],
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
          week: { type: 'integer' },
          start: { type: 'string' },
          end: { type: 'string' },
          room: { type: 'string' },
          weight: { type: 'number' },
        },
        required: ['title', 'type'],
      },
    },
  },
  required: ['code', 'name', 'classes', 'officeHours', 'assessments'],
};

function prompt(text, today, termStart) {
  return [
    {
      role: 'system',
      content: [
        'You read a university course outline (syllabus) and answer only with JSON matching the schema.',
        'code: the course code exactly as written, e.g. "CHEM 271" or "420-521-VA". name: the course title. instructor: the lead teacher. term: e.g. "Fall 2026". termStart: the first day of classes as YYYY-MM-DD if the outline states or clearly implies it (e.g. the first date in a lecture schedule), otherwise "".',
        'classes: the recurring weekly timetable only (lectures, labs, seminars, tutorials, PBL, clinical): one entry per weekday, 24-hour HH:MM times. Leave it empty if the outline only says the schedule is elsewhere.',
        'officeHours: the weekly office hours of the teacher, one entry per weekday, 24-hour HH:MM. Leave it empty for "by appointment". Office hours are never classes.',
        'assessments: one entry for every graded or scheduled item: each exam, term test, midterm, final, quiz, OSCE, assignment, lab report, presentation and project deliverable. Split combined rows: "Term tests 15% + 20%" with two dates is two entries; "Midterm theory exam" and "Midterm lab exam" are two entries; each project deliverable with its own due week is its own entry.',
        'Every assessment needs a short title as written in the outline.',
        'Include every row of the grading breakdown, even ones without a date. When a component is broken down into parts with their own weights (e.g. a 35% project made of a 3% proposal, a 2% plan and so on), list only the parts, not the total as well, so weights are never counted twice.',
        'Find the date of each assessment by reading the WHOLE outline, including lecture schedules, weekly plans and tables: e.g. a schedule row "29-Sep Term test 1" gives Term test 1 the date YYYY-09-29 in the year of the outline.',
        'date: YYYY-MM-DD when a calendar date is given, otherwise "". week: the week number (1, 2, 3…) when the outline gives only a week such as "Week 7" or a weekly table row; for a range like "Week 6 to 12" use the last week. Never convert weeks to dates yourself.',
        'weight: the percentage of the final grade as written, e.g. 12.5 for 12.5% (never a fraction like 0.125). Omit it when not stated. When a total is split between entries (15% + 20%), give each entry its own part.',
        'type: exam for exams, tests, midterms, finals and OSCEs; quiz for quizzes; assignment for assignments, essays and written reports; lab for lab reports and practicals; project for projects and their deliverables; otherwise task.',
        'Never invent classes, dates, weeks or weights that the outline does not state.',
        'Answer with one JSON object, no other text, using exactly this JSON Schema: ' + JSON.stringify(SCHEMA),
      ].join(' '),
    },
    {
      role: 'user',
      content: 'Today is ' + today + '.' + (termStart ? ' The term started on ' + termStart + '.' : '') + '\n\nCourse outline:\n\n' + text,
    },
  ];
}

export const dayIndex = (d) => DAYS.indexOf(String(d || '').slice(0, 3).replace(/^./, (c) => c.toUpperCase()));
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

/** The model's answer as an object, or null: gpt-oss answers in JSON text, sometimes wrapped. */
export function modelJson(raw) {
  let o = raw;
  if (o && typeof o === 'object' && Array.isArray(o.choices)) o = o.choices[0]?.message?.content;
  if (typeof o === 'string') {
    const m = o.match(/\{[\s\S]*\}/);
    try { o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
  }
  return o && typeof o === 'object' ? o : null;
}

/** Whatever the model returned, made safe and bounded. */
export function cleanOutline(raw) {
  const o = modelJson(raw);
  if (!o) throw new HttpError(502, { error: 'outline_unreadable' });
  /* Codes are at most 8 characters: "CHEM 271" → CHEM271, "420-521-VA" → 420521VA. */
  let code = clip(o.code, 24).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (code.length > 8) code = code.replace(/-/g, '');
  code = code.slice(0, 8);
  const classes = (Array.isArray(o.classes) ? o.classes : []).map((c) => {
    const start = cleanTime(c?.start), end = cleanTime(c?.end);
    return {
      kind: KINDS.includes(c?.kind) ? c.kind : 'Lecture',
      weekday: dayIndex(c?.day),
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
      week: Number.isInteger(a?.week) && a.week >= 1 && a.week <= 20 ? a.week : null,
      start, end: start && end > start ? end : '',
      room: clip(a?.room, 80),
      weight: Number.isFinite(w) && w > 0 && w <= 100 ? Math.round(w * 10) / 10 : null,
    };
  }).filter((a) => a.title).slice(0, 60);
  const officeHours = (Array.isArray(o.officeHours) ? o.officeHours : []).map((h) => {
    const start = cleanTime(h?.start), end = cleanTime(h?.end);
    return { weekday: dayIndex(h?.day), start, end: end > start ? end : '', room: clip(h?.room, 80) };
  }).filter((h) => h.weekday >= 0 && h.start).slice(0, 7);
  return { officeHours, code, name: clip(o.name, 80), instructor: clip(o.instructor, 60), term: clip(o.term, 40), termStart: cleanDate(o.termStart), classes, assessments };
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

/**
 * A document's text put to the model with `messages(text)`: {answer, truncated}.
 * `claim` runs just before the model does: only a document that reaches the model uses
 * one of the day's attempts, not a file that could not be converted or has no text.
 */
export async function askModel(ai, { bytes, type, name, claim }, messages) {
  let text = (await outlineText(ai, bytes, type, name)).trim();
  if (text.length < 40) throw new HttpError(422, { error: 'outline_empty' });
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);
  if (claim) await claim();
  try {
    const out = await ai.run(MODEL, { messages: messages(text), max_tokens: MAX_TOKENS, temperature: 0 });
    return { answer: out?.response ?? out, truncated };
  } catch (e) {
    /* 4006: the account's free daily neurons are spent; it resets at 00:00 UTC. */
    if (/\b4006\b|daily free allocation/i.test(e?.message || '')) throw new HttpError(429, { error: 'outline_quota' });
    throw e;
  }
}

export async function readOutline(ai, { today, termStart, ...doc }) {
  const { answer, truncated } = await askModel(ai, doc, (text) => prompt(text, today, termStart));
  return { ...cleanOutline(answer), truncated };
}
