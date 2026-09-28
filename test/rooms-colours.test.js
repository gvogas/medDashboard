import { afterEach, describe, expect, it } from 'vitest';
import { validateCourse, validateProfile } from '../worker/validate.js';
import { classRoom, useTypePrefs, HEXES, COAT_PALETTE } from '../src/core/model.ts';

/* 2026-09-21 is a Monday, 2026-09-23 a Wednesday */
const pharm = {
  id: 'c1', meetings: [
    { id: 'a', kind: 'Lab', weekday: 1, start: '14:00', end: '17:00', room: 'Lab 3' },
    { id: 'b', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: 'Hall B' },
    { id: 'c', kind: 'Seminar', weekday: 3, start: '11:00', end: '12:00', room: '' },
  ],
};

describe('an exam or quiz on a class day', () => {
  let prefs = [];
  useTypePrefs(() => prefs);
  afterEach(() => { prefs = []; });

  it('takes the room of the class its time overlaps, else the lecture', () => {
    expect(classRoom({ type: 'exam', date: '2026-09-21', start: '15:00' }, pharm)).toBe('Lab 3');
    expect(classRoom({ type: 'exam', date: '2026-09-21', start: '' }, pharm)).toBe('Hall B');
    expect(classRoom({ type: 'exam', date: '2026-09-21', start: '19:00' }, pharm)).toBe('Hall B');
  });

  it('has no room on a day without a class, or a class without a room', () => {
    expect(classRoom({ type: 'exam', date: '2026-09-22', start: '' }, pharm)).toBe('');
    expect(classRoom({ type: 'exam', date: '2026-09-23', start: '11:00' }, pharm)).toBe('');
    expect(classRoom({ type: 'exam', date: '2026-09-21', start: '' }, null)).toBe('');
  });

  it('counts a type of their own called Quiz, but not assignments or labs', () => {
    prefs = [{ id: 'c-quiz1', label: 'Quiz', color: '#B03A7A', kind: 'graded' }];
    expect(classRoom({ type: 'c-quiz1', date: '2026-09-21', start: '' }, pharm)).toBe('Hall B');
    expect(classRoom({ type: 'assignment', date: '2026-09-21', start: '' }, pharm)).toBe('');
    expect(classRoom({ type: 'lab', date: '2026-09-21', start: '' }, pharm)).toBe('');
  });
});

describe('course colours', () => {
  it('offers twelve for a course and keeps the coat on its five', () => {
    expect(HEXES).toHaveLength(12);
    expect(COAT_PALETTE).toHaveLength(5);
    const course = { code: 'BIO', name: 'Biology', color: '#4F74D9', meetings: [] };
    expect(validateCourse(course).color).toBe('#4F74D9');
    expect(() => validateProfile({ coat: { color: '#4F74D9' }, theme: 'system' })).toThrow();
  });
});
