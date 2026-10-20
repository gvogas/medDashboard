import { describe, it, expect, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { signIn, BASE } from './helpers.js';
import { OUTLINE_DAILY_LIMIT } from '../worker/limits.js';
import { cleanGrid, cleanSchedule, onGridLines, parseGrid, readSchedule, splitDays, VISION_MODEL, MAX_IMAGE_BYTES, toBase64 } from '../worker/schedule.js';
import { MODEL, cleanClasses } from '../worker/outline.js';
import visionReply from './fixtures/schedule-vision-reply.json';
import textReply from './fixtures/schedule-text-reply.json';

const TIMETABLE = 'Fall 2026 timetable. CHEM 271 Organic Chemistry I LEC Tue Thu 08:30-10:00 H-110. CHEM 271 LAB Fri 13:00-16:00 SP-265. PHYS 205 Waves LEC Mon 09:00-10:30 Hall B; TUT Wed 15:00-16:00 Room 2.04.';

/** A stand-in for env.AI that records what it was asked. */
function fakeAi(response) {
  const calls = [];
  return { calls, async run(model, input) { calls.push([model, input]); return { response }; }, async toMarkdown() { throw new Error('not used'); } };
}

const REPLY = {
  term: 'Fall 2026',
  courses: [
    { code: 'chem 271', name: 'Organic Chemistry I', classes: [
      { kind: 'Lecture', day: 'Tue', start: '8:30', end: '10:00', room: 'H-110' },
      { kind: 'Lecture', day: 'Thursday', start: '08:30', end: '10:00', room: 'H-110' },
      { kind: 'Lab', day: 'Fri', start: '1pm', end: '4pm', room: 'SP-265' },
    ] },
    { code: 'PHYS 205', name: 'Waves', classes: [
      { kind: 'Lecture', day: 'Mon', start: '09:00', end: '10:30', room: 'Hall B' },
      { kind: 'Tut', day: 'Wed', start: '15:00', end: '16:00', room: 'Room 2.04' },
    ] },
    { code: '', name: 'Study hall', classes: [] },
    { code: 'X', name: 'Ghost', classes: [{ kind: 'Lecture', day: 'Someday', start: '09:00' }] },
  ],
};

const fail = (raw) => { try { cleanSchedule(raw); } catch (e) { return [e.status, e.body.error]; } return null; };

describe('cleanSchedule', () => {
  it('normalises codes, days, times and kinds, and drops courses with no usable class', () => {
    expect(cleanSchedule(REPLY)).toEqual({
      term: 'Fall 2026',
      courses: [
        { code: 'CHEM271', name: 'Organic Chemistry I', classes: [
          { kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' },
          { kind: 'Lecture', weekday: 4, start: '08:30', end: '10:00', room: 'H-110' },
          { kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' },
        ] },
        { code: 'PHYS205', name: 'Waves', classes: [
          { kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' },
          { kind: 'Tutorial', weekday: 3, start: '15:00', end: '16:00', room: 'Room 2.04' },
        ] },
      ],
    });
  });

  it('makes a class whose room ends in a lone "L" a Lab, the room without it (Omnivox marks labs so)', () => {
    const { courses: [c] } = cleanSchedule({ term: '', courses: [{ code: '420-541-VA', name: 'Game Programming 2', classes: [
      { kind: 'Lecture', day: 'Mon', start: '10:00', end: '12:00', room: 'D-243 L' },
      { kind: 'Lecture', day: 'Fri', start: '10:00', end: '12:00', room: 'D-242' },
      { kind: 'Lecture', day: 'Wed', start: '10:30', end: '12:30', room: 'Hall L' },
      { kind: 'Lecture', day: 'Thu', start: '10:30', end: '12:30', room: 'HallL' },
    ] }] });
    expect(c.classes.map((k) => [k.kind, k.room])).toEqual([['Lab', 'D-243'], ['Lecture', 'D-242'], ['Lab', 'Hall'], ['Lecture', 'HallL']]);
  });

  it('drops the word "Classroom" before a room, and keeps a room that is only that word', () => {
    const { courses: [c] } = cleanSchedule({ term: '', courses: [{ code: '345-HSZ-VF', name: 'Le Contrat Racial', classes: [
      { kind: 'Lecture', day: 'Mon', start: '08:30', end: '10:00', room: 'Classroom N-362' },
      { kind: 'Lecture', day: 'Tue', start: '10:00', end: '12:00', room: 'Classroom D-243 L' },
      { kind: 'Lecture', day: 'Wed', start: '08:30', end: '10:00', room: 'classroom  A-312' },
      { kind: 'Lecture', day: 'Thu', start: '08:30', end: '10:00', room: 'Classroom' },
    ] }] });
    expect(c.classes.map((k) => [k.kind, k.room])).toEqual([['Lecture', 'N-362'], ['Lab', 'D-243'], ['Lecture', 'A-312'], ['Lecture', 'Classroom']]);
  });

  it('answers 502 when there is no JSON or no class at all', () => {
    expect(fail('I cannot read this')).toEqual([502, 'schedule_unreadable']);
    expect(fail({ term: '', courses: [] })).toEqual([502, 'schedule_unreadable']);
    expect(fail({ courses: [{ code: 'A', name: 'B', classes: [] }] })).toEqual([502, 'schedule_unreadable']);
  });

  it('keeps 15 courses and 12 classes a course', () => {
    const many = { courses: Array.from({ length: 20 }, (_, i) => ({ code: 'C' + i, name: 'N', classes: Array.from({ length: 14 }, (_, j) => ({ kind: 'Lecture', day: 'Mon', start: String(8 + (j % 10)).padStart(2, '0') + ':' + (j < 10 ? '00' : '30') })) })) };
    const out = cleanSchedule(many);
    expect(out.courses).toHaveLength(15);
    expect(out.courses[0].classes).toHaveLength(12);
  });

  it('puts the rows of one course together: by code, or by name when there is no code', () => {
    const out = cleanSchedule({ courses: [
      { code: 'CHEM 271', name: 'Organic Chemistry I', classes: [{ kind: 'LEC', day: 'Tue', start: '08:30' }] },
      { code: 'chem271', name: '', classes: [{ kind: 'LAB', day: 'Fri', start: '13:00' }, { kind: 'LEC', day: 'Tue', start: '08:30' }] },
      { code: '', name: 'Choir', classes: [{ kind: 'Seminar', day: 'Mon', start: '18:00' }] },
      { code: '', name: 'choir', classes: [{ kind: 'Seminar', day: 'Wed', start: '18:00' }] },
      { code: 'PHYS 205', name: 'Choir', classes: [{ kind: 'Lecture', day: 'Mon', start: '09:00' }] },
    ] });
    expect(out.courses.map((c) => [c.code, c.name, c.classes.map((k) => k.kind + k.weekday)])).toEqual([
      ['CHEM271', 'Organic Chemistry I', ['Lecture2', 'Lab5']],
      ['', 'Choir', ['Seminar1', 'Seminar3']],
      ['PHYS205', 'Choir', ['Lecture1']],
    ]);
  });
});

/* The replies of the one live read (1 October 2026) of test/fixtures/timetable.html: Llama 4
   Scout on a 1400x900 screenshot, gpt-oss-120b on the PDF's text. Scout answered each row as
   a course of its own (CHEM 271 twice: lecture, lab); cleanSchedule puts them together. */
describe('the real replies (Task 13)', () => {
  it.each([['screenshot', visionReply], ['PDF', textReply]])('read the sample timetable from a %s', (_, reply) => {
    const out = cleanSchedule(reply);
    expect(out.term).toBe('Fall 2026');
    expect(out.courses.map((c) => c.code).sort()).toEqual(['BIOL266', 'CHEM271', 'PHYS205']);
    const chem = out.courses.find((c) => c.code === 'CHEM271');
    expect(chem.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00' }),
      expect.objectContaining({ kind: 'Lecture', weekday: 4, start: '08:30', end: '10:00' }),
      expect.objectContaining({ kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' }),
    ]));
    expect(out.courses.find((c) => c.code === 'PHYS205').classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Tutorial', weekday: 3, start: '15:00', end: '16:00' }),
    ]));
    expect(out.courses.reduce((n, c) => n + c.classes.length, 0)).toBe(8);
  });

  it('both models agree on every class, room included', () => {
    const flat = (reply) => cleanSchedule(reply).courses
      .flatMap((c) => c.classes.map((k) => [c.code, k.kind, k.weekday, k.start, k.end, k.room].join(' '))).sort();
    expect(flat(visionReply)).toEqual(flat(textReply));
    expect(flat(textReply)).toEqual([
      'BIOL266 Lab 4 14:00 17:00 SP-110',
      'BIOL266 Lecture 1 13:00 14:30 CC-301',
      'CHEM271 Lab 5 13:00 16:00 SP-265',
      'CHEM271 Lecture 2 08:30 10:00 H-110',
      'CHEM271 Lecture 4 08:30 10:00 H-110',
      'PHYS205 Lecture 1 09:00 10:30 Hall B',
      'PHYS205 Lecture 3 09:00 10:30 Hall B',
      'PHYS205 Tutorial 3 15:00 16:00 Room 2.04',
    ]);
  });
});

describe('the class kinds', () => {
  it('reads the kinds timetables write', () => {
    const kinds = cleanClasses(['LEC', 'Lab', 'Laboratoire', 'TUT', 'TD', 'Seminar', 'PBL', 'Clinical skills', 'Cours', ''].map((kind, i) => ({ kind, day: 'Mon', start: String(8 + i).padStart(2, '0') + ':00' }))).map((c) => c.kind);
    expect(kinds).toEqual(['Lecture', 'Lab', 'Lab', 'Tutorial', 'Tutorial', 'Seminar', 'PBL', 'Clinical', 'Lecture', 'Lecture']);
  });
});

describe('readSchedule, text', () => {
  it("reads a timetable's text with the text model, thinking little, after claiming the read", async () => {
    const ai = fakeAi(REPLY);
    const claims = [];   /* the read is claimed before the model runs */
    const run = ai.run; ai.run = async (...a) => { claims.push('run'); return run(...a); };
    const out = await readSchedule(ai, { bytes: new TextEncoder().encode(TIMETABLE), type: 'text/plain', name: 't.pdf', today: '2026-09-01', claim: async () => { claims.push('claim'); } });
    const [model, input] = ai.calls[0];
    expect(model).toBe(MODEL);
    expect(input.reasoning).toEqual({ effort: 'low' });
    expect(input.max_tokens).toBe(3000);
    expect(input.messages[0].content).toContain('"courses"');
    expect(input.messages[1].content).toContain('Today is 2026-09-01.');
    expect(input.messages[1].content).toContain('CHEM 271 Organic Chemistry I');
    expect(claims).toEqual(['claim', 'run']);
    expect(out.courses.map((c) => c.code)).toEqual(['CHEM271', 'PHYS205']);
    expect(out).toMatchObject({ term: 'Fall 2026', truncated: false });
  });

  it('claims no read for a file with no text', async () => {
    const claim = vi.fn();
    await expect(readSchedule(fakeAi(REPLY), { bytes: new TextEncoder().encode('short'), type: 'text/plain', today: '2026-09-01', claim })).rejects.toMatchObject({ status: 422 });
    expect(claim).not.toHaveBeenCalled();
  });

  it('reads at most 16,000 characters of a timetable', async () => {
    const ai = fakeAi(REPLY);
    const long = Array.from({ length: 1200 }, (_, i) => 'CHEM 271 LEC Mon 09:00 row ' + i).join('\n');
    const out = await readSchedule(ai, { bytes: new TextEncoder().encode(long), type: 'text/plain', today: '2026-09-01' });
    expect(out.truncated).toBe(true);
    expect(ai.calls[0][1].messages[1].content.length).toBeLessThan(16_200);
  });
});

describe('the answers checked', () => {
  it('reads a "1:00" class as 13:00 and keeps the same class once', () => {
    expect(cleanClasses([
      { kind: 'Lecture', day: 'Mon', start: '1:00', end: '2:30' },
      { kind: 'Lecture', day: 'Mon', start: '13:00', end: '14:30' },
      { kind: 'Lab', day: 'Tue', start: '08:00', end: '11:00' },
    ])).toEqual([
      { kind: 'Lecture', weekday: 1, start: '13:00', end: '14:30', room: '' },
      { kind: 'Lab', weekday: 2, start: '08:00', end: '11:00', room: '' },
    ]);
  });

  it('tells both models the semesters and course codes', async () => {
    const known = { terms: ['Fall 2026'], codes: ['CHEM271'] };
    const text = fakeAi(REPLY);
    await readSchedule(text, { bytes: new TextEncoder().encode(TIMETABLE), type: 'text/plain', today: '2026-09-01', ...known });
    expect(text.calls[0][1].messages[1].content).toContain('"Fall 2026"');
    const image = fakeAi(REPLY);
    await readSchedule(image, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), type: 'image/jpeg', today: '2026-09-01', ...known });
    expect(image.calls[0][1].messages[1].content[0].text).toContain('the codes CHEM271');
  });
});

