import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, sharedItem, signInAdmin } from './spaces.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let owner, ana, outsider, s;
const put = (api, path, body) => api(path, { method: 'PUT', body });
beforeAll(async () => {
  owner = await signInAdmin('ab-owner'); ana = await signInAdmin('ab-ana'); outsider = await signIn('ab-out');
  s = await makeSpace({ members: { [owner.id]: 'owner', [ana.id]: 'member' } });
  await sharedItem(s.scope, 'q1', { course_id: 'web', type: 'quiz', title: 'Quiz 1', weight: 10 });
  await sharedItem(s.scope, 'e1', { course_id: 'web', type: 'exam', title: 'Midterm', weight: 30 });
  await env.DB.prepare("INSERT INTO space_prefs (user_id, id, space_id, color, created_at, updated_at) VALUES (?, ?, ?, '#17B3AE', 1, 1)").bind(ana.id, s.id, s.id).run();
  await put(ana, '/api/courses/mydb', { code: 'WEB', name: 'Web (mine)', color: '#B8457E', meetings: [], target: 80 });
  const item = (id, over) => put(ana, '/api/items/' + id, { courseId: 'mydb', date: '2026-10-15', status: 'todo', ...over });
  await item('x1', { type: 'quiz', title: 'Quiz 1', status: 'graded', grade: 88, weight: 10, notes: 'easy' });
  await item('x2', { type: 'exam', title: 'Midterm', weight: 35 });
  await item('x3', { type: 'c-viva', title: 'Viva' });
  await item('x4', { type: 'task', title: 'Read chapter 3' });
  const session = (id, over) => put(ana, '/api/study_sessions/' + id, { courseId: 'mydb', itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 20, ...over });
  await session('sa', { itemId: 'x1' }); await session('sb', {}); await session('sc', { itemId: 'x4' });
  await put(ana, '/api/achievements/hg', { name: 'Quiz ace', sticker: PNG, rule: 'grade', itemId: 'x1', target: 85 });
  await put(ana, '/api/achievements/hh', { name: 'Web hours', sticker: PNG, rule: 'hours', courseId: 'mydb', target: 5 });
}, 60_000);

const absorb = (api, body) => post(api, `/api/spaces/${s.id}/absorb`, body);
const rows = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;

