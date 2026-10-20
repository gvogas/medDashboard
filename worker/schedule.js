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
import { DAYS, KINDS, askModel, cleanClasses, cleanCode, cleanTime, clip, dayIndex } from './outline.js';
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
  'Copy each room exactly as written, with any word before it and any lone letter after it ("Classroom D-243 L"): the app reads those marks itself.',
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
  for (const c of courseList(o)) {
    const code = cleanCode(c?.code ?? c?.course_code ?? c?.courseCode), name = clip(c?.name ?? c?.title ?? c?.course_name, 80);
    /* a course with its classes, or (a model's flat list) one class that names its course */
    const classes = (Array.isArray(c?.classes) ? c.classes : Array.isArray(c?.meetings) ? c.meetings : c && (c.day || c.days) ? [c] : []).flatMap(eachDay);
    const same = merged.find((m) => (code ? m.code === code : !m.code && !!name && m.name.toLowerCase() === name.toLowerCase()));
    if (same) {
      same.raw.push(...classes);
      same.name ||= name;
    } else merged.push({ code, name, raw: [...classes] });
  }
  const courses = merged
    .map((c) => ({ code: c.code, name: c.name, classes: cleanClasses(c.raw).map(roomMarks) }))
    .filter((c) => (c.code || c.name) && c.classes.length)
    .slice(0, MAX_COURSES);
  if (!courses.length) throw new HttpError(502, { error: 'schedule_unreadable' });
  return { term: clip(o.term, 40), courses };
}

/* Where the courses are: `courses` as asked, or under a name a model chose, or the answer was the list itself. */
const COURSE_KEYS = ['courses', 'schedule', 'timetable', 'items', 'classes', 'data'];
function courseList(o) {
  for (const key of COURSE_KEYS) {
    const v = o[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.courses)) return v.courses;
  }
  return [];
}

/* the letters of a compact day list: "MWF", "TTh", "TR" */
const LETTERS = /Th|Tu|Sa|Su|M|T|W|R|F|S|U/g;
const LETTER_DAY = { M: 'Mon', T: 'Tue', Tu: 'Tue', W: 'Wed', R: 'Thu', Th: 'Thu', F: 'Fri', S: 'Sat', Sa: 'Sat', U: 'Sun', Su: 'Sun' };

/** The weekdays in a model's `day`: "Tue/Thu", "Tue, Thu", "Tuesday and Thursday", "MWF", ["Mon", "Wed"]. */
export function splitDays(day) {
  if (Array.isArray(day)) return day.flatMap(splitDays);
  const s = String(day || '').trim();
  /* one word that is a day: "Thursday", "Th", "Mar." (dayIndex reads only a word's first letters) */
  if (/^[a-zà-ÿ]+\.?$/i.test(s) && dayIndex(s) >= 0) return [s];
  const parts = s.split(/\s*(?:[\/,&+;]|\band\b|\bet\b)\s*|\s+/i).filter(Boolean);
  if (parts.length > 1) return parts.flatMap(splitDays);
  if (/^(?:Th|Tu|Sa|Su|[MTWRFSU])+$/.test(s)) return (s.match(LETTERS) || []).map((l) => LETTER_DAY[l]);
  return [s];
}

/* "08:30-10:00" or "8:30 AM to 10:00 AM" in one field */
const RANGE = /\s*(?:[-–—]|\bto\b|\bà\b)\s*/i;

/** One class entry per weekday, its start and end apart: what cleanClasses reads. */
function eachDay(c) {
  if (!c || typeof c !== 'object') return [];
  let start = c.start ?? c.start_time ?? c.startTime, end = c.end ?? c.end_time ?? c.endTime;
  const range = typeof start === 'string' && !end ? start : !start && typeof c.time === 'string' ? c.time : '';
  if (range && RANGE.test(range)) [start, end] = range.split(RANGE);
  return splitDays(c.day ?? c.days ?? c.weekday).map((day) => ({ ...c, day, start, end, room: c.room ?? c.location ?? '' }));
}

/* Omnivox (Quebec's CEGEPs) writes a room as "Classroom D-243", a lab's with a lone "L" after it
   ("Classroom D-243 L"). A model does not reliably make that a Lab or drop the word, so both are
   done here, for every school's timetable: elsewhere too, a room ending in a lone "L" is a lab. */
const LAB_MARK = /\s+L$/;
const CLASSROOM = /^classroom\s+(?=\S)/i;
const roomMarks = (c) => {
  const room = c.room.replace(CLASSROOM, '');
  return LAB_MARK.test(room) ? { ...c, kind: 'Lab', room: room.replace(LAB_MARK, '') } : { ...c, room };
};

/** Bytes as base64, in chunks: String.fromCharCode(...bytes) overflows the stack on a large picture. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* the plain retry is skipped when less than this is left of the read's deadline */
const MIN_PLAIN_MS = 20_000;

/** The screenshot as the vision model is given it: a data URI, after the words. */
const pictureMessage = (bytes, type, text) => ({ role: 'user', content: [
  { type: 'text', text },
  { type: 'image_url', image_url: { url: 'data:' + imageType(type) + ';base64,' + toBase64(bytes) } },
] });

