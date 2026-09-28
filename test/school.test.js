import { describe, it, expect } from 'vitest';
import { normalizeSchool, dayInfo, classWeekday, weekOf, currentTerm, termStartFor, schoolStatus } from '../src/core/school.ts';
import { lectureDates } from '../src/core/reviews.ts';
import { cleanSchool, readSchool } from '../worker/school.js';
import { MODEL } from '../worker/outline.js';
import { schoolCalendar } from '../worker/validate.js';
import { buildCalendar } from '../worker/calendar.js';
import { signIn, unfold } from './helpers.js';

/* Vanier College 2026–27, as its calendar reads (2026-08-24 is a Monday). */
const VANIER = {
  name: 'Vanier College 2026–27',
  terms: [
    { name: 'Autumn 2026', start: '2026-08-24', end: '2026-12-10' },
    { name: 'Winter 2027', start: '2027-01-19', end: '2027-05-14' },
  ],
  days: [
    { from: '2026-09-07', to: '2026-09-07', kind: 'off', label: 'Labour Day' },
    { from: '2026-10-05', to: '2026-10-05', kind: 'off', label: 'Provincial election' },
    { from: '2026-10-06', to: '2026-10-06', kind: 'swap', label: 'Monday schedule', follows: 1 },
    { from: '2026-10-12', to: '2026-10-12', kind: 'off', label: 'Thanksgiving' },
    { from: '2026-10-16', to: '2026-10-16', kind: 'note', label: 'Mid-point' },
    { from: '2026-12-11', to: '2026-12-22', kind: 'exams', label: 'Exams' },
    { from: '2027-03-08', to: '2027-03-12', kind: 'break', label: 'Study break' },
    { from: '2027-03-25', to: '2027-03-25', kind: 'swap', label: 'Monday schedule', follows: 1 },
  ],
};
const cal = normalizeSchool(VANIER);

describe('a school calendar', () => {
  it('keeps what is usable, in date order', () => {
    const c = normalizeSchool({
      name: '  Vanier  ', terms: [VANIER.terms[1], { name: 'Bad', start: '2026-13-01', end: '2026-12-01' }, VANIER.terms[0]],
      days: [{ from: '2026-10-06', kind: 'swap', label: 'x' }, { from: '2026-09-07', to: '2026-09-01', kind: 'off' }, { from: '2026-09-08', kind: 'party' }],
    });
    expect(c.name).toBe('Vanier');
    expect(c.terms.map((t) => t.name)).toEqual(['Autumn 2026', 'Winter 2027']);
    expect(c.days).toEqual([
      { from: '2026-09-07', to: '2026-09-07', kind: 'off', label: '' },
      { from: '2026-10-06', to: '2026-10-06', kind: 'swap', label: 'x', follows: 1 },
    ]);
    expect(normalizeSchool({ terms: [] })).toBeNull();
    expect(normalizeSchool({})).toBeNull();
  });

  it('says what kind of day each date is', () => {
    expect(dayInfo(cal, '2026-10-05')).toMatchObject({ kind: 'off', label: 'Provincial election' });
    expect(dayInfo(cal, '2026-10-06')).toMatchObject({ kind: 'swap', follows: 1 });
    expect(dayInfo(cal, '2026-10-16')).toMatchObject({ kind: 'class', notes: ['Mid-point'] });
    expect(dayInfo(cal, '2026-12-15')).toMatchObject({ kind: 'exams' });
    expect(dayInfo(cal, '2027-03-10')).toMatchObject({ kind: 'break' });
    expect(dayInfo(cal, '2026-07-15')).toMatchObject({ kind: 'none', label: 'No school' });
    expect(dayInfo(cal, '2027-01-05')).toMatchObject({ kind: 'none' });
  });

  it('runs the right timetable, or none', () => {
    expect(classWeekday(cal, '2026-10-05')).toBeNull();
    expect(classWeekday(cal, '2026-10-06')).toBe(1);        /* a Tuesday on Monday's classes */
    expect(classWeekday(cal, '2026-10-07')).toBe(3);
    expect(classWeekday(cal, '2026-12-14')).toBeNull();     /* exams */
    expect(classWeekday(cal, '2027-06-01')).toBeNull();     /* summer */
    expect(classWeekday(null, '2026-10-05')).toBe(1);       /* no calendar: every week */
  });

  it('numbers the weeks of each semester, the study break left out', () => {
    expect(weekOf(cal, '2026-08-24')).toMatchObject({ kind: 'week', week: 1, of: 16 });
    expect(weekOf(cal, '2026-10-08')).toMatchObject({ kind: 'week', week: 7, of: 16 });
    expect(weekOf(cal, '2026-12-16')).toMatchObject({ kind: 'exams', term: { name: 'Autumn 2026' } });
    expect(weekOf(cal, '2027-01-18')).toMatchObject({ kind: 'week', week: 1, of: 16 });   /* classes start on the Tuesday */
    expect(weekOf(cal, '2027-03-10')).toMatchObject({ kind: 'break', week: 8 });
    expect(weekOf(cal, '2027-03-15')).toMatchObject({ kind: 'week', week: 8, of: 16 });
    expect(weekOf(cal, '2026-07-01')).toBeNull();
  });

  it('follows the semester for the term start, then the one set', () => {
    expect(currentTerm(cal, '2026-06-01').name).toBe('Autumn 2026');
    expect(currentTerm(cal, '2027-02-01').name).toBe('Winter 2027');
    expect(termStartFor({ schoolCalendar: VANIER, termStart: '2026-01-01' }, '2027-02-01')).toBe('2027-01-19');
    expect(termStartFor({ schoolCalendar: {}, termStart: '2026-01-01' }, '2027-02-01')).toBe('2026-01-01');
    expect(schoolStatus(cal, '2026-09-26')).toBe('Autumn 2026 · week 5 of 16');
    expect(schoolStatus(cal, '2027-01-05', (d) => d)).toBe('Winter 2027 starts 2027-01-19');
  });

  it('keeps lecture reviews to days with classes', () => {
    const course = { id: 'n', code: 'NEURO', meetings: [{ id: 'm', kind: 'Lecture', weekday: 1 }] };
    const dates = lectureDates([course], '2026-10-01', '2026-10-14', cal).map((x) => x.date);
    expect(dates).toEqual(['2026-10-06']);   /* the 5th and 12th are off; the 6th runs Monday's */
  });
});

