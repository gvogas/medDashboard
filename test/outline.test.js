import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { cleanOutline, cleanTime, readOutline, outlineText, MODEL, MAX_CHARS } from '../worker/outline.js';
import { signIn, BASE } from './helpers.js';
import { OUTLINE_DAILY_LIMIT } from '../worker/limits.js';

const OUTLINE = 'PHARM101 Principles of Pharmacology. Dr. Ada Okafor. Lectures Monday and Wednesday 9-10am in LT2. Midterm exam 20 October 2026 (30%). Essay due 1 November (20%). Final exam (50%).';

/** A stand-in for env.AI that records what it was asked. */
function fakeAi(response, markdown = { format: 'markdown', data: OUTLINE }) {
  const calls = [];
  return {
    calls,
    async toMarkdown(doc) { calls.push(['toMarkdown', doc.name, doc.blob.type]); return [markdown]; },
    async run(model, input) { calls.push(['run', model, input]); return { response }; },
  };
}

const MODEL_REPLY = {
  code: 'pharm 101', name: 'Principles of Pharmacology', instructor: 'Dr. Ada Okafor', term: '', termStart: '2026-09-07',
  classes: [
    { kind: 'Lecture', day: 'Mon', start: '9:00', end: '10:00', room: 'LT2' },
    { kind: 'Lecture', day: 'Wed', start: '9am', end: '10am', room: 'LT2' },
    { kind: 'Nap', day: 'Someday', start: '12:00' },
  ],
  officeHours: [{ day: 'Monday', start: '16:00', end: '17:00', room: 'SP 265' }, { day: 'Thu', start: '10:00', end: '11:00' }],
  assessments: [
    { title: 'Midterm exam', type: 'exam', date: '2026-10-20', weight: 30 },
    { title: 'Assignment 1', type: 'assignment', date: '', week: 7, weight: 12.5 },
    { title: 'Essay', type: 'assignment', date: '2026-11-01', weight: '20' },
    { title: 'Final exam', type: 'exam', date: 'TBA', weight: 50 },
    { title: '', type: 'exam' },
    { title: 'Participation', type: 'bonus', weight: 250 },
  ],
};

describe('cleanOutline', () => {
  it('normalises codes, times, dates and weights, and drops what cannot be used', () => {
    const o = cleanOutline(MODEL_REPLY);
    expect(o.code).toBe('PHARM101');
    expect(o.termStart).toBe('2026-09-07');
    expect(o.officeHours).toEqual([
      { weekday: 1, start: '16:00', end: '17:00', room: 'SP 265' },
      { weekday: 4, start: '10:00', end: '11:00', room: '' },
    ]);
    expect(o.assessments.find((a) => a.title === 'Assignment 1').week).toBe(7);
    expect(o.assessments.find((a) => a.title === 'Midterm exam').week).toBeNull();
    expect(cleanOutline({ ...MODEL_REPLY, termStart: 'September' }).termStart).toBe('');
    expect(o.classes).toEqual([
      { kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: 'LT2' },
      { kind: 'Lecture', weekday: 3, start: '09:00', end: '10:00', room: 'LT2' },
    ]);
    expect(o.assessments.map((a) => [a.title, a.type, a.date, a.weight])).toEqual([
      ['Midterm exam', 'exam', '2026-10-20', 30],
      ['Assignment 1', 'assignment', '', 12.5],
      ['Essay', 'assignment', '2026-11-01', 20],
      ['Final exam', 'exam', '', 50],
      ['Participation', 'task', '', null],
    ]);
  });

  it('shortens long course codes to eight characters', () => {
    expect(cleanOutline({ ...MODEL_REPLY, code: '420-521-VA' }).code).toBe('420521VA');
    expect(cleanOutline({ ...MODEL_REPLY, code: 'CHEM 271' }).code).toBe('CHEM271');
  });

  it('reads JSON from text, fenced text and a chat-completions reply', () => {
    const body = JSON.stringify({ code: 'A', name: 'B', classes: [], assessments: [] });
    expect(cleanOutline(body).name).toBe('B');
    expect(cleanOutline('Here it is:\n```json\n' + body + '\n```').name).toBe('B');
    expect(cleanOutline({ choices: [{ message: { content: body } }] }).name).toBe('B');
    expect(() => cleanOutline('not json')).toThrow();
    expect(() => cleanOutline(null)).toThrow();
  });

  it('reads the times people write', () => {
    expect(cleanTime('0900')).toBe('09:00');
    expect(cleanTime('2pm')).toBe('14:00');
    expect(cleanTime('12am')).toBe('00:00');
    expect(cleanTime('14.30')).toBe('14:30');
    expect(cleanTime('25:00')).toBe('');
    expect(cleanTime('noon')).toBe('');
  });
});