/**
 * A picture read: JSON mode first. When JSON mode fails (Workers AI refuses an answer it
 * cannot fit to the schema) or `clean` finds nothing in its answer, one more try in plain
 * mode, the schema in the prompt, as the text model is asked: part of the same read (no
 * second claim) and of its one deadline. A spent allowance (429) or the deadline (504) is not
 * retried.
 */
async function askPicture(ai, { bytes, claim, deadline }, rules, schema, user, clean) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, { error: 'too_large' });
  const timeoutMs = timeLeft(deadline);
  if (claim) await claim();
  const ask = (input, what, ms) => askJson(ai, VISION_MODEL, { ...input, max_tokens: VISION_TOKENS, temperature: 0 }, clean, what, { timeoutMs: ms });
  const started = Date.now();
  try {
    return await ask({ messages: [{ role: 'system', content: rules.join(' ') }, user], response_format: { type: 'json_schema', json_schema: schema } }, 'schedule', timeoutMs);
  } catch (e) {
    const http = e instanceof HttpError;
    if (http && e.status !== 502) throw e;
    const left = timeoutMs - (Date.now() - started);
    if (left < MIN_PLAIN_MS) throw e;
    const first = http ? e.detail || 'no classes' : 'JSON mode failed: ' + String(e?.message || e).split('\n')[0].slice(0, 200);
    console.log('schedule: ' + first + '; trying again in plain mode');
    try {
      return await ask({ messages: [{ role: 'system', content: [...rules, 'Answer with one JSON object, no other text, using exactly this JSON Schema: ' + JSON.stringify(schema)].join(' ') }, user] }, 'schedule plain', left);
    } catch (again) {
      if (again instanceof HttpError) again.detail = [first, again.detail].filter(Boolean).join(' · then, in plain mode: ');
      throw again;
    }
  }
}

/* A screenshot with no grid found: the model reads the classes, days and times too. */
const askImage = (ai, doc, today, known = '') =>
  askPicture(ai, doc, RULES, SCHEMA, pictureMessage(doc.bytes, doc.type, 'Today is ' + today + '.' + (known ? ' ' + known : '') + ' Read this timetable.'), cleanSchedule);

/*
 * A screenshot whose grid the browser found (src/core/image-grid.ts): it sends the picture
 * with a red number on each class's block, and ?grid= says where each block is: the number of
 * weekday columns and rows, then each block's column and first and last row, in number order:
 * "5.20|0:1-3,0:4-7". The weekday and the times come from there, exactly; the model only
 * copies each block's words, the weekday headings, and the first and last times down the side.
 */
const MAX_BLOCKS = 60;
export function parseGrid(param) {
  const m = String(param || '').match(/^([1-7])\.(\d{1,2})\|((?:\d:\d{1,2}-\d{1,2},?){1,60})$/);
  if (!m) return null;
  const cols = +m[1], rows = +m[2];
  const blocks = m[3].split(',').filter(Boolean).map((b) => b.match(/^(\d):(\d{1,2})-(\d{1,2})$/)).filter(Boolean)
    .map(([, col, from, to]) => ({ col: +col, from: +from, to: +to }));
  if (rows < 3 || blocks.length > MAX_BLOCKS || blocks.some((b) => b.col >= cols || b.from > b.to || b.to >= rows)) return null;
  return { cols, rows, blocks };
}

const GRID_SCHEMA = {
  type: 'object',
  properties: {
    term: { type: 'string' },
    days: { type: 'array', items: { type: 'string' } },
    firstTime: { type: 'string' },
    lastTime: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          code: { type: 'string' },
          name: { type: 'string' },
          room: { type: 'string' },
          kind: { type: 'string' },
          empty: { type: 'boolean' },
        },
        required: ['n', 'code', 'name', 'room'],
      },
    },
  },
  required: ['days', 'firstTime', 'lastTime', 'blocks'],
};

const GRID_RULES = [
  "You copy the words in a student's weekly timetable grid and answer only with JSON matching the schema.",
  'Each class block in the picture has a red number in its top-left corner. blocks: one entry per number, n being that number.',
  'For each block copy, exactly as written in that block: code (the course code, e.g. "420-541-VA" or "CHEM 271", without "sec." and the section), name (the course title), room (with any word before it and any lone letter after it, e.g. "Classroom D-243 L"), and kind if the block says one (Lecture, Lab, Tutorial…), else "".',
  'empty: true for a numbered block with no class in it (blank, a scribble, nothing to read); then leave the other fields "".',
  'days: the weekday headings of the columns, left to right, as written. firstTime: the earliest time written down the time column, at its top. lastTime: the latest time written down the time column, at its bottom. term: the semester if the picture says one, else "".',
  'Never move words from one block to another, and never invent a block.',
];

