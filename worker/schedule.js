// Read a class schedule (the weekly timetable from a student portal) with Workers AI: each
// course and its lectures, labs and tutorials. Nothing is saved here; the browser shows the
// courses in the schedule preview and saves what the person ticks.
//
// A PDF arrives as text (read in the browser, like outlines; a weekday grid comes first as one
// line per class with the day and times its cell gives, src/core/timetable-grid.ts) and goes to the text model,
// thinking little: a timetable needs reading, not reasoning. Measured 1 October 2026 on a
// one-page timetable (test/fixtures/timetable.html as a PDF): 778 tokens in, 1,353 out with
// the thinking, 117 neurons.
// A screenshot arrives as a JPEG or PNG made smaller in the browser and goes to the vision
// model (VISION_MODEL). Both count against the same daily reads as outlines (limitOutline).

import { HttpError } from './http.js';
import { DAYS, KINDS, askModel, cleanClasses, cleanCode, clip } from './outline.js';
import { askJson, knownContext, modelJson, timeLeft } from './ai.js';

const MAX_COURSES = 15;
const TEXT_TOKENS = 3000;
const TEXT_CHARS = 16_000;    /* a timetable is a page or two; a long PDF picked by mistake costs no more than this */

// A screenshot goes to Llama 4 Scout: it reads images given as data URIs (never URLs) and
// answers in JSON mode. Measured 1 October 2026 on a 1400x900 screenshot of
// test/fixtures/timetable.html (6 rows, 8 classes): 2,641 tokens in (image and prompt) at
// 24,545 neurons/M and 557 out at 77,273/M, about 108 neurons. It answers a course split over
// several rows (lecture, lab) as one entry per row: cleanSchedule puts them together.
export const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/* the pictures it reads, by the type they are sent as: "image/png; x=y" is image/png, image/jpg is image/jpeg */
const IMAGE_TYPES = { 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg' };
const imageType = (type) => IMAGE_TYPES[String(type || '').split(';')[0].trim().toLowerCase()] || '';
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
  'Under "Timetable grid", each line is one class with its weekday and its start and end times, read from the page layout: make every line one class entry with exactly that day, start and end.',
  'A room followed by a lone "L" marks a Lab: keep the "L" in the room as written ("D-243 L").',
  'Leave out exams, office hours, breaks and anything that is not a weekly class. Never invent courses, times or rooms.',
];

function textPrompt(text, today, known = '') {
  return [
    { role: 'system', content: [...RULES, 'Answer with one JSON object, no other text, using exactly this JSON Schema: ' + JSON.stringify(SCHEMA)].join(' ') },
    { role: 'user', content: 'Today is ' + today + '.' + (known ? ' ' + known : '') + '\n\nTimetable:\n\n' + text },
  ];
}

/**
 * Whatever the model returned, made safe: {term, courses}. 502 when there is no class at all.
 * Entries for the same course (the same code, or no code and the same name) are one course:
 * a timetable lists a course's lecture and lab on rows of their own, and a model may too.
 */
export function cleanSchedule(raw) {
  const o = modelJson(raw);
  if (!o) throw new HttpError(502, { error: 'schedule_unreadable' });
  const merged = [];
  for (const c of Array.isArray(o.courses) ? o.courses : []) {
    const code = cleanCode(c?.code), name = clip(c?.name, 80);
    const classes = Array.isArray(c?.classes) ? c.classes : [];
    const same = merged.find((m) => (code ? m.code === code : !m.code && !!name && m.name.toLowerCase() === name.toLowerCase()));
    if (same) {
      same.raw.push(...classes);
      same.name ||= name;
    } else merged.push({ code, name, raw: [...classes] });
  }
  const courses = merged
    .map((c) => ({ code: c.code, name: c.name, classes: cleanClasses(c.raw).map(omnivoxRoom) }))
    .filter((c) => (c.code || c.name) && c.classes.length)
    .slice(0, MAX_COURSES);
  if (!courses.length) throw new HttpError(502, { error: 'schedule_unreadable' });
  return { term: clip(o.term, 40), courses };
}

/* Omnivox writes a room as "Classroom D-243", a lab's with a lone "L" after it ("Classroom D-243 L");
   a model does not reliably make that a Lab or drop the word, so both are done here. */
const LAB_MARK = /\s+L$/;
const CLASSROOM = /^classroom\s+(?=\S)/i;
const omnivoxRoom = (c) => {
  const room = c.room.replace(CLASSROOM, '');
  return LAB_MARK.test(room) ? { ...c, kind: 'Lab', room: room.replace(LAB_MARK, '') } : { ...c, room };
};

/** Bytes as base64, in chunks: String.fromCharCode(...bytes) overflows the stack on a large picture. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function askImage(ai, { bytes, type, claim, deadline }, today, known = '') {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, { error: 'too_large' });
  const timeoutMs = timeLeft(deadline);
  if (claim) await claim();
  return askJson(ai, VISION_MODEL, {
    messages: [
      { role: 'system', content: RULES.join(' ') },
      { role: 'user', content: [
        { type: 'text', text: 'Today is ' + today + '.' + (known ? ' ' + known : '') + ' Read this timetable.' },
        { type: 'image_url', image_url: { url: 'data:' + imageType(type) + ';base64,' + toBase64(bytes) } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: VISION_TOKENS,
    temperature: 0,
  }, cleanSchedule, 'schedule', { timeoutMs });
}

export async function readSchedule(ai, { today, terms, codes, ...doc }) {
  const known = knownContext({ terms, codes });
  if (/^image\//i.test(doc.type || '')) {
    /* toMarkdown would describe other pictures with a model of its own: refuse them here */
    if (!imageType(doc.type)) throw new HttpError(415, { error: 'image_unsupported' });
    return { ...await askImage(ai, doc, today, known), truncated: false };
  }
  return askModel(ai, doc, (text) => textPrompt(text, today, known), cleanSchedule, { effort: 'low', maxTokens: TEXT_TOKENS, maxChars: TEXT_CHARS, what: 'schedule' });
}
