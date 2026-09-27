import { describe, it, expect } from 'vitest';
import { courseGrade, neededLabel } from '../src/legacy/js/grades.js';

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
