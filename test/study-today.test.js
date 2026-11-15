import { describe, it, expect } from 'vitest';
import { planView } from '../src/core/study-today.ts';

const t = (text, done = false) => ({ id: text, text, done });
const exam = (id, date, checklist, extra = {}) => ({ id, type: 'exam', title: 'Exam ' + id, date, status: 'todo', checklist, ...extra });
const TODAY = '2026-10-20';   // a Tuesday

describe('planView: today', () => {
  it("takes today's topics from the plan when the day has no target yet", () => {
    // Oct 20..23: four study days, four topics, one a day
    const v = planView([exam('a', '2026-10-24', [t('A'), t('B'), t('C'), t('D')])], TODAY, [], null);
    expect(v.today).toEqual([{ examKey: 'a', exam: 'Exam a', date: '2026-10-24', daysLeft: 4, topics: [{ text: 'A', done: false }] }]);
    expect(v.target).toEqual({ a: ['A'] });
    expect(v.left).toBe(1);
    expect(v.total).toBe(1);
  });

  it("keeps the day's target once it is set: a topic ticked off stays, done, and nothing is pulled forward", () => {
    const items = [exam('a', '2026-10-24', [t('A', true), t('B'), t('C'), t('D')])];
    const v = planView(items, TODAY, [], { a: ['A'] });
    expect(v.today[0].topics).toEqual([{ text: 'A', done: true }]);
    expect(v.left).toBe(0);
    expect(v.total).toBe(1);
    // the rest is planned from tomorrow: B, C and D over Oct 21..23
    expect(v.upcoming.map((e) => [e.date, e.topics])).toEqual([['2026-10-21', ['B']], ['2026-10-22', ['C']], ['2026-10-23', ['D']]]);
  });

  it('plans what is not in the target from tomorrow, so no topic shows twice', () => {
    const v = planView([exam('a', '2026-10-24', [t('A'), t('B'), t('C'), t('D')])], TODAY, [], null);
    expect(v.upcoming.flatMap((e) => e.topics)).toEqual(['B', 'C', 'D']);
    expect(v.upcoming[0].date).toBe('2026-10-21');
  });

  it('drops a target topic that is no longer on the checklist', () => {
    const v = planView([exam('a', '2026-10-24', [t('B'), t('C')])], TODAY, [], { a: ['A', 'B'] });
    expect(v.today[0].topics).toEqual([{ text: 'B', done: false }]);
    expect(v.target).toEqual({ a: ['B'] });
  });

  it('an exam with an empty target stays empty for the day (a rest day stays one)', () => {
    const v = planView([exam('a', '2026-10-24', [t('A'), t('B')])], TODAY, [], { a: [] });
    expect(v.today).toEqual([]);
    expect(v.target).toEqual({ a: [] });
    expect(v.upcoming.flatMap((e) => e.topics)).toEqual(['A', 'B']);
  });

  it('an exam added during the day gets its own target without touching the others', () => {
    const items = [exam('a', '2026-10-24', [t('A'), t('B')]), exam('b', '2026-10-22', [t('X'), t('Y')])];
    const v = planView(items, TODAY, [], { a: ['A'] });
    expect(v.target).toEqual({ a: ['A'], b: ['X'] });
    expect(v.today.map((e) => e.examKey)).toEqual(['b', 'a']);   // the sooner exam first
  });

  it('puts every open topic on today when no study day is left after it', () => {
    // the exam is tomorrow: a topic added after the target was set has nowhere else to go
    const v = planView([exam('a', '2026-10-21', [t('A'), t('B'), t('Late')])], TODAY, [], { a: ['A', 'B'] });
    expect(v.today[0].topics.map((x) => x.text)).toEqual(['A', 'B', 'Late']);
    expect(v.upcoming).toEqual([]);
  });

  it('skips rest weekdays: nothing today, and the plan starts on the next study day', () => {
    const v = planView([exam('a', '2026-10-24', [t('A'), t('B')])], TODAY, [2], null);   // Tuesday is a rest day
    expect(v.today).toEqual([]);
    expect(v.upcoming.map((e) => e.date)).toEqual(['2026-10-21', '2026-10-22']);
  });

  it('counts a topic done only when no open step has that text', () => {
    const items = [exam('a', '2026-10-24', [t('A', true), { id: 'a2', text: 'A', done: false }, t('B')])];
    const v = planView(items, TODAY, [], { a: ['A'] });
    expect(v.today[0].topics).toEqual([{ text: 'A', done: false }]);
  });
});

describe('planView: which exams', () => {
  it('leaves out past and same-day exams, finished ones, project rows, removed class items and non-tests', () => {
    const items = [
      exam('past', '2026-10-19', [t('A')]),
      exam('now', TODAY, [t('A')]),
      exam('done', '2026-10-24', [t('A')], { status: 'done' }),
      exam('proj', '2026-10-24', [t('A')], { source: 'project' }),
      exam('gone', '2026-10-24', [t('A')], { removed: { at: 1 } }),
      { ...exam('task', '2026-10-24', [t('A')]), type: 'task' },
    ];
    const v = planView(items, TODAY, [], null);
    expect(v.today).toEqual([]);
    expect(v.upcoming).toEqual([]);
    expect(v.exams).toBe(0);
  });

  it("uses a class item's key, and counts exams that have open topics", () => {
    const items = [exam('m1', '2026-10-24', [t('A')], { key: 'c:abc/m1' }), exam('empty', '2026-10-24', []), exam('sooner', '2026-10-22', [t('  ')])];
    const v = planView(items, TODAY, [], null);
    expect(v.today[0].examKey).toBe('c:abc/m1');
    expect(v.exams).toBe(1);
    expect(v.bare).toBe(2);              // upcoming exams with no topics yet (a blank step is not a topic)
    expect(v.bareKey).toBe('sooner');    // the soonest of them
  });

  it('keeps upcoming days inside the window', () => {
    const many = Array.from({ length: 30 }, (_, i) => t('T' + i));
    const v = planView([exam('a', '2026-12-01', many)], TODAY, [], null, 3);
    expect(v.upcoming.every((e) => e.date > TODAY && e.date <= '2026-10-23')).toBe(true);
  });
});
