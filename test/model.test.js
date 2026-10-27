import { describe, it, expect } from 'vitest';
import { normalizeItem, normalizeCourse, normalizeAchievement, shiftEnd, typeList, isOpen, isComplete } from '../src/core/model.ts';
import { ago } from '../src/core/dates.ts';
import { validateItem, validateCourse } from '../worker/validate.js';

describe('normalizeItem keeps times and dates the server accepts', () => {
  it('moves an end that is not after the start to an hour later', () => {
    expect(normalizeItem({ date: '2026-09-24', start: '11:00', end: '10:00' }).end).toBe('12:00');
    expect(normalizeItem({ date: '2026-09-24', start: '11:00', end: '11:00' }).end).toBe('12:00');
    expect(normalizeItem({ date: '2026-09-24', start: '23:30', end: '09:00' }).end).toBe('23:59');
    expect(normalizeItem({ date: '2026-09-24', start: '09:00', end: '10:00' }).end).toBe('10:00');
    expect(normalizeItem({ date: '2026-09-24', start: '', end: '10:00' }).end).toBe('10:00');
    expect(normalizeItem({ date: '2026-09-24', start: '23:59', end: '10:00' }).end).toBe('');
  });

  it('drops a repeat-until date that is before the item date', () => {
    expect(normalizeItem({ date: '2026-09-24', recur: 'weekly', recurUntil: '2026-09-01' }).recurUntil).toBe(null);
    expect(normalizeItem({ date: '2026-09-24', recur: 'weekly', recurUntil: '2026-12-01' }).recurUntil).toBe('2026-12-01');
  });
});

describe('shiftEnd', () => {
  it('keeps the length when the start moves', () => {
    expect(shiftEnd('09:00', '10:30', '11:00')).toBe('12:30');
    expect(shiftEnd('09:00', '10:00', '23:30')).toBe('23:59');
  });
  it('leaves the end alone when there was no full range before', () => {
    expect(shiftEnd('', '10:00', '11:00')).toBe('10:00');
    expect(shiftEnd('09:00', '', '11:00')).toBe('');
  });
});

/* What this device saves, the server must accept: a refused edit leaves the board. */
describe('normalized rows pass the server checks', () => {
  const long = (n) => 'x'.repeat(n);
  it('cuts the text of an item to the server limits and drops links it would refuse', () => {
    const row = normalizeItem({
      type: 'task', title: long(300), date: '2026-09-24', status: 'todo', where: long(200), notes: long(6000), dept: long(90),
      checklist: Array.from({ length: 60 }, (_, i) => ({ id: 's' + i, text: long(200) })),
      links: [
        { label: long(200), url: 'https://example.com/' + long(400) },
        { label: 'too long', url: 'https://example.com/' + long(600) },
        { label: 'space', url: 'https://exa mple.com' },
        { label: 'space in path', url: 'https://example.com/a b' },
        { label: 'no scheme', url: 'example.com' },
      ],
    });
    expect(() => validateItem(row)).not.toThrow();
    expect(row.title).toHaveLength(140);
    expect(row.checklist).toHaveLength(50);
    expect(row.links).toHaveLength(2);
    expect(row.links[0].label).toHaveLength(60);
  });
  it('cuts the text of a course to the server limits', () => {
    const c = normalizeCourse({ code: 'ANAT', name: long(200), instructor: long(90), term: long(90),
      meetings: [{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: long(90) }] });
    expect(() => validateCourse(c)).not.toThrow();
  });
});

describe('rows from storage or the network are made safe', () => {
  it('keeps only the sticker pictures the server takes', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(normalizeAchievement({ sticker: png }).sticker).toBe(png);
    expect(normalizeAchievement({ sticker: 'data:image/svg+xml;base64,PHN2Zz4=' }).sticker).toBe('');
    expect(normalizeAchievement({ sticker: 'javascript:alert(1)' }).sticker).toBe('');
  });
  it('reads a course code that is not text as none, rather than failing every reload', () => {
    expect(normalizeCourse({ code: 12345 }).code).toBe('');
    expect(normalizeCourse({ code: 'PHARM1010' }).code).toBe('PHARM101');
  });
  it('drops a null step or class rather than failing every reload', () => {
    expect(normalizeItem({ date: '2026-09-24', checklist: [null, { text: 'Read ch. 3' }] }).checklist.map((c) => c.text)).toEqual(['', 'Read ch. 3']);
    expect(normalizeCourse({ meetings: [null, { weekday: 2, start: '10:00' }] }).meetings).toHaveLength(1);
  });
  it('keeps the last day of a class when it is a real date, and drops anything else', () => {
    const until = (u) => normalizeCourse({ meetings: [{ weekday: 2, start: '10:00', until: u }] }).meetings[0];
    expect(until('2026-11-16').until).toBe('2026-11-16');
    for (const bad of ['', null, undefined, '2026-02-30', '16/11/2026', 20261116]) expect('until' in until(bad)).toBe(false);
  });
  it('validates the last day of a class: kept when set, left off when empty, refused when not a date', () => {
    const base = { id: 'c', code: 'A', name: 'A', color: '#E4749B', meetings: [{ id: 'm', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: '' }] };
    const one = (u) => validateCourse({ ...base, meetings: [{ ...base.meetings[0], ...u }] }).meetings[0];
    expect(one({ until: '2026-11-16' }).until).toBe('2026-11-16');
    for (const empty of [{}, { until: '' }, { until: null }]) expect('until' in one(empty)).toBe(false);
    for (const bad of ['2026-02-30', 'soon', 5]) expect(() => one({ until: bad })).toThrow();
  });
  it('takes no built-in object key for a type or a status', () => {
    expect(normalizeItem({ date: '2026-09-24', type: 'constructor' }).type).toBe('task');
    expect(isOpen({ status: 'constructor' })).toBe(true);
    expect(isComplete({ status: 'toString' })).toBe(false);
  });
});

describe('ago', () => {
  const now = Date.UTC(2026, 9, 27, 12);
  it('says whole units, one day in the singular', () => {
    expect(ago(now - 3599_000, now)).toBe('59 min ago');
    expect(ago(now - 86399_000, now)).toBe('23 h ago');
    expect(ago(now - 86400_000, now)).toBe('1 day ago');
    expect(ago(now - 3 * 86400_000, now)).toBe('3 days ago');
  });
});

describe('projects by theme', () => {
  it('shows Projects by default for Computer Science and Engineering only', () => {
    const hidden = (bg) => typeList(bg).find((t) => t.id === 'project').hidden;
    expect(hidden('cs')).toBe(false);
    expect(hidden('eng')).toBe(false);
    expect(hidden('med')).toBe(true);
    expect(hidden('law')).toBe(true);
  });
});
