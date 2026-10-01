import { describe, it, expect, vi } from 'vitest';
import { cleanSchedule, readSchedule } from '../worker/schedule.js';
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
    const claims = [];
    const out = await readSchedule(ai, { bytes: new TextEncoder().encode(TIMETABLE), type: 'text/plain', name: 't.pdf', today: '2026-09-01', claim: async () => { claims.push('claim'); } });
    const [model, input] = ai.calls[0];
    expect(model).toBe(MODEL);
    expect(input.reasoning).toEqual({ effort: 'low' });
    expect(input.max_tokens).toBe(3000);
    expect(input.messages[0].content).toContain('"courses"');
    expect(input.messages[1].content).toContain('Today is 2026-09-01.');
    expect(input.messages[1].content).toContain('CHEM 271 Organic Chemistry I');
    expect(claims).toEqual(['claim']);
    expect(out.courses.map((c) => c.code)).toEqual(['CHEM271', 'PHYS205']);
    expect(out).toMatchObject({ term: 'Fall 2026', truncated: false });
  });

  it('claims no read for a file with no text', async () => {
    const claim = vi.fn();
    await expect(readSchedule(fakeAi(REPLY), { bytes: new TextEncoder().encode('short'), type: 'text/plain', today: '2026-09-01', claim })).rejects.toMatchObject({ status: 422 });
    expect(claim).not.toHaveBeenCalled();
  });
});
