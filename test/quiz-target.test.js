import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { validateCourse, validateItem } from '../worker/validate.js';
import { upsertRow, syncPage } from '../worker/db.js';
import { courseGrade, targetsFor, ungraded } from '../src/core/grades.ts';
import { isTest, normalizeCourse, statusesFor } from '../src/core/model.ts';
import { guessType } from '../src/core/importers/plan.ts';
import { examWindow } from '../src/core/prep.ts';
import { createUser, signIn } from './helpers.js';

const course = { code: 'BIO', name: 'Biology', color: '#17B3AE' };

describe('quizzes', () => {
  it('are a built-in type that counts as a test, with an exam\'s statuses', () => {
    expect(validateItem({ type: 'quiz', title: 'Quiz 1', date: '2026-10-01', status: 'graded', grade: 80, weight: 5 }).type).toBe('quiz');
    expect(isTest('quiz')).toBe(true);
    expect(statusesFor('quiz').map((s) => s[0])).toEqual(['todo', 'done', 'graded']);
  });

  it('are stored, and synced, by the database', async () => {
    const id = await createUser('quiz-db');
    const saved = await upsertRow(env.DB, 'items', id, 'q', { ...validateItem({ type: 'quiz', title: 'Quiz 1', date: '2026-10-01', status: 'todo' }) });
    expect(saved.type).toBe('quiz');
    const page = await syncPage(env.DB, id, 0);
    expect(page.changes.find((c) => c.kind === 'items').row.type).toBe('quiz');
  });

  it('are read from an outline or calendar by name', () => {
    expect(guessType('Quiz 3 — renal')).toBe('quiz');
    expect(guessType('Weekly quizzes')).toBe('quiz');
    expect(guessType('Midterm exam')).toBe('exam');
    expect(guessType('Quizlet review')).toBe('task');
  });

  it('cover the lectures since the last quiz or exam, while an exam ignores quizzes', () => {
    const items = [
      { id: 'e1', type: 'exam', courseId: 'c', date: '2026-10-01' },
      { id: 'q1', type: 'quiz', courseId: 'c', date: '2026-10-10' },
      { id: 'q2', type: 'quiz', courseId: 'c', date: '2026-10-20' },
      { id: 'e2', type: 'exam', courseId: 'c', date: '2026-10-30' },
    ];
    expect(examWindow(items[2], items, null).from).toBe('2026-10-11');
    expect(examWindow(items[1], items, null).from).toBe('2026-10-02');
    expect(examWindow(items[3], items, null).from).toBe('2026-10-02');
  });
});

describe('a course\'s grade target', () => {
  it('is a whole number from 1 to 100, or none', () => {
    expect(validateCourse({ ...course, target: 75 }).target).toBe(75);
    expect(validateCourse(course).target).toBeNull();
    for (const target of [0, 101, 72.5, '70']) {
      expect(() => validateCourse({ ...course, target })).toThrow(expect.objectContaining({ body: { error: 'invalid', field: 'target' } }));
    }
    expect(normalizeCourse({ ...course, target: 75 }).target).toBe(75);
    expect(normalizeCourse({ ...course, target: 500 }).target).toBeNull();
  });

  it('is saved and comes back through the API and the sync feed', async () => {
    const api = await signIn();
    let res = await api('/api/courses/bio', { method: 'PUT', body: { ...course, target: 80 } });
    expect(res.status).toBe(200);
    expect((await res.json()).target).toBe(80);
    res = await api('/api/courses/bio', { method: 'PUT', body: { ...course, target: null } });
    expect((await res.json()).target).toBeNull();
    const page = await (await api('/api/sync?v=2&cursor=0')).json();
    expect(page.changes.find((c) => c.kind === 'courses').row.target).toBeNull();
  });

  it('is refused by the database outside 1-100', async () => {
    const id = await createUser('target-db');
    await upsertRow(env.DB, 'courses', id, 'c', validateCourse(course));
    await expect(env.DB.prepare("UPDATE courses SET target = 0 WHERE scope = 'u:' || ?").bind(id).run()).rejects.toThrow(/CHECK constraint failed/);
    await expect(env.DB.prepare("UPDATE courses SET target = 70.5 WHERE scope = 'u:' || ?").bind(id).run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it('joins 50, 60 and 70 in the list of targets', () => {
    expect(targetsFor(null)).toEqual([50, 60, 70]);
    expect(targetsFor(85)).toEqual([50, 60, 70, 85]);
    expect(targetsFor(60)).toEqual([50, 60, 70]);
    expect(targetsFor(45)).toEqual([45, 50, 60, 70]);
  });
});

describe('what-if scores', () => {
  const items = [
    { id: 'a', status: 'graded', grade: 80, weight: 30 },
    { id: 'b', status: 'todo', weight: 30 },
    { id: 'c', status: 'todo', weight: 40 },
    { id: 'd', status: 'todo', weight: null },
  ];

  it('list only weighted items with no grade yet', () => {
    expect(ungraded(items).map((it) => it.id)).toEqual(['b', 'c']);
  });

  it('count as grades, leaving the rest to be projected', () => {
    const g = courseGrade(items, { b: 60 });
    expect(g.current).toBe(70);
    expect(g.graded).toBe(60);
    expect(g.remaining).toBe(40);
    // 75 overall needs (7500 - 2400 - 1800) / 40 = 82.5
    expect(g.needed(75)).toBe(82.5);
  });

  it('give a final grade once everything is guessed, and never override a real grade', () => {
    const g = courseGrade(items, { a: 0, b: 60, c: 90 });
    expect(g.remaining).toBe(0);
    expect(g.current).toBe(78);
    expect(g.needed(70)).toBeNull();
  });

  it('ignore scores outside 0-100', () => {
    expect(courseGrade(items, { b: 150, c: -1 }).current).toBe(80);
  });
});
