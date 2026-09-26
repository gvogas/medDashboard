import { describe, it, expect } from 'vitest';
import { normalizeItem, normalizeCourse, shiftEnd } from '../public/js/model.js';
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
        { label: 'no scheme', url: 'example.com' },
      ],
    });
    expect(() => validateItem(row)).not.toThrow();
    expect(row.title).toHaveLength(140);
    expect(row.checklist).toHaveLength(50);
    expect(row.links).toHaveLength(1);
    expect(row.links[0].label).toHaveLength(60);
  });
  it('cuts the text of a course to the server limits', () => {
    const c = normalizeCourse({ code: 'ANAT', name: long(200), instructor: long(90), term: long(90),
      meetings: [{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: long(90) }] });
    expect(() => validateCourse(c)).not.toThrow();
  });
});