describe('readSchedule, a screenshot', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);

  it('goes to the vision model as a data URI, in JSON mode, after claiming the read', async () => {
    const ai = fakeAi(REPLY);   /* in JSON mode the model answers an object */
    const claims = [];   /* the read is claimed before the model runs */
    const run = ai.run; ai.run = async (...a) => { claims.push('run'); return run(...a); };
    const out = await readSchedule(ai, { bytes: jpeg, type: 'image/jpeg', name: 'shot.jpg', today: '2026-09-01', claim: async () => { claims.push('claim'); } });
    const [model, input] = ai.calls[0];
    expect(model).toBe(VISION_MODEL);
    expect(input.messages[0]).toMatchObject({ role: 'system' });
    expect(input.messages[0].content).toContain('class schedule');
    const [text, image] = input.messages[1].content;
    expect(text).toMatchObject({ type: 'text' });
    expect(text.text).toContain('Today is 2026-09-01.');
    expect(image.type).toBe('image_url');
    expect(image.image_url.url.startsWith('data:image/jpeg;base64,/9j/4')).toBe(true);
    expect(input.response_format).toEqual({ type: 'json_schema', json_schema: expect.objectContaining({ type: 'object' }) });
    expect(input.max_tokens).toBe(2000);
    expect(claims).toEqual(['claim', 'run']);
    expect(out).toMatchObject({ term: 'Fall 2026', truncated: false });
    expect(out.courses).toHaveLength(2);
  });

  it('reads an answer that came back as JSON text too', async () => {
    const out = await readSchedule(fakeAi(JSON.stringify(REPLY)), { bytes: jpeg, type: 'image/png', today: '2026-09-01' });
    expect(out.courses[0].code).toBe('CHEM271');
  });

  it('refuses other pictures and big ones before claiming a read', async () => {
    const claim = vi.fn();
    await expect(readSchedule(fakeAi(REPLY), { bytes: jpeg, type: 'image/gif', today: '2026-09-01', claim }))
      .rejects.toMatchObject({ status: 415, body: { error: 'image_unsupported' } });
    await expect(readSchedule(fakeAi(REPLY), { bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), type: 'image/png', today: '2026-09-01', claim }))
      .rejects.toMatchObject({ status: 413, body: { error: 'too_large' } });
    expect(claim).not.toHaveBeenCalled();
  });

  it('gives the picture model only what is left of the read deadline', async () => {
    const ai = { run: vi.fn(() => new Promise(() => {})) };
    const t0 = Date.now();
    await expect(readSchedule(ai, { bytes: jpeg, type: 'image/png', today: '2026-09-01', deadline: t0 + 60 }))
      .rejects.toMatchObject({ status: 504, body: { error: 'ai_timeout' } });
    expect(Date.now() - t0).toBeLessThan(150);
  });

  it('takes a type with parameters and image/jpg, and builds the data URI from the bare type', async () => {
    const png = fakeAi(REPLY);
    await readSchedule(png, { bytes: jpeg, type: 'image/png; x=y', today: '2026-09-01' });
    expect(png.calls[0][1].messages[1].content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
    const jpg = fakeAi(REPLY);
    await readSchedule(jpg, { bytes: jpeg, type: 'Image/JPG', today: '2026-09-01' });
    expect(jpg.calls[0][1].messages[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,/9j/4')).toBe(true);
  });

  it('writes base64 in chunks', () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    const back = atob(toBase64(big));
    expect(back.length).toBe(100_000);
    expect(back.charCodeAt(99_999)).toBe(99_999 % 256);
  });
});

