import { describe, it, expect, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { signIn, BASE } from './helpers.js';
import { OUTLINE_DAILY_LIMIT } from '../worker/limits.js';
import { cleanSchedule, readSchedule, VISION_MODEL, MAX_IMAGE_BYTES, toBase64 } from '../worker/schedule.js';
import { MODEL, cleanClasses } from '../worker/outline.js';

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