describe('absorb', () => {
  it('refuses someone outside the class, a course not yours, a custom-typed item, an item not in the class, a pair named twice', async () => {
    expect((await absorb(outsider, { courseId: 'mydb', pairs: [] })).status).toBe(404);
    expect(await (await absorb(ana, { courseId: 'nope', pairs: [] })).json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [['x3', 'q1']] })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'zz']] })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'q1'], ['x2', 'q1']] })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: 'x1' })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [], fromCourse: 'yes' })).json()).toEqual({ error: 'invalid', field: 'fromCourse' });
  });

  it("moves your layer onto the class's items, files the rest under it, and writes no shared row; again does nothing", async () => {
    const before = await rows('SELECT id, revision FROM items WHERE scope = ? ORDER BY id', s.scope);
    const res = await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'q1'], ['x2', 'e1']], fromCourse: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paired: 2, filed: 2 });
    expect(await rows('SELECT id, status, grade, weight, notes FROM marks WHERE user_id = ? ORDER BY id', ana.id)).toEqual([
      { id: s.id + ':e1', status: 'todo', grade: null, weight: 35, notes: '' },
      { id: s.id + ':q1', status: 'graded', grade: 88, weight: null, notes: 'easy' },
    ]);
    expect(await env.DB.prepare('SELECT color, target, archived FROM space_prefs WHERE user_id = ? AND id = ?').bind(ana.id, s.id).first())
      .toEqual({ color: '#B8457E', target: 80, archived: 0 });
    expect(await rows('SELECT id, course_id AS courseId, class_id AS classId, deleted_at IS NOT NULL AS gone FROM items WHERE scope = ? ORDER BY id', 'u:' + ana.id)).toEqual([
      { id: 'x1', courseId: 'mydb', classId: null, gone: 1 },
      { id: 'x2', courseId: 'mydb', classId: null, gone: 1 },
      { id: 'x3', courseId: null, classId: s.id, gone: 0 },
      { id: 'x4', courseId: null, classId: s.id, gone: 0 },
    ]);
    expect(await env.DB.prepare("SELECT deleted_at IS NOT NULL AS gone FROM courses WHERE scope = ? AND id = 'mydb'").bind('u:' + ana.id).first()).toEqual({ gone: 1 });
    expect(await rows('SELECT id, course_id AS courseId, item_id AS itemId, space_id AS spaceId FROM study_sessions WHERE user_id = ? ORDER BY id', ana.id)).toEqual([
      { id: 'sa', courseId: 'web', itemId: 'q1', spaceId: s.id },
      { id: 'sb', courseId: 'web', itemId: null, spaceId: s.id },
      { id: 'sc', courseId: null, itemId: 'x4', spaceId: null },
    ]);
    expect(await rows('SELECT id, course_id AS courseId, item_id AS itemId, space_id AS spaceId FROM achievements WHERE user_id = ? ORDER BY id', ana.id)).toEqual([
      { id: 'hg', courseId: null, itemId: 'q1', spaceId: s.id },
      { id: 'hh', courseId: 'web', itemId: null, spaceId: s.id },
    ]);
    expect(await rows('SELECT id, revision FROM items WHERE scope = ? ORDER BY id', s.scope)).toEqual(before);
    const again = await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'q1']], fromCourse: true });
    expect(await again.json()).toEqual({ paired: 0, filed: 0 });
    expect((await rows('SELECT id FROM marks WHERE user_id = ?', ana.id))).toHaveLength(2);
  });

  it('keeps a mark you already had field by field, and your colour unless taken from the course', async () => {
    await put(ana, '/api/courses/bio2', { code: 'B2', name: 'Second copy', color: '#E8B33A', meetings: [], target: 60 });
    await put(ana, '/api/items/y1', { type: 'quiz', title: 'Quiz 1', courseId: 'bio2', date: '2026-10-15', status: 'graded', grade: 70, notes: 'old', checklist: [{ id: 'k', text: 'Ch 1', done: true }] });
    expect(await (await absorb(ana, { courseId: 'bio2', pairs: [['y1', 'q1']] })).json()).toEqual({ paired: 1, filed: 0 });
    expect(await env.DB.prepare('SELECT grade, notes, checklist FROM marks WHERE user_id = ? AND id = ?').bind(ana.id, s.id + ':q1').first())
      .toEqual({ grade: 88, notes: 'easy', checklist: '[{"id":"k","text":"Ch 1","done":true}]' });
    expect(await env.DB.prepare('SELECT color, target FROM space_prefs WHERE user_id = ? AND id = ?').bind(ana.id, s.id).first())
      .toEqual({ color: '#B8457E', target: 80 });
  });

  it("brings back a mark you deleted with the course's values, not its old ones", async () => {
    await sharedItem(s.scope, 'd1', { course_id: 'web', type: 'quiz', title: 'Quiz 2' });
    const mark = (item, body, rev = 0) => ana(`/api/marks/${s.id}/${item}`, { method: 'PUT', body, headers: { 'if-match': `"${rev}"` } });
    const blank = { status: 'todo', grade: null, weight: null, notes: '', checklist: [], completedAt: null, hidden: false };
    const old = await (await mark('d1', { ...blank, status: 'graded', grade: 40, notes: 'stale' })).json();
    expect((await ana(`/api/marks/${s.id}/d1`, { method: 'DELETE', headers: { 'if-match': `"${old.revision}"` } })).status).toBe(204);
    await put(ana, '/api/courses/c3', { code: 'C3', name: 'Third copy', color: '#E8B33A', meetings: [] });
    await put(ana, '/api/items/z1', { type: 'quiz', title: 'Quiz 2', courseId: 'c3', date: '2026-10-15', status: 'graded', grade: 91 });
    expect(await (await absorb(ana, { courseId: 'c3', pairs: [['z1', 'd1']] })).json()).toEqual({ paired: 1, filed: 0 });
    expect(await env.DB.prepare('SELECT status, grade, notes, hidden, deleted_at AS deletedAt FROM marks WHERE user_id = ? AND id = ?').bind(ana.id, s.id + ':d1').first())
      .toEqual({ status: 'graded', grade: 91, notes: '', hidden: 0, deletedAt: null });
  });


  it('keeps an item you hid hidden', async () => {
    await sharedItem(s.scope, 'h1', { course_id: 'web', type: 'quiz', title: 'Quiz 3' });
    const blank = { status: 'todo', grade: null, weight: null, notes: '', checklist: [], completedAt: null, hidden: false };
    expect((await ana(`/api/marks/${s.id}/h1`, { method: 'PUT', body: { ...blank, hidden: true, notes: 'mine' }, headers: { 'if-match': '"0"' } })).status).toBe(200);
    await put(ana, '/api/courses/c4', { code: 'C4', name: 'Fourth copy', color: '#E8B33A', meetings: [] });
    await put(ana, '/api/items/w1', { type: 'quiz', title: 'Quiz 3', courseId: 'c4', date: '2026-10-15', status: 'graded', grade: 75 });
    expect(await (await absorb(ana, { courseId: 'c4', pairs: [['w1', 'h1']] })).json()).toEqual({ paired: 1, filed: 0 });
    expect(await env.DB.prepare('SELECT status, grade, notes, hidden FROM marks WHERE user_id = ? AND id = ?').bind(ana.id, s.id + ':h1').first())
      .toEqual({ status: 'graded', grade: 75, notes: 'mine', hidden: 1 });
  });
});
