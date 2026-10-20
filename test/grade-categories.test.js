import { describe, it, expect } from 'vitest';
import { courseGrade, ungraded, shareOf, targetsFor, letterFor, gpa, normalizeGrading, DEFAULT_SCALE } from '../src/core/grades.ts';

const item = (status, weight, grade = null) => ({ status, weight, grade });
const inCat = (id, category, status, grade = null) => ({ id, category, status, grade, weight: null });
const cats = (...list) => list.map(([id, weight, drop = 0]) => ({ id, name: id, weight, drop }));
const r = (n) => Math.round(n * 10) / 10;

describe('courseGrade with categories', () => {
  it('reads as before without categories, and keeps the old two-argument call', () => {
    const items = [{ id: 'a', ...item('graded', 30, 80) }, { id: 'b', ...item('todo', 70) }];
    expect(courseGrade(items, {}, []).current).toBe(courseGrade(items).current);
    expect(courseGrade(items).categories).toEqual([]);
  });

  it('shares a category\'s weight equally and ignores the items\' own weights', () => {
    const items = [
      { ...inCat('q1', 'quiz', 'graded', 80), weight: 50 },
      inCat('q2', 'quiz', 'graded', 60),
      inCat('q3', 'quiz', 'todo'),
      inCat('q4', 'quiz', 'todo'),
    ];
    const g = courseGrade(items, {}, cats(['quiz', 20]));
    expect(g.total).toBe(20);
    expect(g.graded).toBe(10);
    expect(g.current).toBe(70);
    expect(g.categories[0]).toMatchObject({ id: 'quiz', current: 70, items: 4, dropped: [] });
  });

  it('drops the lowest scores, and only scored ones', () => {
    const items = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => inCat(id, 'quiz', i < 3 ? 'graded' : 'todo', [90, 40, 70][i] ?? null));
    const g = courseGrade(items, {}, cats(['quiz', 30, 2]));
    expect(g.dropped).toEqual(['q2', 'q3']);
    // each counting item is worth 30 / 3 = 10: the kept 90 is 10 graded, 20 of the category still to come
    expect(g.graded).toBe(10);
    expect(g.current).toBe(90);
    expect(g.remaining).toBe(90);
  });

  it('always keeps one scored item, even when every one would be dropped', () => {
    const items = [inCat('a', 'q', 'graded', 50), inCat('b', 'q', 'graded', 70)];
    const g = courseGrade(items, {}, cats(['q', 100, 5]));
    expect(g.dropped).toEqual(['a']);
    expect(g.current).toBe(70);
    expect(g.graded).toBe(100);
    expect(g.needed(50)).toBeNull();
  });

  it('counts a missed item as zero, and drops it first', () => {
    const items = [inCat('a', 'q', 'missed'), inCat('b', 'q', 'graded', 80), inCat('c', 'q', 'graded', 60)];
    expect(courseGrade(items, {}, cats(['q', 30])).current).toBe(46.7);
    const g = courseGrade(items, {}, cats(['q', 30, 1]));
    expect(g.dropped).toEqual(['a']);
    expect(g.current).toBe(70);
  });

  it('drops a what-if score like a real one', () => {
    const items = [inCat('a', 'q', 'graded', 60), inCat('b', 'q', 'todo')];
    const g = courseGrade(items, { b: 30 }, cats(['q', 40, 1]));
    expect(g.dropped).toEqual(['b']);
    expect(g.current).toBe(60);
    expect(g.graded).toBe(40);
  });

  it('counts an empty category as weight still to come', () => {
    const g = courseGrade([{ id: 'm', ...item('graded', 30, 80) }], {}, cats(['final', 50]));
    expect(g.total).toBe(80);
    expect(g.remaining).toBe(70);
    expect(g.categories[0]).toMatchObject({ current: null, items: 0 });
    // 70 overall needs (7000 - 2400) / 70
    expect(g.needed(70)).toBe(65.7);
  });

  it('mixes categories and items of their own, whatever the weights add up to', () => {
    const items = [{ id: 'm', ...item('graded', 40, 70) }, inCat('a', 'hw', 'graded', 100), inCat('b', 'hw', 'graded', 90)];
    const g = courseGrade(items, {}, cats(['hw', 70]));
    expect(g.total).toBe(110);
    expect(g.graded).toBe(110);
    expect(g.current).toBe(r((70 * 40 + 100 * 35 + 90 * 35) / 110));
  });

  it('gives an item in a category the course no longer has its own weight back', () => {
    const g = courseGrade([{ ...inCat('a', 'gone', 'graded', 80), weight: 20 }], {}, cats(['other', 30]));
    expect(g.graded).toBe(20);
    expect(g.total).toBe(50);
  });

  it('leaves a category of no weight out', () => {
    const g = courseGrade([{ ...inCat('a', 'z', 'graded', 80), weight: 10 }], {}, cats(['z', 0]));
    expect(g.categories).toEqual([]);
    expect(g.total).toBe(10);
  });
});

describe('ungraded and shareOf with categories', () => {
  it('offers a what-if for an unscored item of a category without its own weight', () => {
    const items = [inCat('a', 'q', 'todo'), inCat('b', 'q', 'graded', 90), inCat('c', null, 'todo')];
    expect(ungraded(items, cats(['q', 20])).map((i) => i.id)).toEqual(['a']);
    expect(ungraded(items).map((i) => i.id)).toEqual([]);
  });

  it('says what an item is worth in its category', () => {
    const items = [inCat('a', 'q', 'todo'), inCat('b', 'q', 'todo'), inCat('c', 'q', 'todo'), { ...inCat('d', null, 'todo'), weight: 15 }];
    expect(shareOf(items[0], items, cats(['q', 20, 1]))).toMatchObject({ category: { id: 'q' }, weight: 10 });
    expect(shareOf(items[3], items, cats(['q', 20]))).toEqual({ category: null, weight: 15 });
  });
});

describe('targetsFor', () => {
  it('uses your pass marks in place of 50, 60 and 70', () => {
    expect(targetsFor(75)).toEqual([50, 60, 70, 75]);
    expect(targetsFor(75, [65])).toEqual([65, 75]);
    expect(targetsFor(null, [])).toEqual([50, 60, 70]);
  });
});

describe('letters and the GPA', () => {
  it('reads a letter off the scale', () => {
    expect(letterFor(93)?.letter).toBe('A');
    expect(letterFor(92.9)?.letter).toBe('A-');
    expect(letterFor(59)?.letter).toBe('F');
    expect(letterFor(null)).toBeNull();
    expect(letterFor(40, [{ letter: 'P', min: 50, points: 1 }])).toBeNull();
  });

  it('weights the GPA by credits, with 3 for a course without any', () => {
    expect(gpa([{ credits: 4, percent: 95 }, { credits: null, percent: 84 }, { credits: 2, percent: null }])).toEqual({ gpa: 3.57, credits: 7, courses: 2 });
    expect(gpa([{ credits: 3, percent: null }])).toBeNull();
    expect(gpa([{ credits: 0, percent: 90 }])).toBeNull();
  });

  it('fills grading from the defaults and keeps a scale in order', () => {
    expect(normalizeGrading(undefined)).toEqual({ scale: DEFAULT_SCALE, pass: [50, 60, 70] });
    const g = normalizeGrading({ scale: [{ letter: 'P', min: 50, points: 1 }, { letter: 'H', min: 85, points: 2 }, { letter: '', min: 1, points: 1 }], pass: [70, 50.4, 70, 300] });
    expect(g.scale.map((s) => s.letter)).toEqual(['H', 'P']);
    expect(g.pass).toEqual([50, 70]);
  });
});
