import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { validateItem, validateProfile } from '../worker/validate.js';
import { upsertRow } from '../worker/db.js';
import { createUser, signIn } from './helpers.js';
import { normalizeItem, typeList, typePrefsFrom, useTypePrefs, statusesFor, baseOf, tmeta, pluralOf } from '../public/js/model.js';

const item = { type: 'task', title: 'Study', date: '2026-09-22', status: 'todo' };
const profile = { coat: { color: '#E4749B' }, theme: 'system' };
const quiz = { id: 'c-quiz1', label: 'Quiz', color: '#B03A7A', kind: 'graded' };

describe('custom item types: validation', () => {
  it('accepts a custom type list and keeps the stored one when an older client leaves it out', () => {
    expect(validateProfile({ ...profile, types: [quiz, { id: 'lab', hidden: true }] }).types)
      .toEqual([quiz, { id: 'lab', hidden: true }]);
    expect(validateProfile(profile).types).toBeNull();
  });

  it.each([
    ['a bad id', [{ ...quiz, id: 'essay' }], 'types[0].id'],
    ['an id with capitals', [{ ...quiz, id: 'c-Quiz' }], 'types[0].id'],
    ['an id that is not a string', [{ ...quiz, id: ['c-quiz1'] }], 'types[0].id'],
    ['a custom type with no name', [{ ...quiz, label: '  ' }], 'types[0].label'],
    ['a colour off the palette', [{ ...quiz, color: '#000000' }], 'types[0].color'],
    ['an unknown kind', [{ ...quiz, kind: 'exam' }], 'types[0].kind'],
    ['a duplicate id', [quiz, quiz], 'types[1].id'],
    ['a name over 24 characters', [{ ...quiz, label: 'x'.repeat(25) }], 'types[0].label'],
  ])('rejects %s', (_, types, field) => {
    expect(() => validateProfile({ ...profile, types })).toThrow(expect.objectContaining({ body: { error: 'invalid', field } }));
  });

  it('allows at most 12 custom types', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => ({ ...quiz, id: 'c-t' + i }));
    expect(validateProfile({ ...profile, types: many(12) }).types).toHaveLength(12);
    expect(() => validateProfile({ ...profile, types: many(13) })).toThrow();
  });

  it('lets items use a custom type id, and nothing else unknown', () => {
    expect(validateItem({ ...item, type: 'c-quiz1' }).type).toBe('c-quiz1');
    for (const type of ['c-', 'c-QUIZ', 'c-quiz_1', 'c-abcdefghijklm', 'essay']) expect(() => validateItem({ ...item, type })).toThrow();
  });
});