describe('answers in other shapes', () => {
  it('splits the day lists models and timetables write', () => {
    expect(splitDays('Tue/Thu')).toEqual(['Tue', 'Thu']);
    expect(splitDays('Tue, Thu')).toEqual(['Tue', 'Thu']);
    expect(splitDays('Tuesday and Thursday')).toEqual(['Tuesday', 'Thursday']);
    expect(splitDays('MWF')).toEqual(['Mon', 'Wed', 'Fri']);
    expect(splitDays('TTh')).toEqual(['Tue', 'Thu']);
    expect(splitDays('TR')).toEqual(['Tue', 'Thu']);
    expect(splitDays(['Mon', 'Wed'])).toEqual(['Mon', 'Wed']);
    expect(splitDays('Lun et Mer')).toEqual(['Lun', 'Mer']);
    expect(splitDays('Thursday')).toEqual(['Thursday']);
  });

  it('reads a flat list of classes that each name their course, a time range in one field, and French days', () => {
    const out = cleanSchedule({ response: [
      { course_code: 'CHEM 271', title: 'Organic Chemistry I', day: 'Tue/Thu', time: '8:30 a.m. - 10:00 a.m.', location: 'H-110', kind: 'LEC' },
      { code: 'CHEM 271', name: 'Organic Chemistry I', days: 'F', start: '1:00 PM', end: '4:00 PM', room: 'SP-265 L' },
      { code: 'PHYS 205', name: 'Waves', day: 'Lundi', start: '09:00:00', end: '10:30:00', room: 'Hall B' },
    ] });
    expect(out.courses).toEqual([
      { code: 'CHEM271', name: 'Organic Chemistry I', classes: [
        { kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' },
        { kind: 'Lecture', weekday: 4, start: '08:30', end: '10:00', room: 'H-110' },
        { kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' },
      ] },
      { code: 'PHYS205', name: 'Waves', classes: [{ kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' }] },
    ]);
  });

  it('finds the courses under another name, in a code fence, or in the schema the model echoed', () => {
    const one = { code: 'PHYS 1', name: 'M', classes: [{ kind: 'Lecture', day: 'MW', start: '09:00-10:30' }] };
    expect(cleanSchedule('```json\n' + JSON.stringify({ schedule: { courses: [one] } }) + '\n```').courses[0].classes).toHaveLength(2);
    expect(cleanSchedule({ choices: [{ message: { content: JSON.stringify({ timetable: [one] }) } }] }).courses).toHaveLength(1);
    expect(cleanSchedule({ type: 'object', properties: { term: 'Fall', courses: [one] } }).term).toBe('Fall');
    expect(cleanSchedule({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ courses: [one] }) }] }] }).courses).toHaveLength(1);
  });
});

