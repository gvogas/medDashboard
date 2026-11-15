import { describe, it, expect } from 'vitest';
import { courseGrade, neededLabel } from '../src/core/grades.ts';

const item = (status, weight, grade = null) => ({ status, weight, grade });

describe('courseGrade', () => {
  it('has nothing to say without weights', () => {
    const g = courseGrade([item('graded', null, 90), item('todo', 0)]);
    expect(g.current).toBeNull();
    expect(g.total).toBe(0);
    expect(g.needed(70)).toBeNull();
  });

  it('averages graded items by weight and projects the rest', () => {
    const g = courseGrade([item('graded', 30, 80), item('graded', 15, 60), item('todo', 55)]);
    expect(g.current).toBe(73.3);
    expect(g.graded).toBe(45);
    expect(g.remaining).toBe(55);
    // 70 overall needs (7000 - 2400 - 900) / 55 = 67.3
    expect(g.needed(70)).toBe(67.3);
  });

  it('counts a missed item as zero', () => {
    const g = courseGrade([item('missed', 20), item('graded', 20, 100), item('todo', 60)]);
    expect(g.current).toBe(50);
    expect(g.graded).toBe(40);
  });

  it('ignores a graded item without a grade', () => {
    const g = courseGrade([item('graded', 20, null), item('graded', 20, 90)]);
    expect(g.graded).toBe(20);
    expect(g.current).toBe(90);
  });

  it('reports totals that do not add to 100', () => {
    expect(courseGrade([item('todo', 40), item('todo', 45)]).total).toBe(85);
  });

  it('counts weight not entered yet as still to come', () => {
    const g = courseGrade([item('graded', 25, 80), item('todo', 25)]);
    expect(g.total).toBe(50);
    expect(g.remaining).toBe(75);
    // 50 overall needs (5000 - 2000) / 75 = 40
    expect(g.needed(50)).toBe(40);
  });

  /* remaining already takes the course as its real total when the weights pass 100; needed must use the
     same total, or scoring exactly what the panel asks for falls short of the target */
  it('asks for a score that reaches the target when the weights add to more than 100', () => {
    const items = [{ id: 'a', status: 'graded', weight: 60, grade: 80 }, { id: 'b', status: 'todo', weight: 60, grade: null }];
    const g = courseGrade(items);
    expect(g.total).toBe(120);
    expect(g.remaining).toBe(60);
    // 70 overall of 120 needs (70 × 120 − 80 × 60) / 60 = 60
    expect(g.needed(70)).toBe(60);
    const after = courseGrade(items, { b: g.needed(70) });
    expect(after.remaining).toBe(0);
    expect(after.current).toBe(70);
  });

  it('knows when nothing remains', () => {
    expect(courseGrade([item('graded', 100, 72)]).needed(50)).toBeNull();
  });
});

describe('neededLabel', () => {
  it('reads the three cases', () => {
    expect(neededLabel(-4)).toBe('secured');
    expect(neededLabel(0)).toBe('secured');
    expect(neededLabel(62.5)).toBe('≥ 62.5%');
    expect(neededLabel(101)).toBe('out of reach');
    expect(neededLabel(null)).toBe('');
  });
});