describe('custom item types: storage', () => {
  it('stores a custom-typed item and rejects a malformed type in the database', async () => {
    const id = await createUser('types-db');
    const saved = await upsertRow(env.DB, 'items', id, 'q', normalizeItem({ id: 'q', title: 'Quiz 1', type: 'c-quiz1' }));
    expect(saved.type).toBe('c-quiz1');
    for (const type of ['c-', 'c-Quiz', 'c-quiz-1', 'c-abcdefghijklm']) {
      await expect(env.DB.prepare('UPDATE items SET type = ? WHERE user_id = ?').bind(type, id).run()).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it('PUT /api/me saves the type list and keeps it when a later save leaves it out', async () => {
    const api = await signIn();
    const body = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };
    let res = await api('/api/me', { method: 'PUT', body: { ...body, types: [quiz] } });
    expect(res.status).toBe(200);
    expect((await res.json()).types).toEqual([quiz]);
    res = await api('/api/me', { method: 'PUT', body: { ...body, theme: 'light' } });
    expect((await res.json()).types).toEqual([quiz]);
    res = await api('/api/me', { method: 'PUT', body: { ...body, types: [{ ...quiz, kind: 'nope' }] } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'types[0].kind' });
  });
});

describe('custom item types: the model', () => {
  let prefs = [];
  useTypePrefs(() => prefs);
  afterEach(() => { prefs = []; });

  it('lists the built-ins in their usual order, with Projects hidden on Med unless one exists', () => {
    const ids = typeList('med').map((t) => t.id);
    expect(ids).toEqual(['exam', 'quiz', 'assignment', 'lab', 'tutoring', 'office', 'project', 'task']);
    expect(typeList('med').find((t) => t.id === 'project').hidden).toBe(true);
    expect(typeList('cs').find((t) => t.id === 'project').hidden).toBe(false);
    expect(typeList('med', [{ type: 'project' }]).find((t) => t.id === 'project').hidden).toBe(false);
  });

  it('applies renames, colours, order and hiding, and slots unlisted built-ins back in', () => {
    prefs = [{ id: 'task' }, quiz, { id: 'exam', label: 'Final', color: '#3F7A2E' }, { id: 'lab', hidden: true }];
    const list = typeList('med');
    expect(list.map((t) => t.id)).toEqual(['task', 'c-quiz1', 'exam', 'quiz', 'assignment', 'lab', 'tutoring', 'office', 'project']);
    expect(list.find((t) => t.id === 'exam')).toMatchObject({ label: 'Final', plural: 'Finals', color: '#3F7A2E' });
    expect(list.find((t) => t.id === 'c-quiz1')).toMatchObject({ plural: 'Quizzes', custom: true, kind: 'graded' });
    expect(list.find((t) => t.id === 'lab').hidden).toBe(true);
  });

  it('hides the built-in Quiz for someone with a Quiz type of their own, unless they use it or chose to show it', () => {
    expect(typeList('med').find((t) => t.id === 'quiz')).toMatchObject({ label: 'Quiz', plural: 'Quizzes', hidden: false });
    prefs = [quiz];
    expect(typeList('med').find((t) => t.id === 'quiz').hidden).toBe(true);
    expect(typeList('med', [{ type: 'quiz' }]).find((t) => t.id === 'quiz').hidden).toBe(false);
    prefs = [quiz, { id: 'quiz', hidden: false }];
    expect(typeList('med').find((t) => t.id === 'quiz').hidden).toBe(false);
  });

  it('gives a custom type the statuses of the built-in it behaves like', () => {
    prefs = [quiz, { id: 'c-shift', label: 'Shift', color: '#6B5B45', kind: 'event' }];
    expect(baseOf('c-quiz1')).toBe('assignment');
    expect(statusesFor('c-shift').map((s) => s[0])).toEqual(['todo', 'done', 'missed']);
    expect(statusesFor('c-unknown').map((s) => s[0])).toEqual(['todo', 'done']);
    expect(tmeta('c-unknown').label).toBe('Item');
  });

  it('keeps custom types on items instead of turning them into tasks', () => {
    expect(normalizeItem({ title: 'Quiz', type: 'c-quiz1' }).type).toBe('c-quiz1');
    expect(normalizeItem({ title: 'Odd', type: 'essay' }).type).toBe('task');
  });

  it('stores only what differs from a built-in, so Projects still follow the background', () => {
    prefs = [quiz];
    const list = typeList('med');
    expect(typePrefsFrom(list).find((t) => t.id === 'project')).toEqual({ id: 'project' });
    list.find((t) => t.id === 'exam').label = 'Final';
    Object.assign(list.find((t) => t.id === 'lab'), { hidden: true, hiddenSet: true });
    const saved = typePrefsFrom(list);
    expect(saved.find((t) => t.id === 'exam')).toEqual({ id: 'exam', label: 'Final' });
    expect(saved.find((t) => t.id === 'lab')).toEqual({ id: 'lab', hidden: true });
    expect(saved.find((t) => t.id === 'c-quiz1')).toEqual({ ...quiz, hidden: false });
  });

  it('makes plurals', () => {
    expect(['Quiz', 'Shift', 'Study', 'Day', 'Clinical shift', 'Box'].map(pluralOf))
      .toEqual(['Quizzes', 'Shifts', 'Studies', 'Days', 'Clinical shifts', 'Boxes']);
  });
});
