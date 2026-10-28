import { describe, expect, it } from 'vitest';
import { upNext, reasonFor, whenText, isReview } from '../src/core/next.ts';

/* 2026-10-12 is a Monday; today is Wednesday the 14th */
const TODAY = '2026-10-14';
let n = 0;
const item = (type, date, extra = {}) => ({
  id: 'i' + ++n, type, title: type + ' ' + n, date, start: '', end: '', status: 'todo', weight: null, checklist: [], recur: null, ...extra,
});
const steps = (done, total) => Array.from({ length: total }, (_, i) => ({ id: 's' + i, text: 'Lecture ' + i, done: i < done }));

describe('upNext', () => {
  it('puts overdue first, then today, tomorrow and later', () => {
    const later = item('task', '2026-10-18'), today = item('task', TODAY), late = item('task', '2026-10-12'), tomorrow = item('task', '2026-10-15');
    expect(upNext([later, today, late, tomorrow], TODAY).map((r) => r.item)).toEqual([late, today, tomorrow, later]);
  });

  it('leaves out closed, weekly, office hours, far-off and long-overdue work', () => {
    const rows = upNext([
      item('task', TODAY, { status: 'done' }),
      item('lab', TODAY, { status: 'missed' }),
      item('office', TODAY),
      item('tutoring', TODAY, { recur: 'weekly', weekday: 3 }),
      item('assignment', '2026-11-20'),
      item('task', '2026-09-01'),
      item('task', ''),
    ], TODAY);
    expect(rows).toEqual([]);
  });

  it('lifts a heavily weighted item over a lighter one on the same day', () => {
    const light = item('assignment', '2026-10-17', { weight: 5 }), heavy = item('assignment', '2026-10-17', { weight: 30 });
    expect(upNext([light, heavy], TODAY).map((r) => r.item)).toEqual([heavy, light]);
  });

  it('lifts an exam whose prep is behind, and looks at it three weeks out', () => {
    const exam = item('exam', '2026-11-02', { checklist: steps(0, 30) });
    const quiet = item('exam', '2026-11-02');
    const rows = upNext([quiet, exam], TODAY);
    expect(rows.map((r) => r.item)).toEqual([exam]);
    expect(rows[0].prep).toMatchObject({ done: 0, total: 30 });
    expect(rows[0].reason).toBe('Exam in 19 days · 30 topics left · ~2 a day');
  });

  it('ranks a behind exam in four days above a task due in two', () => {
    const exam = item('exam', '2026-10-18', { checklist: steps(2, 10) });
    const task = item('task', '2026-10-16');
    expect(upNext([task, exam], TODAY)[0].item).toBe(exam);
  });

  it('shows a lecture review only once it is due', () => {
    const due = item('task', TODAY, { id: 'rvabc12341' }), soon = item('task', '2026-10-16', { id: 'rvabc12342' });
    const rows = upNext([due, soon], TODAY);
    expect(rows.map((r) => r.item)).toEqual([due]);
    expect(rows[0].reason).toBe('Due today · lecture review');
  });

  it('ranks every open item, breaking ties by date then time then title', () => {
    const list = Array.from({ length: 10 }, (_, i) => item('task', '2026-10-15', { title: 'T' + (9 - i) }));
    expect(upNext(list, TODAY).map((r) => r.item.title)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']);
    const early = item('task', '2026-10-15', { title: 'Z', start: '08:00' }), late = item('task', '2026-10-15', { title: 'A', start: '17:00' });
    expect(upNext([late, early], TODAY).map((r) => r.item)).toEqual([early, late]);
  });
});

describe('the reason line', () => {
  it('says when', () => {
    expect([-3, -1, 0, 1, 5].map(whenText)).toEqual(['Overdue 3 days', 'Overdue 1 day', 'Due today', 'Due tomorrow', 'In 5 days']);
  });

  it('names an exam or quiz, the weight and the topics left', () => {
    expect(reasonFor(item('quiz', TODAY, { weight: 10 }), 0, null)).toBe('Quiz today · worth 10%');
    expect(reasonFor(item('exam', '2026-10-15'), 1, null)).toBe('Exam tomorrow');
    expect(reasonFor(item('assignment', '2026-10-12', { weight: 30 }), -2, null)).toBe('Overdue 2 days · worth 30%');
    expect(reasonFor(item('exam', '2026-10-18'), 4, { done: 4, total: 12, days: 4, pace: 2, hot: false })).toBe('Exam in 4 days · 8 topics left · ~2 a day');
    expect(reasonFor(item('exam', '2026-10-18'), 4, { done: 1, total: 2, days: 4, pace: 0.3, hot: false })).toBe('Exam in 4 days · 1 topic left · ~1 a day');
    expect(reasonFor(item('exam', '2026-10-12'), -2, null)).toBe('Overdue 2 days');
  });

  it('knows a review step by its id', () => {
    expect(isReview({ id: 'rvabc12341', type: 'task' })).toBe(true);
    expect(isReview({ id: 'rvabc12341', type: 'exam' })).toBe(false);
    expect(isReview({ id: 'task1', type: 'task' })).toBe(false);
  });
});