describe('readOutline', () => {
  it('converts a PDF with toMarkdown and extracts with the JSON schema', async () => {
    const ai = fakeAi(MODEL_REPLY);
    const out = await readOutline(ai, { bytes: new Uint8Array([37, 80, 68, 70]), type: 'application/pdf', name: 'pharm.pdf', today: '2026-09-23', termStart: '2026-09-07' });
    expect(ai.calls[0]).toEqual(['toMarkdown', 'pharm.pdf', 'application/pdf']);
    const [, model, input] = ai.calls[1];
    expect(model).toBe(MODEL);
    expect(input.response_format).toBeUndefined();
    expect(input.messages[0].content).toContain('"officeHours"');
    expect(input.messages[1].content).toContain('The term started on 2026-09-07.');
    expect(input.messages[1].content).toContain(OUTLINE);
    expect(out).toMatchObject({ code: 'PHARM101', truncated: false });
  });

  it('sends plain text as it is and truncates long outlines', async () => {
    const ai = fakeAi(MODEL_REPLY);
    const long = 'x'.repeat(MAX_CHARS + 500);
    const out = await readOutline(ai, { bytes: new TextEncoder().encode(long), type: 'text/plain; charset=utf-8', today: '2026-09-23' });
    expect(ai.calls[0][0]).toBe('run');
    expect(out.truncated).toBe(true);
  });

  it('reports a spent daily AI allowance as its own error', async () => {
    const ai = { run: async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); } };
    await expect(readOutline(ai, { bytes: new TextEncoder().encode(OUTLINE), type: 'text/plain', today: '2026-09-23' }))
      .rejects.toMatchObject({ status: 429, body: { error: 'outline_quota' } });
    const coded = { run: async () => { throw new Error('AiError: 4006'); } };
    await expect(readOutline(coded, { bytes: new TextEncoder().encode(OUTLINE), type: 'text/plain', today: '2026-09-23' }))
      .rejects.toMatchObject({ status: 429 });
  });

  it('reports documents that cannot be converted or are empty', async () => {
    await expect(outlineText(fakeAi({}, { format: 'error', error: 'bad' }), new Uint8Array(4), 'application/pdf', 'x.pdf'))
      .rejects.toMatchObject({ status: 422 });
    await expect(readOutline(fakeAi({}), { bytes: new TextEncoder().encode('too short'), type: 'text/plain', today: '2026-09-23' }))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe('the daily attempt', () => {
  it('is claimed just before the model runs, never for a file with no text', async () => {
    const claims = [];
    const claim = async () => { claims.push('claim'); };
    await expect(readOutline(fakeAi({}), { bytes: new TextEncoder().encode('too short'), type: 'text/plain', today: '2026-09-23', claim })).rejects.toMatchObject({ status: 422 });
    await expect(readOutline(fakeAi({}, { format: 'error' }), { bytes: new Uint8Array(4), type: 'application/pdf', today: '2026-09-23', claim })).rejects.toMatchObject({ status: 422 });
    expect(claims).toEqual([]);
    const ai = fakeAi(MODEL_REPLY);
    const run = ai.run;
    ai.run = async (...args) => { claims.push('run'); return run(...args); };
    await readOutline(ai, { bytes: new TextEncoder().encode(OUTLINE), type: 'text/plain', today: '2026-09-23', claim });
    expect(claims).toEqual(['claim', 'run']);
  });

  it('is not spent on an outline that cannot be read', async () => {
    const call = await signIn('outline-empty');
    await env.DB.prepare('INSERT OR REPLACE INTO request_limits (key, hits, reset_at) VALUES (?, ?, ?)')
      .bind('outline:u-outline-empty', OUTLINE_DAILY_LIMIT - 1, Date.now() + 3_600_000).run();
    const post = (body) => call('/api/outline?name=a.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
    for (let i = 0; i < 3; i++) expect(await (await post('too short')).json()).toEqual({ error: 'outline_empty' });
    expect((await post(OUTLINE)).status).toBe(503);   // the last attempt reaches the (absent) model
    expect((await post(OUTLINE)).status).toBe(429);
    expect((await post('too short')).status).toBe(422);
  });
});

describe('POST /api/outline', () => {
  it('needs a session', async () => {
    const res = await SELF.fetch(`${BASE}/api/outline`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: OUTLINE });
    expect(res.status).toBe(401);
  });

  it('refuses empty and oversized files', async () => {
    const call = await signIn();
    expect((await call('/api/outline', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '' })).status).toBe(400);
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    expect((await call('/api/outline', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: big })).status).toBe(413);
  });

  it('answers 503 when Workers AI is out of reach, and stops after the daily limit', async () => {
    const call = await signIn();
    const post = () => call('/api/outline?name=a.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: OUTLINE });
    const first = await post();
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ error: 'outline_unavailable' });
    for (let i = 1; i < 10; i++) await post();
    const over = await post();
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('outline_limit');
  });
});