describe('a screenshot JSON mode cannot read', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(64).fill(1)]);

  it('is asked again in plain mode, in the same read, when JSON mode throws', async () => {
    const calls = [];
    const ai = { async run(model, input) {
      calls.push(input);
      if (input.response_format) throw new Error('AiError: 5025: JSON Mode couldn\'t be met');
      return { response: JSON.stringify(REPLY) };
    } };
    const claim = vi.fn();
    const out = await readSchedule(ai, { bytes: png, type: 'image/png', today: '2026-09-01', claim });
    expect(out.courses).toHaveLength(2);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].response_format).toBeUndefined();
    expect(calls[1].messages[0].content).toContain('JSON Schema');
  });

  it('is asked again in plain mode when its answer has no class, and says both answers when that fails too', async () => {
    const ai = { run: vi.fn(async (model, input) => ({ response: input.response_format ? { term: '', courses: [] } : 'I cannot read this image.' })) };
    const failed = await readSchedule(ai, { bytes: png, type: 'image/png', today: '2026-09-01' }).catch((e) => e);
    expect(failed).toMatchObject({ status: 502, body: { error: 'schedule_unreadable' } });
    expect(failed.detail).toContain('"courses":[]');
    expect(failed.detail).toContain('then, in plain mode:');
    expect(failed.detail).toContain('I cannot read this image.');
    expect(ai.run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('is not asked again when the allowance is spent', async () => {
    const ai = { run: vi.fn(async () => { throw new Error('AiError: 4006: you have used up your daily free allocation of 10,000 neurons'); }) };
    await expect(readSchedule(ai, { bytes: png, type: 'image/png', today: '2026-09-01' })).rejects.toMatchObject({ status: 429, body: { error: 'outline_quota' } });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });
});

/* A made-up week laid out as an Omnivox grid is: 08:00–18:00 in 20 half-hour rows, Monday to
   Friday; blocks in the order the browser numbers them (column by column, top to bottom). */
const LOOKALIKE = [
  // col, first row, last row, code, name, room
  [0, 1, 3, '111-AAA-VF', 'History of Ideas', 'Classroom N-100'],
  [0, 4, 7, '222-541-VA', 'Graphics Programming', 'Classroom D-201    L'],
  [0, 10, 15, '222-521-VA', 'Network Design', 'Classroom D-202    L'],
  [0, 16, 19, '222-511-VA', 'Cloud Services', 'Classroom D-203'],
  [1, 4, 7, '222-531-VA', 'Embedded Systems', 'Classroom D-204'],
  [1, 16, 19, '222-511-VA', 'Cloud Services', 'Classroom D-205    L'],
  [2, 1, 4, '222-531-VA', 'Embedded Systems', 'Classroom D-204    L'],
  [2, 5, 8, '222-541-VA', 'Graphics Programming', 'Classroom D-201    L'],
  [2, 12, 17, '333-E02-MQ', 'Projet intégrateur', 'Classroom A-300'],
  [3, 1, 3, '111-AAA-VF', 'History of Ideas', 'Classroom N-100'],
  [3, 4, 7, '222-511-VA', 'Cloud Services', 'Classroom D-206    L'],
  [3, 12, 15, '222-521-VA', 'Network Design', 'Classroom D-207'],
  [4, 4, 7, '222-541-VA', 'Graphics Programming', 'Classroom D-203'],
  [4, 12, 15, '222-531-VA', 'Embedded Systems', 'Classroom D-204    L'],
];
const LOOKALIKE_GRID = '5.20|' + LOOKALIKE.map(([c, f, t]) => c + ':' + f + '-' + t).join(',');
const lookalikeAnswer = (extra = []) => ({
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], firstTime: '08:00', lastTime: '18:00', term: '',
  blocks: [...LOOKALIKE.map(([, , , code, name, room], i) => ({ n: i + 1, code: code + ' sec.00002', name, room, kind: '' })), ...extra],
});

