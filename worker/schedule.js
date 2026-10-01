// Read a class schedule (the weekly timetable from a student portal) with Workers AI: each
// course and its lectures, labs and tutorials. Nothing is saved here; the browser shows the
// courses in the schedule preview and saves what the person ticks.
//
// A PDF arrives as text (read in the browser, like outlines) and goes to the text model,
// thinking little: a timetable needs reading, not reasoning. About 110 neurons a page.
// A screenshot arrives as a JPEG or PNG made smaller in the browser and goes to the vision
// model (VISION_MODEL). Both count against the same daily reads as outlines (limitOutline).

import { HttpError } from './http.js';
import { DAYS, KINDS, askModel, cleanClasses, cleanCode, clip, modelJson } from './outline.js';
import { runModel } from './ai.js';

const MAX_COURSES = 15;
const TEXT_TOKENS = 3000;

// A screenshot goes to Llama 4 Scout: it reads images given as data URIs (never URLs) and
// answers in JSON mode. About 110 neurons for a 1600 px screenshot: ~1,900 image tokens and
// ~600 prompt tokens in at 24,545 neurons/M, ~600 out at 77,273/M. Measured in Task 13.
export const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg)$/i;
const VISION_TOKENS = 2000;    /* its default is 256: too few for a timetable */

const SCHEMA = {
  type: 'object',
  properties: {
    term: { type: 'string' },
    courses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
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
        },
        required: ['code', 'name', 'classes'],
      },
    },
  },
  required: ['term', 'courses'],
};

/* What both paths are told. */
const RULES = [
  "You read a student's class schedule (a weekly timetable) and answer only with JSON matching the schema.",
  'term: the semester the timetable is for, e.g. "Fall 2026", or "" if it does not say.',
  'courses: one entry per course. code: the course code exactly as written, e.g. "CHEM 271" or "420-521-VA" ("" if there is none). name: the course title.',
  'classes: every weekly meeting of that course, one entry per weekday: kind (Lecture, Lab, Seminar, Tutorial, PBL or Clinical; "LEC" and "Cours" are Lecture, "LAB" is Lab, "TUT" and "TD" are Tutorial), day, start and end in 24-hour HH:MM, room as written ("" if none).',
  'A class that meets on Tuesday and Thursday is two entries. In a grid, a class runs from the row of its start time to the row of its end time.',
  'Leave out exams, office hours, breaks and anything that is not a weekly class. Never invent courses, times or rooms.',
];

function textPrompt(text, today) {
  return [
    { role: 'system', content: [...RULES, 'Answer with one JSON object, no other text, using exactly this JSON Schema: ' + JSON.stringify(SCHEMA)].join(' ') },
    { role: 'user', content: 'Today is ' + today + '.\n\nTimetable:\n\n' + text },
  ];
}

/** Whatever the model returned, made safe: {term, courses}. 502 when there is no class at all. */
export function cleanSchedule(raw) {
  const o = modelJson(raw);
  if (!o) throw new HttpError(502, { error: 'schedule_unreadable' });
  const courses = (Array.isArray(o.courses) ? o.courses : [])
    .map((c) => ({ code: cleanCode(c?.code), name: clip(c?.name, 80), classes: cleanClasses(c?.classes) }))
    .filter((c) => (c.code || c.name) && c.classes.length)
    .slice(0, MAX_COURSES);
  if (!courses.length) throw new HttpError(502, { error: 'schedule_unreadable' });
  return { term: clip(o.term, 40), courses };
}

/** Bytes as base64, in chunks: String.fromCharCode(...bytes) overflows the stack on a large picture. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function askImage(ai, { bytes, type, claim }, today) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, { error: 'too_large' });
  if (claim) await claim();
  const out = await runModel(ai, VISION_MODEL, {
    messages: [
      { role: 'system', content: RULES.join(' ') },
      { role: 'user', content: [
        { type: 'text', text: 'Today is ' + today + '. Read this timetable.' },
        { type: 'image_url', image_url: { url: 'data:' + type.toLowerCase() + ';base64,' + toBase64(bytes) } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: VISION_TOKENS,
    temperature: 0,
  }, 'schedule');
  return out?.response ?? out;
}

export async function readSchedule(ai, { today, ...doc }) {
  if (/^image\//i.test(doc.type || '')) {
    /* toMarkdown would describe other pictures with a model of its own: refuse them here */
    if (!IMAGE_TYPES.test(doc.type)) throw new HttpError(415, { error: 'image_unsupported' });
    return { ...cleanSchedule(await askImage(ai, doc, today)), truncated: false };
  }
  const { answer, truncated } = await askModel(ai, doc, (text) => textPrompt(text, today), { effort: 'low', maxTokens: TEXT_TOKENS, what: 'schedule' });
  return { ...cleanSchedule(answer), truncated };
}
