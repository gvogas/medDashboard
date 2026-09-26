// Read a school's academic calendar with Workers AI: its semesters and the special days
// that change classes. Nothing is saved here; the browser shows the result for review
// and saves it on the profile. PDFs arrive as text, read in the browser like outlines.
//
// Cost: one gpt-oss-120b call, bounded like an outline's, and counted against the same
// daily allowance of reads per person (limitOutline).

import { HttpError } from './http.js';
import { DAYS, dayIndex, modelJson, askModel } from './outline.js';
import { normalizeSchool, SCHOOL_KINDS } from '../public/js/school.js';

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } },
        required: ['name', 'start', 'end'],
      },
    },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          kind: { type: 'string', enum: SCHOOL_KINDS },
          label: { type: 'string' },
          follows: { type: 'string', enum: DAYS },
        },
        required: ['from', 'kind', 'label'],
      },
    },
  },
  required: ['name', 'terms', 'days'],
};

function prompt(text, today) {
  return [
    {
      role: 'system',
      content: [
        'You read a school or college academic calendar and answer only with JSON matching the schema.',
        'name: the school and the year, e.g. "Vanier College 2026–27".',
        'terms: every semester or term of study: name (e.g. "Autumn 2026"), start = the first day of classes, end = the last day of classes, both YYYY-MM-DD. Not intersession or summer school unless it is a regular term.',
        'days: the special dates that change regular classes, or are worth marking. Use from and to (YYYY-MM-DD, to = from for one day).',
        'kind "off": a holiday, the college closed, or a day with "no classes" (e.g. an exam day for a language test with no classes, an election day).',
        'kind "break": a study break, reading week or spring break.',
        'kind "exams": the evaluation and examination period at the end of a term, as one range.',
        'kind "swap": a day on which students follow another weekday\'s schedule; follows = that weekday, e.g. "Mon". If it is also the last day of classes, still one swap entry.',
        'kind "note": the course drop deadline, the course withdrawal deadline, the mid-point of the semester, the mid-term assessment deadline.',
        'Leave out registration periods, intersession courses, preference course changes, confirmation of attendance, grade submission deadlines, application deadlines, graduation and "extra day if needed".',
        'label: a short name, e.g. "Thanksgiving", "Study break", "Course drop deadline".',
        'Work out the year of each date from the semester it belongs to (an autumn semester and the winter after it are in different years). Never invent dates.',
        'Answer with one JSON object, no other text, using exactly this JSON Schema: ' + JSON.stringify(SCHEMA),
      ].join(' '),
    },
    { role: 'user', content: 'Today is ' + today + '.\n\nAcademic calendar:\n\n' + text },
  ];
}

/** Whatever the model returned, made safe: {name, terms, days}. 502 when there is no semester. */
export function cleanSchool(raw) {
  const o = modelJson(raw);
  if (!o) throw new HttpError(502, { error: 'school_unreadable' });
  const days = (Array.isArray(o.days) ? o.days : []).map((d) => ({ ...d, follows: dayIndex(d?.follows) }));
  const cal = normalizeSchool({ ...o, days });
  if (!cal) throw new HttpError(502, { error: 'school_unreadable' });
  return cal;
}

export async function readSchool(ai, { today, ...doc }) {
  const { answer, truncated } = await askModel(ai, doc, (text) => prompt(text, today));
  return { ...cleanSchool(answer), truncated };
}