describe('a screenshot whose grid the browser found', () => {
  it('reads ?grid=, and refuses one that does not hold together', () => {
    expect(parseGrid('5.20|0:1-3,4:12-15')).toEqual({ cols: 5, rows: 20, blocks: [{ col: 0, from: 1, to: 3 }, { col: 4, from: 12, to: 15 }] });
    expect(parseGrid('')).toBeNull();
    expect(parseGrid('5.20|5:1-3')).toBeNull();      // no sixth column
    expect(parseGrid('5.20|0:3-1')).toBeNull();      // ends before it starts
    expect(parseGrid('5.20|0:1-20')).toBeNull();     // past the last row
    expect(parseGrid('5.20|0:1-3;DROP')).toBeNull();
  });

  it('puts each block on its column\'s weekday and its rows\' times: all 14 classes of the look-alike exactly', () => {
    const grid = parseGrid(LOOKALIKE_GRID);
    const out = cleanGrid({ response: lookalikeAnswer() }, grid);
    const meetings = out.courses.flatMap((c) => c.classes.map((m) => [c.code, m.weekday, m.start, m.end, m.room, m.kind]));
    expect(meetings).toHaveLength(14);
    expect(meetings).toEqual(expect.arrayContaining([
      ['111AAAVF', 1, '08:30', '10:00', 'N-100', 'Lecture'],
      ['222541VA', 1, '10:00', '12:00', 'D-201', 'Lab'],
      ['222521VA', 1, '13:00', '16:00', 'D-202', 'Lab'],
      ['222511VA', 1, '16:00', '18:00', 'D-203', 'Lecture'],
      ['222531VA', 2, '10:00', '12:00', 'D-204', 'Lecture'],
      ['222511VA', 2, '16:00', '18:00', 'D-205', 'Lab'],
      ['222531VA', 3, '08:30', '10:30', 'D-204', 'Lab'],
      ['222541VA', 3, '10:30', '12:30', 'D-201', 'Lab'],
      ['333E02MQ', 3, '14:00', '17:00', 'A-300', 'Lecture'],
      ['111AAAVF', 4, '08:30', '10:00', 'N-100', 'Lecture'],
      ['222511VA', 4, '10:00', '12:00', 'D-206', 'Lab'],
      ['222521VA', 4, '14:00', '16:00', 'D-207', 'Lecture'],
      ['222541VA', 5, '10:00', '12:00', 'D-203', 'Lecture'],
      ['222531VA', 5, '14:00', '16:00', 'D-204', 'Lab'],
    ]));
    expect(out.courses.map((c) => c.code)).toEqual(['111AAAVF', '222541VA', '222521VA', '222511VA', '222531VA', '333E02MQ']);
  });

  it('drops a block the model says is empty (a scribble), and one it said nothing of', () => {
    const grid = parseGrid(LOOKALIKE_GRID + ',3:17-17,4:17-17');
    const out = cleanGrid({ response: lookalikeAnswer([{ n: 15, code: '', name: '', room: '', empty: true }]) }, grid);
    expect(out.courses.flatMap((c) => c.classes)).toHaveLength(14);
  });

  it('drops a block with no code when the others have one (handwriting the model copied), but keeps one named as a coded course', () => {
    const grid = parseGrid(LOOKALIKE_GRID + ',3:17-17,4:17-17');
    const out = cleanGrid({ response: lookalikeAnswer([
      { n: 15, code: '', name: 'ml', room: '' },
      { n: 16, code: '', name: lookalikeAnswer().blocks[0].name, room: 'X-1' },
    ]) }, grid);
    expect(out.courses.flatMap((c) => c.classes)).toHaveLength(15);
    expect(out.courses.some((c) => c.name === 'ml')).toBe(false);
    expect(out.courses.find((c) => c.name === lookalikeAnswer().blocks[0].name).classes.some((m) => m.room === 'X-1')).toBe(true);
  });

  it('takes the weekdays from the headings (a grid from Sunday), and Monday first without them', () => {
    const grid = parseGrid('7.20|0:1-3,1:1-3');
    const answer = { days: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'], firstTime: '8:00 AM', lastTime: '6:00 PM', blocks: [{ n: 1, code: 'A 1', name: 'A', room: '' }, { n: 2, code: 'B 1', name: 'B', room: '' }] };
    expect(cleanGrid(answer, grid).courses.map((c) => c.classes[0].weekday)).toEqual([0, 1]);
    expect(cleanGrid({ ...answer, days: [] }, parseGrid('5.20|0:1-3')).courses[0].classes[0]).toMatchObject({ weekday: 1, start: '08:30', end: '10:00' });
  });

  it('answers 502, saying why, when the side\'s times cannot be read', () => {
    const failed = (() => { try { cleanGrid({ ...lookalikeAnswer(), lastTime: '' }, parseGrid(LOOKALIKE_GRID)); } catch (e) { return e; } })();
    expect(failed).toMatchObject({ status: 502, body: { error: 'schedule_unreadable' } });
    expect(failed.detail).toContain('grid times not read');
  });

  it('asks the vision model for the numbered blocks\' words, with where each is', async () => {
    const ai = fakeAi(lookalikeAnswer());
    const out = await readSchedule(ai, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]), type: 'image/jpeg', today: '2026-09-01', grid: LOOKALIKE_GRID });
    const [model, input] = ai.calls[0];
    expect(model).toBe(VISION_MODEL);
    expect(input.messages[0].content).toContain('red number');
    expect(input.messages[1].content[0].text).toContain('block 1: column 1, rows 2–4');
    expect(input.response_format.json_schema.required).toContain('blocks');
    expect(out.courses.flatMap((c) => c.classes)).toHaveLength(14);
  });

  it('reads the picture as before when ?grid= is missing or bad', async () => {
    const ai = fakeAi(REPLY);
    await readSchedule(ai, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0]), type: 'image/jpeg', today: '2026-09-01', grid: 'nonsense' });
    expect(ai.calls[0][1].messages[0].content).not.toContain('red number');
  });
});

