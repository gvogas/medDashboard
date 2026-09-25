import { describe, expect, it } from 'vitest';
import { validateCourse, validateItem, validateProfile } from '../worker/validate.js';

const item = { type: 'task', title: 'Study', date: '2026-09-22', status: 'todo' };
const profile = { coat: { color: '#E4749B' }, theme: 'system' };

describe('calendar validation', () => {
  it.each(['2026-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00'])('rejects nonexistent date %s everywhere', (date) => {
    expect(() => validateItem({ ...item, date })).toThrow();
    expect(() => validateItem({ ...item, recurUntil: date })).toThrow();
    expect(() => validateProfile({ ...profile, termStart: date })).toThrow();
  });

  it.each(['2024-02-29', '2000-02-29', '2026-04-30'])('accepts valid date %s', (date) => {
    expect(validateItem({ ...item, date }).date).toBe(date);
  });

  it.each(['24:00', '29:59', '12:60'])('rejects invalid clock time %s in items and meetings', (start) => {
    expect(() => validateItem({ ...item, start })).toThrow();
    expect(() => validateItem({ ...item, end: start })).toThrow();
    expect(() => validateCourse({ code: 'BIO', name: 'Biology', color: '#E4749B',
      meetings: [{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: start }],
    })).toThrow();
  });

  it('accepts midnight and the final minute of the day', () => {
    expect(validateItem({ ...item, start: '00:00', end: '23:59' })).toMatchObject({ start: '00:00', end: '23:59' });
  });
});

describe('item times and repeats', () => {
  it('rejects an end at or before the start, when both are set', () => {
    expect(() => validateItem({ ...item, start: '10:00', end: '10:00' })).toThrow(expect.objectContaining({ body: { error: 'invalid', field: 'end' } }));
    expect(() => validateItem({ ...item, start: '10:00', end: '09:00' })).toThrow();
    expect(validateItem({ ...item, start: '10:00', end: '10:01' }).end).toBe('10:01');
    expect(validateItem({ ...item, start: '', end: '09:00' }).end).toBe('09:00');
    expect(validateItem({ ...item, start: '10:00' }).start).toBe('10:00');
  });

  it('rejects a repeat that ends before it starts', () => {
    const weekly = { ...item, recur: 'weekly', weekday: 2 };
    expect(() => validateItem({ ...weekly, recurUntil: '2026-09-21' })).toThrow(expect.objectContaining({ body: { error: 'invalid', field: 'recurUntil' } }));
    expect(validateItem({ ...weekly, recurUntil: '2026-09-22' }).recurUntil).toBe('2026-09-22');
  });

  it('rejects a weekday on an item that does not repeat', () => {
    expect(() => validateItem({ ...item, weekday: 2 })).toThrow(expect.objectContaining({ body: { error: 'invalid', field: 'weekday' } }));
    expect(validateItem({ ...item, weekday: null }).weekday).toBeNull();
  });
});

describe('backgrounds and projects', () => {
  it('defaults a profile without a background to Med, for older clients', () => {
    expect(validateProfile(profile).bg).toBe('med');
  });

  it('accepts the CS background and rejects anything else', () => {
    expect(validateProfile({ ...profile, bg: 'cs' }).bg).toBe('cs');
    expect(() => validateProfile({ ...profile, bg: 'law' })).toThrow();
  });

  it('accepts project items', () => {
    expect(validateItem({ ...item, type: 'project' }).type).toBe('project');
  });
});
