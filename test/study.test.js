import { describe, it, expect } from 'vitest';
import { lectureDates, reviewId, reviewStep, firstReviews, nextReview, dueReviews } from '../src/core/reviews.ts';
import { shortDate } from '../src/core/dates.ts';
import { examWindow, fillTopics, prepPace, prepLabel } from '../src/core/prep.ts';

const pharm = {
  id: 'c-pharm', code: 'PHARM', archived: false,
  meetings: [
    { id: 'm-mon', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00' },
    { id: 'm-thu', kind: 'Lecture', weekday: 4, start: '11:00', end: '12:00' },
    { id: 'm-lab', kind: 'Lab', weekday: 2, start: '14:00', end: '17:00' },
  ],
};
const old = { id: 'c-old', code: 'OLD', archived: true, meetings: [{ id: 'x', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00' }] };

describe('lectureDates', () => {
  it('lists lectures only, across a week boundary, skipping archived courses', () => {
    // 2026-09-17 is a Thursday; 2026-09-21 a Monday.
    const got = lectureDates([pharm, old], '2026-09-17', '2026-09-22').map((l) => l.date + ' ' + l.meeting.id);
    expect(got).toEqual(['2026-09-17 m-thu', '2026-09-21 m-mon']);
  });
});

describe('review ids', () => {
  it('are short, stable and step-suffixed', () => {
    const a = reviewId('c-pharm', 'm-mon', '2026-09-21', 1);
    expect(a).toMatch(/^rv[0-9a-z]{7}1$/);
    expect(a.length).toBeLessThanOrEqual(24);
    expect(reviewId('c-pharm', 'm-mon', '2026-09-21', 1)).toBe(a);
    expect(reviewId('c-pharm', 'm-mon', '2026-09-28', 1)).not.toBe(a);
  });

  it('are recognised only with a review title', () => {
    const id = reviewId('c', 'm', '2026-09-21', 2);
    expect(reviewStep({ id, title: 'Review 2/4 · PHARM Lecture Mon 21 Sep' })).toBe(2);
    expect(reviewStep({ id, title: 'Something else' })).toBe(0);
    expect(reviewStep({ id: 'abc1234', title: 'Review 2/4 · x' })).toBe(0);
  });
});

describe('firstReviews', () => {
  it('creates step 1 the day after each lecture, once', () => {
    const rows = firstReviews([pharm], [], '2026-09-17', '2026-09-21');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'task', courseId: 'c-pharm', date: '2026-09-18', status: 'todo', title: 'Review 1/4 · PHARM Lecture Thu 17 Sep' });
    expect(firstReviews([pharm], rows, '2026-09-17', '2026-09-21')).toEqual([]);
  });
});

describe('nextReview', () => {
  const [first] = firstReviews([pharm], [], '2026-09-21', '2026-09-21');

  it('chains +2, +4, +14 days from the day a step is done, and stops after four', () => {
    const second = nextReview(first, '2026-09-22');
    expect(second).toMatchObject({ id: first.id.slice(0, -1) + '2', date: '2026-09-24', title: 'Review 2/4 · PHARM Lecture Mon 21 Sep' });
    const third = nextReview(second, '2026-09-24');
    expect(third.date).toBe('2026-09-28');
    const fourth = nextReview(third, '2026-09-28');
    expect(fourth.date).toBe('2026-10-12');
    expect(nextReview(fourth, '2026-10-12')).toBeNull();
  });

  it('does not recreate a step that exists', () => {
    const second = nextReview(first, '2026-09-22');
    expect(nextReview(first, '2026-09-22', [second])).toBeNull();
  });

  it('ignores ordinary tasks', () => {
    expect(nextReview({ id: 'abc', title: 'Review notes' }, '2026-09-22')).toBeNull();
  });
});

describe('dueReviews', () => {
  it('does nothing while off', () => {
    expect(dueReviews({ on: false, through: null }, [pharm], [], '2026-09-22')).toEqual({ rows: [], through: null });
  });

  it('starts from yesterday when first turned on', () => {
    expect(dueReviews({ on: true, through: null }, [pharm], [], '2026-09-22')).toEqual({ rows: [], through: '2026-09-21' });
  });

  it('covers lectures after the watermark up to yesterday', () => {
    const r = dueReviews({ on: true, through: '2026-09-16' }, [pharm], [], '2026-09-22');
    expect(r.through).toBe('2026-09-21');
    expect(r.rows.map((x) => x.date)).toEqual(['2026-09-18', '2026-09-22']);
  });

  it('is idle when already up to date', () => {
    expect(dueReviews({ on: true, through: '2026-09-21' }, [pharm], [], '2026-09-22').rows).toEqual([]);
  });
});

describe('exam prep', () => {
  const exam = { id: 'e2', type: 'exam', courseId: 'c-pharm', date: '2026-10-22', checklist: [] };
  const earlier = { id: 'e1', type: 'exam', courseId: 'c-pharm', date: '2026-10-01', checklist: [] };

  it('starts after the previous exam in the course', () => {
    expect(examWindow(exam, [earlier, exam], null)).toEqual({ from: '2026-10-02', to: '2026-10-21' });
  });

  it('falls back to term start, then ten weeks', () => {
    expect(examWindow(exam, [exam], '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-10-21' });
    expect(examWindow(exam, [exam], '2026-01-01').from).toBe('2026-08-13');
  });

  it('fills lectures without repeating existing steps', () => {
    const withStep = { ...exam, checklist: [{ id: 'a', text: 'PHARM Lecture · Mon 5 Oct', done: true }] };
    const r = fillTopics(withStep, pharm, [earlier, withStep], null);
    // Oct 2–21: Mondays 5, 12, 19; Thursdays 8, 15. Mon 5 already there.
    expect(r.added).toBe(4);
    expect(r.checklist.map((s) => s.text)).toEqual([
      'PHARM Lecture · Mon 5 Oct', 'PHARM Lecture · Thu 8 Oct', 'PHARM Lecture · Mon 12 Oct',
      'PHARM Lecture · Thu 15 Oct', 'PHARM Lecture · Mon 19 Oct',
    ]);
  });

  it('stops at fifty steps and counts the rest', () => {
    const full = { ...exam, checklist: Array.from({ length: 49 }, (_, i) => ({ id: 's' + i, text: 'Topic ' + i, done: false })) };
    const r = fillTopics(full, pharm, [full], '2026-08-01');
    expect(r.checklist).toHaveLength(50);
    expect(r.added).toBe(1);
    expect(r.left).toBeGreaterThan(0);
  });

  it('reports pace, with today counting as a day', () => {
    const e = { ...exam, checklist: [{ done: true }, { done: false }, { done: false }] };
    expect(prepPace(e, '2026-10-20')).toMatchObject({ done: 1, total: 3, days: 2, pace: 1, hot: false });
    expect(prepPace({ ...e, checklist: Array(10).fill({ done: false }) }, '2026-10-21')).toMatchObject({ pace: 10, hot: true });
    expect(prepPace(exam, '2026-10-20')).toBeNull();
    expect(prepLabel(prepPace(e, '2026-10-20'))).toBe('1/3 topics · 1/day');
  });

  it('formats short dates', () => {
    expect(shortDate('2026-09-21')).toBe('Mon 21 Sep');
  });
});