describe("a PDF's grid lines", () => {
  /* the lines the browser writes from the look-alike's PDF (test/fixtures/omnivox-grid.html), checked by hand */
  const clock = (r) => { const m = 480 + r * 30; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const D = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const TEXT = '### Page 1\nTimetable grid (each line is one class: its weekday and its start and end times, read from the page layout):\n'
    + LOOKALIKE.map(([c, f, t, code, name, room]) => D[c] + ' ' + clock(f) + '-' + clock(t + 1) + ' | ' + name + ' | ' + code + ' sec.00002 | ' + room.replace(/\s+/g, ' ') + ' | Classroom').join('\n');

  it('give every class its weekday and times, whatever the model made of them', () => {
    /* what went wrong live: starts a row late, ends made up, a class on the wrong day, one dropped */
    const model = { term: '', courses: [
      { code: '111AAAVF', name: 'History of Ideas', classes: [{ kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: 'N-100' }] },
      { code: '222541VA', name: 'Graphics Programming', classes: [{ kind: 'Lab', weekday: 1, start: '10:30', end: '12:00', room: 'D-201' }] },
      { code: '222521VA', name: 'Network Design', classes: [{ kind: 'Lab', weekday: 1, start: '14:30', end: '16:30', room: 'D-202' }] },
      { code: '222511VA', name: 'Cloud Services', classes: [{ kind: 'Lecture', weekday: 3, start: '12:00', end: '14:30', room: 'D-206' }] },
      { code: '222531VA', name: 'Embedded Systems', classes: [{ kind: 'Lecture', weekday: 2, start: '10:30', end: '12:00', room: 'D-204' }] },
      { code: '333E02MQ', name: 'Projet intégrateur', classes: [{ kind: 'Lab', weekday: 3, start: '15:00', end: '16:30', room: 'A-300' }] },
    ] };
    const out = onGridLines(model, TEXT);
    const meetings = out.courses.flatMap((c) => c.classes.map((m) => [c.code, m.weekday, m.start, m.end, m.room]));
    expect(meetings).toHaveLength(14);
    expect(meetings).toEqual(expect.arrayContaining([
      ['111AAAVF', 1, '08:30', '10:00', 'N-100'], ['111AAAVF', 4, '08:30', '10:00', 'N-100'],
      ['222541VA', 1, '10:00', '12:00', 'D-201'], ['222541VA', 3, '10:30', '12:30', 'D-201'], ['222541VA', 5, '10:00', '12:00', 'D-203'],
      ['222521VA', 1, '13:00', '16:00', 'D-202'], ['222521VA', 4, '14:00', '16:00', 'D-207'],
      ['222511VA', 1, '16:00', '18:00', 'D-203'], ['222511VA', 2, '16:00', '18:00', 'D-205'], ['222511VA', 4, '10:00', '12:00', 'D-206'],
      ['222531VA', 2, '10:00', '12:00', 'D-204'], ['222531VA', 3, '08:30', '10:30', 'D-204'], ['222531VA', 5, '14:00', '16:00', 'D-204'],
      ['333E02MQ', 3, '14:00', '17:00', 'A-300'],
    ]));
    /* a lab by its room's lone "L" */
    expect(out.courses.find((c) => c.code === '222531VA').classes.map((m) => m.kind)).toEqual(['Lecture', 'Lab', 'Lab']);
  });

  it("leave the model's classes when a line names none of its courses, or there are no lines", () => {
    const model = { term: '', courses: [{ code: 'XYZ1', name: 'Other', classes: [{ kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: '' }] }] };
    expect(onGridLines(model, TEXT)).toBe(model);
    expect(onGridLines(model, 'no grid here')).toBe(model);
  });
});

describe('POST /api/ai/schedule', () => {
  it('needs a session', async () => {
    const res = await SELF.fetch(`${BASE}/api/ai/schedule`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: TIMETABLE });
    expect(res.status).toBe(401);
  });

  it('refuses a picture it cannot read, and shares the daily reads with outlines', async () => {
    const call = await signIn('schedule-route');
    const gif = await call('/api/ai/schedule?name=a.gif', { method: 'POST', headers: { 'content-type': 'image/gif' }, body: 'GIF89a' });
    expect(gif.status).toBe(415);
    await env.DB.prepare('INSERT OR REPLACE INTO request_limits (key, hits, reset_at) VALUES (?, ?, ?)')
      .bind('outline:u-schedule-route', OUTLINE_DAILY_LIMIT, Date.now() + 3_600_000).run();
    const over = await call('/api/ai/schedule?name=t.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: TIMETABLE });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('outline_limit');
  });

  it('answers 503 when Workers AI is out of reach', async () => {
    const call = await signIn();
    const res = await call('/api/ai/schedule?name=t.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: TIMETABLE });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'outline_unavailable' });
  });
});