/** The answer for a grid read, made safe: the blocks' words put on the grid's days and times. */
export function cleanGrid(raw, grid) {
  const o = modelJson(raw);
  if (!o) throw new HttpError(502, { error: 'schedule_unreadable' });
  const first = minutes(o.firstTime), last = minutes(o.lastTime);
  /* rows are all alike: the side's first and last times say how long one is */
  const step = first >= 0 && last > first ? (last - first) / grid.rows : 0;
  const rowMin = Math.round(step / 5) * 5;
  if (rowMin < 5 || rowMin > 120 || Math.abs(step - rowMin) > 1) throw Object.assign(new HttpError(502, { error: 'schedule_unreadable' }), { detail: 'grid times not read: ' + JSON.stringify([o.firstTime, o.lastTime, grid.rows]) });
  /* the headings say which weekday each column is; without them a grid starts on Monday */
  const heads = (Array.isArray(o.days) ? o.days : []).map(dayIndex);
  const weekday = (col) => (heads.length === grid.cols && heads.every((d) => d >= 0) ? heads[col] : (col + 1) % 7);
  const said = new Map((Array.isArray(o.blocks) ? o.blocks : []).map((b) => [Number(b?.n), b]));
  const clock = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const courses = grid.blocks.map((b, i) => {
    const w = said.get(i + 1);
    if (!w || w.empty || (!clip(w.code, 40) && !clip(w.name, 80))) return null;
    return { code: w.code, name: w.name, classes: [{ kind: w.kind || 'Lecture', day: DAYS[weekday(b.col)], start: clock(first + b.from * rowMin), end: clock(first + (b.to + 1) * rowMin), room: w.room || '' }] };
  }).filter(Boolean);
  return cleanSchedule({ term: o.term, courses });
}

/* "08:00", "8:00 AM" as minutes after midnight; -1 for anything else */
function minutes(v) {
  const t = cleanTime(v);
  return t ? +t.slice(0, 2) * 60 + +t.slice(3) : -1;
}

function askGrid(ai, doc, grid, today, known = '') {
  const where = grid.blocks.map((b, i) => 'block ' + (i + 1) + ': column ' + (b.col + 1) + ', rows ' + (b.from + 1) + '–' + (b.to + 1)).join('; ');
  const text = 'Today is ' + today + '.' + (known ? ' ' + known : '') + ' The grid has ' + grid.cols + ' weekday columns and ' + grid.rows + ' rows; the numbered blocks are ' + where + '. Copy each numbered block\'s words.';
  return askPicture(ai, doc, GRID_RULES, GRID_SCHEMA, pictureMessage(doc.bytes, doc.type, text), (raw) => cleanGrid(raw, grid));
}

export async function readSchedule(ai, { today, terms, codes, grid, ...doc }) {
  const known = knownContext({ terms, codes });
  if (/^image\//i.test(doc.type || '')) {
    /* toMarkdown would describe other pictures with a model of its own: refuse them here */
    if (!imageType(doc.type)) throw new HttpError(415, { error: 'image_unsupported' });
    const found = parseGrid(grid);
    return { ...await (found ? askGrid(ai, doc, found, today, known) : askImage(ai, doc, today, known)), truncated: false };
  }
  let sent = '';
  const ask = (text) => { sent = text; return textPrompt(text, today, known); };
  return askModel(ai, doc, ask, (raw) => onGridLines(cleanSchedule(raw), sent), { effort: 'low', maxTokens: TEXT_TOKENS, maxChars: TEXT_CHARS, what: 'schedule' });
}

/* a line the browser wrote from a PDF's grid (src/core/timetable-grid.ts): "Mon 08:30-10:00 | words | …" */
const GRID_LINE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d\d:\d\d)-(\d\d:\d\d) \| (.+)$/gm;
const squeeze = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/**
 * A PDF's grid lines put on the model's courses: each line's weekday and times are read from
 * the page's layout, exact, so they are taken as they are, and the model only says which course
 * a line is (its code or its name in the line) and its kind and room. A model that moves a
 * class to another day, snaps its start or drops it cannot. When a line names no course the
 * model gave, the model's own classes stay.
 */
export function onGridLines(schedule, text) {
  const lines = [...String(text || '').matchAll(GRID_LINE)].map(([, day, start, end, words]) => ({ weekday: DAYS.indexOf(day), start, end, words, flat: squeeze(words) }));
  if (!lines.length) return schedule;
  const owner = (line) => schedule.courses.find((c) => c.code && line.flat.includes(squeeze(c.code)))
    || schedule.courses.find((c) => c.name && squeeze(c.name).length >= 4 && line.flat.includes(squeeze(c.name)));
  if (!lines.every(owner)) return schedule;
  const courses = schedule.courses.map((c) => {
    const mine = lines.filter((l) => owner(l) === c);
    if (!mine.length) return c;
    const classes = mine.map((l) => {
      /* the model's class on that weekday gives the kind and room, else the line's room ("Classroom D-243 L") */
      const said = c.classes.find((m) => m.weekday === l.weekday && m.start === l.start) || c.classes.find((m) => m.weekday === l.weekday);
      const room = said?.room || (l.words.split(' | ').find((p) => /^(classroom|room|salle|local)\s+\S/i.test(p)) || '');
      return roomMarks({ kind: said?.kind || 'Lecture', weekday: l.weekday, start: l.start, end: l.end, room: clip(room, 40) });
    });
    return { ...c, classes };
  });
  return { ...schedule, courses };
}