describe('reading and saving a school calendar', () => {
  it('cleans what the model returns', () => {
    const c = cleanSchool(JSON.stringify({ ...VANIER, days: [{ from: '2026-10-06', kind: 'swap', label: 'Monday schedule', follows: 'Monday' }, { from: 'soon', kind: 'off' }] }));
    expect(c.days).toEqual([{ from: '2026-10-06', to: '2026-10-06', kind: 'swap', label: 'Monday schedule', follows: 1 }]);
    expect(() => cleanSchool('{"name":"x","terms":[],"days":[]}')).toThrow();
    expect(() => cleanSchool('no json here')).toThrow();
  });

  it('reads text through the model once, after the claim', async () => {
    const calls = [];
    const ai = { async run(model, input) { calls.push(model, input.messages.length); return { response: JSON.stringify(VANIER) }; } };
    let claimed = 0;
    const text = 'Vanier academic calendar 2026 2027. August 24, Monday, first day of classes.';
    const out = await readSchool(ai, { bytes: new TextEncoder().encode(text), type: 'text/plain', name: 'c.txt', today: '2026-09-26', claim: () => { claimed++; } });
    expect(claimed).toBe(1);
    expect(calls).toEqual([MODEL, 2]);
    expect(out).toMatchObject({ name: 'Vanier College 2026–27', truncated: false });
    expect(out.terms).toHaveLength(2);
  });

  it('checks the shape on the profile', () => {
    expect(schoolCalendar({})).toEqual({});
    expect(schoolCalendar(VANIER).days[2]).toEqual({ from: '2026-10-06', to: '2026-10-06', kind: 'swap', label: 'Monday schedule', follows: 1 });
    for (const [bad, field] of [
      [{ ...VANIER, terms: [] }, 'schoolCalendar.terms'],
      [{ ...VANIER, terms: [{ name: 'A', start: '2026-12-01', end: '2026-09-01' }] }, 'schoolCalendar.terms[0].end'],
      [{ ...VANIER, days: [{ from: '2026-02-30', kind: 'off', label: '' }] }, 'schoolCalendar.days[0].from'],
      [{ ...VANIER, days: [{ from: '2026-02-03', kind: 'swap', label: '' }] }, 'schoolCalendar.days[0].follows'],
      [{ ...VANIER, days: [{ from: '2026-02-03', kind: 'nap', label: '' }] }, 'schoolCalendar.days[0].kind'],
    ]) {
      let body = null;
      try { schoolCalendar(bad); } catch (e) { body = e.body; }
      expect(body, field).toEqual({ error: 'invalid', field });
    }
  });

  it('is saved on the profile, kept when left out, and removed with {}', async () => {
    const api = await signIn();
    const body = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };
    let res = await api('/api/me', { method: 'PUT', body: { ...body, schoolCalendar: VANIER } });
    expect(res.status).toBe(200);
    expect((await res.json()).schoolCalendar.terms).toHaveLength(2);
    res = await api('/api/me', { method: 'PUT', body: { ...body, theme: 'light' } });
    expect((await res.json()).schoolCalendar.name).toBe('Vanier College 2026–27');
    res = await api('/api/me', { method: 'PUT', body: { ...body, schoolCalendar: {} } });
    expect((await res.json()).schoolCalendar).toEqual({});
  });
});

describe('the calendar feed with a school calendar', () => {
  const course = { id: 'n', code: 'NEURO', name: 'Neuroscience', archived: 0, created_at: Date.UTC(2026, 7, 1),
    meetings: JSON.stringify([{ id: 'm', kind: 'Lecture', weekday: 1, start: '10:00', end: '11:00', room: '' }]) };

  it('repeats each class within a semester, skips days off, and adds swapped days', () => {
    const ics = unfold(buildCalendar({ courses: [course], items: [], school: cal, now: Date.UTC(2026, 8, 26) }));
    expect(ics).toContain('UID:class-n-m-2026-08-24@rounds');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261210T235959');
    expect(ics).toMatch(/EXDATE:[^\r]*20260907T100000[^\r]*20261005T100000[^\r]*20261012T100000/);
    expect(ics).toContain('UID:class-n-m-2026-08-24-2026-10-06@rounds');
    expect(ics).toContain('DTSTART:20261006T100000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270514T235959');
    expect(ics).toMatch(/EXDATE:[^\r]*20270308T100000/);
  });
});
