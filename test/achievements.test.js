import { describe, expect, it } from 'vitest';
import { achievements, nextUp } from '../src/core/achievements.ts';
import { normalizePrefs } from '../src/core/model.ts';
import { noon } from './helpers.js';

/* A session at a local day and hour, so the tests hold in any time zone. */
const at = (day, minutes, hour = 10) => {
  const [y, m, d] = day.split('-').map(Number);
  return { id: day + '-' + hour, startedAt: new Date(y, m - 1, d, hour).getTime(), studyMinutes: minutes, courseId: 'bio' };
};
const it_ = (id, type, status, day, extra = {}) => ({ id, type, status, date: day, completedAt: noon(day), grade: null, ...extra });

const TODAY = '2026-09-25';
const prefs = (p = {}) => normalizePrefs({ dayMin: 15, goal: 0, rest: [], ...p });
const by = (list, id) => list.find((b) => b.id === id);

describe('achievements', () => {
  it('has every badge locked with no data', () => {
    const list = achievements([], [], prefs(), TODAY);
    expect(list).toHaveLength(24);
    expect(list.every((b) => !b.earned && b.earnedOn === null)).toBe(true);
    expect(by(list, 'grades-80').progress).toBe('No graded exams yet');
    expect(by(list, 'days-goal').progress).toBe('Set a daily goal');
  });

  it('dates study hours to the day the total crossed the line', () => {
    const list = achievements([at('2026-09-01', 30), at('2026-09-02', 40), at('2026-09-05', 540)], [], prefs(), TODAY);
    expect(by(list, 'hours-1')).toMatchObject({ earned: true, earnedOn: '2026-09-02' });
    expect(by(list, 'hours-10')).toMatchObject({ earned: true, earnedOn: '2026-09-05' });
    expect(by(list, 'hours-25')).toMatchObject({ earned: false, have: 10.2, progress: '10.2 / 25 h' });
    expect(by(list, 'hours-25').frac).toBeCloseTo(10.2 / 25);
  });

  it('counts the longest streak, so a broken one keeps its badges', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
    const list = achievements([...days.map((d) => at(d, 20)), at('2026-09-20', 20)], [], prefs(), TODAY);
    expect(by(list, 'streak-3')).toMatchObject({ earned: true, earnedOn: '2026-09-03' });
    expect(by(list, 'streak-7')).toMatchObject({ earned: true, earnedOn: '2026-09-07' });
    expect(by(list, 'streak-30')).toMatchObject({ earned: false, have: 7 });
  });

  it('uses the streak rules: the day minimum and rest days', () => {
    /* Sunday the 6th is a rest day; the 3rd falls short of the minimum */
    const s = [at('2026-09-01', 20), at('2026-09-02', 20), at('2026-09-03', 5), at('2026-09-04', 20), at('2026-09-05', 20), at('2026-09-07', 20)];
    const list = achievements(s, [], prefs({ rest: [0] }), TODAY);
    expect(by(list, 'streak-3')).toMatchObject({ earned: true, earnedOn: '2026-09-07' });
  });

  it('marks big days: the first session, the goal met, a four-hour day', () => {
    const s = [at('2026-09-01', 30), at('2026-09-03', 95), at('2026-09-08', 150, 9), at('2026-09-08', 100, 15)];
    const list = achievements(s, [], prefs({ goal: 90 }), TODAY);
    expect(by(list, 'days-first')).toMatchObject({ earned: true, earnedOn: '2026-09-01' });
    expect(by(list, 'days-goal')).toMatchObject({ earned: true, earnedOn: '2026-09-03' });
    expect(by(list, 'days-marathon')).toMatchObject({ earned: true, earnedOn: '2026-09-08' });
    const none = achievements([at('2026-09-01', 30)], [], prefs(), TODAY);
    expect(by(none, 'days-goal').earned).toBe(false);
    expect(by(none, 'days-marathon').progress).toBe('0.5 / 4 h in one day');
  });

  it('counts tasks and exams apart, in the order they were finished', () => {
    const items = [
      it_('a', 'task', 'done', '2026-09-03'), it_('b', 'assignment', 'submitted', '2026-09-01'),
      it_('c', 'lab', 'done', '2026-09-02'), it_('d', 'task', 'todo', '2026-09-02'),
      it_('e', 'lab', 'missed', '2026-09-02'),
      it_('x', 'exam', 'done', '2026-09-10'), it_('y', 'quiz', 'graded', '2026-09-04', { grade: 70 }),
    ];
    const list = achievements([], items, prefs(), TODAY);
    expect(by(list, 'tasks-1')).toMatchObject({ earned: true, earnedOn: '2026-09-01' });
    expect(by(list, 'tasks-10')).toMatchObject({ earned: false, have: 3, progress: '3 / 10' });
    expect(by(list, 'exams-1')).toMatchObject({ earned: true, earnedOn: '2026-09-04' });
    expect(by(list, 'exams-5').have).toBe(2);
  });

  it('falls back to the last save, then the date, for when an item was done', () => {
    const items = [it_('a', 'task', 'done', '2026-09-20', { completedAt: null, updatedAt: noon('2026-09-05') }),
      it_('b', 'task', 'done', '2026-09-02', { completedAt: null })];
    const list = achievements([], items, prefs(), TODAY);
    expect(by(list, 'tasks-1').earnedOn).toBe('2026-09-02');
  });

  it('earns every grade tier up to the best exam grade', () => {
    const items = [
      it_('a', 'exam', 'graded', '2026-09-05', { grade: 84 }),
      it_('b', 'quiz', 'graded', '2026-09-12', { grade: 92 }),
      it_('c', 'assignment', 'graded', '2026-09-03', { grade: 100 }),
      it_('d', 'exam', 'done', '2026-09-01', { grade: 100 }),
    ];
    const list = achievements([], items, prefs(), TODAY);
    expect(by(list, 'grades-80')).toMatchObject({ earned: true, earnedOn: '2026-09-05' });
    expect(by(list, 'grades-90')).toMatchObject({ earned: true, earnedOn: '2026-09-12' });
    expect(by(list, 'grades-100')).toMatchObject({ earned: false, progress: 'Best 92' });
  });

  it('offers the three locked badges closest to done, without grades', () => {
    const list = achievements([at('2026-09-01', 200)], [it_('x', 'exam', 'done', '2026-09-02')], prefs(), TODAY);
    const next = nextUp(list).map((b) => b.id);
    expect(next).toEqual(['days-marathon', 'streak-3', 'hours-10']);
    expect(nextUp(list, 10).some((b) => b.group === 'grades' || b.id === 'days-goal')).toBe(false);
  });
});
