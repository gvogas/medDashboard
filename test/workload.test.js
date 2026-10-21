import { describe, expect, it } from 'vitest';
import { crunches, crunchesOn, crunchHint } from '../src/core/workload.ts';

/* 2026-10-12 is a Monday */
let n = 0;
const item = (type, date, extra = {}) => ({ id: 'i' + ++n, type, date, status: 'todo', weight: null, recur: null, ...extra });

describe('crunches', () => {
  it('finds a day with two tests', () => {
    const list = crunches([item('exam', '2026-10-13'), item('quiz', '2026-10-13'), item('quiz', '2026-10-14')], '2026-10-12', '2026-10-18');
    expect(list).toEqual([{ kind: 'day', from: '2026-10-13', to: '2026-10-13', count: 2, text: '2 tests on Tue 13 Oct' }]);
  });

  it('finds a week with three exams, counting the whole week, not quizzes', () => {
    const items = [item('exam', '2026-10-12'), item('exam', '2026-10-15'), item('exam', '2026-10-18'), item('quiz', '2026-10-16')];
    expect(crunches(items, '2026-10-14', '2026-10-14')).toEqual([{ kind: 'week', from: '2026-10-12', to: '2026-10-18', count: 3, text: '3 exams the week of 12 Oct' }]);
    expect(crunches(items.slice(1), '2026-10-12', '2026-10-18')).toEqual([]);
  });

  it('finds three weighted deadlines within 48 hours, and merges overlapping ones', () => {
    const w = { weight: 10 };
    const items = [item('assignment', '2026-10-13', w), item('lab', '2026-10-14', w), item('assignment', '2026-10-14', w), item('assignment', '2026-10-15', w), item('task', '2026-10-15')];
    expect(crunches(items, '2026-10-12', '2026-10-18')).toEqual([{ kind: 'burst', from: '2026-10-13', to: '2026-10-15', count: 4, text: '4 weighted deadlines from Tue 13 Oct to Thu 15 Oct' }]);
    expect(crunches(items.slice(0, 3), '2026-10-12', '2026-10-18')[0]).toMatchObject({ from: '2026-10-13', to: '2026-10-14', count: 3, text: '3 weighted deadlines in 48 hours' });
  });

  it('counts only open, dated, one-off items', () => {
    const items = [item('exam', '2026-10-13', { status: 'done' }), item('quiz', '2026-10-13'), item('quiz', '2026-10-13', { recur: 'weekly', weekday: 2 }), item('quiz', '')];
    expect(crunches(items, '2026-10-12', '2026-10-18')).toEqual([]);
  });

  it('leaves out what is outside the range, and says which crunches hold a day', () => {
    const items = [item('exam', '2026-10-13'), item('quiz', '2026-10-13')];
    expect(crunches(items, '2026-10-14', '2026-10-18')).toEqual([]);
    const list = crunches(items, '2026-10-01', '2026-10-31');
    expect(crunchesOn(list, '2026-10-13')).toHaveLength(1);
    expect(crunchesOn(list, '2026-10-14')).toHaveLength(0);
  });
});

describe('crunchHint', () => {
  const exams = [item('exam', '2026-10-12'), item('exam', '2026-10-16')];

  it('says when a new item makes a crunch', () => {
    expect(crunchHint(exams, item('exam', '2026-10-14'))).toBe('This makes 3 exams the week of 12 Oct');
    expect(crunchHint(exams, item('quiz', '2026-10-12'))).toBe('This makes 2 tests on Mon 12 Oct');
    expect(crunchHint(exams, item('exam', '2026-10-21'))).toBeNull();
    expect(crunchHint(exams, item('task', '2026-10-12'))).toBeNull();
  });

  it('counts a re-dated item once', () => {
    const moving = item('exam', '2026-10-20');
    expect(crunchHint([...exams, moving], { ...moving, date: '2026-10-14' })).toBe('This makes 3 exams the week of 12 Oct');
    expect(crunchHint([...exams, moving], moving)).toBeNull();
  });

  it('says when it adds to a crunch, and when a weighted deadline makes a burst', () => {
    const three = [...exams, item('exam', '2026-10-14')];
    expect(crunchHint(three, item('exam', '2026-10-15'))).toBe('This makes 4 exams the week of 12 Oct');
    const w = { weight: 15 };
    const pair = [item('assignment', '2026-10-20', w), item('lab', '2026-10-21', w)];
    expect(crunchHint(pair, item('assignment', '2026-10-21', w))).toBe('This makes 3 weighted deadlines within 48 hours');
    expect(crunchHint(pair, item('assignment', '2026-10-21'))).toBeNull();
    expect(crunchHint(exams, item('exam', '2026-10-14', { status: 'done' }))).toBeNull();
  });
});
