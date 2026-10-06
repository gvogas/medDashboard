import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { upsertRow, deleteRow, getRow, syncPage, personal } from '../worker/db.js';
import { normalizeItem } from '../src/core/model.ts';

/* A raw row, so these tests see the schema's own rules and not the Worker's. */
function insertItem(scope, id, cols = {}) {
  const row = { type: 'task', title: 'T', date: '2026-10-01', status: 'todo', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO items (scope, id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`)
    .bind(scope, id, ...Object.values(row)).run();
}
const insertCourse = (scope, id) => env.DB.prepare(
  "INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES (?, ?, 'BIO', 'Biology', '#17B3AE', 1, 1)",
).bind(scope, id).run();
const FAILS = /CHECK constraint failed/;

describe('scopes in the schema', () => {
  it('accepts the three scope kinds and nothing else', async () => {
    await insertItem('u:someone', 'a');
    await insertCourse('c:class1', 'c');
    await insertItem('c:class1', 'a', { course_id: 'c' });
    await insertItem('p:proj1', 'project', { type: 'project' });
    await expect(insertItem('x:other', 'a')).rejects.toThrow(FAILS);
    await expect(insertItem('u:', 'b')).rejects.toThrow(FAILS);
    await expect(insertCourse('p:proj1', 'c')).rejects.toThrow(FAILS);
  });

  it('keeps each member\'s target and sidebar archive off a class course', async () => {
    await expect(env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, target, created_at, updated_at) VALUES ('c:class4', 'c', 'BIO', 'Biology', '#17B3AE', 80, 1, 1)").run()).rejects.toThrow(FAILS);
    await expect(env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, archived, created_at, updated_at) VALUES ('c:class4', 'c', 'BIO', 'Biology', '#17B3AE', 1, 1, 1)").run()).rejects.toThrow(FAILS);
    const id = await createUser('scope-target');
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, target, archived, created_at, updated_at) VALUES (?, 'c', 'BIO', 'Biology', '#17B3AE', 80, 1, 1, 1)").bind('u:' + id).run();
  });

  it('keeps personal fields off a class row, which always hangs off the class course', async () => {
    await insertCourse('c:class2', 'c');
    const row = (extra) => ({ course_id: 'c', ...extra });
    await expect(insertItem('c:class2', 'g', row({ type: 'exam', grade: 80 }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 's', row({ status: 'done' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 'k', row({ checklist: '[{"id":"a","text":"x","done":false}]' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 't', row({ type: 'c-quiz1' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 'n', row({ assignees: '["u1"]' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 'none', { type: 'exam' })).rejects.toThrow(FAILS);
    await insertItem('c:class2', 'ok', row({ type: 'assignment', weight: 20, notes: 'Teams of 3', links: '[{"label":"Brief","url":"https://example.edu"}]' }));
  });

  it('lets a project row carry the team status but no grade, weight or course', async () => {
    await insertItem('p:proj2', 'done', { status: 'done', completed_at: 5, completed_by: 'u1', assignees: '["u1","u2"]', checklist: '[{"id":"a","text":"Routes","done":true}]' });
    await insertItem('p:proj2', 'all', { assignees: '["*"]' });
    await expect(insertItem('p:proj2', 'w', { weight: 10 })).rejects.toThrow(FAILS);
    await expect(insertItem('p:proj2', 'e', { type: 'exam' })).rejects.toThrow(FAILS);
    await expect(insertItem('p:proj2', 'g', { grade: 90 })).rejects.toThrow(FAILS);
  });

  it('keeps team fields off a personal row and puts class_id only on a row with no course', async () => {
    const id = await createUser('scope-personal');
    await insertCourse('u:' + id, 'bio');
    await expect(insertItem('u:' + id, 'a', { assignees: '["u1"]' })).rejects.toThrow(FAILS);
    await expect(insertItem('u:' + id, 'b', { completed_by: id })).rejects.toThrow(FAILS);
    await expect(insertItem('u:' + id, 'c', { course_id: 'bio', class_id: 'class1' })).rejects.toThrow(FAILS);
    await insertItem('u:' + id, 'd', { class_id: 'class1' });
    await insertItem('u:' + id, 'e', { course_id: 'bio' });
  });

  it('writes each change into its scope, with the scope in the payload of courses and items', async () => {
    const id = await createUser('scope-feed');
    await insertItem('u:' + id, 'i1');
    await insertCourse('c:class3', 'c');
    await insertItem('c:class3', 'i2', { type: 'exam', course_id: 'c' });
    await env.DB.prepare("INSERT INTO quotes (user_id, id, text, created_at, updated_at) VALUES (?, 'q1', 'Go', 1, 1)").bind(id).run();
    const rows = (await env.DB.prepare("SELECT scope, kind, row_id, payload FROM changes WHERE kind != 'courses' AND row_id IN (?, ?, ?) ORDER BY seq").bind('i1', 'i2', 'q1').all()).results;
    expect(rows.map((r) => [r.scope, r.kind, r.row_id])).toEqual([['u:' + id, 'items', 'i1'], ['c:class3', 'items', 'i2'], ['u:' + id, 'quotes', 'q1']]);
    expect(JSON.parse(rows[0].payload)).toMatchObject({ scope: 'u:' + id, id: 'i1', assignees: '[]' });
    expect(JSON.parse(rows[0].payload)).not.toHaveProperty('user_id');
    expect(JSON.parse(rows[2].payload)).toMatchObject({ user_id: id, id: 'q1' });
  });

  it('gives study sessions, achievements and users the columns later stages fill', async () => {
    const id = await createUser('scope-columns');
    expect(await env.DB.prepare('SELECT hidden_sources FROM users WHERE id = ?').bind(id).first()).toEqual({ hidden_sources: '[]' });
    await env.DB.prepare("INSERT INTO study_sessions (user_id, id, course_id, space_id, started_at, study_minutes, created_at, updated_at) VALUES (?, 's', 'c', 'class1', 1, 30, 1, 1)").bind(id).run();
    expect(await env.DB.prepare("SELECT space_id FROM study_sessions WHERE id = 's'").first()).toEqual({ space_id: 'class1' });
    await expect(env.DB.prepare("UPDATE users SET hidden_sources = '{}' WHERE id = ?").bind(id).run()).rejects.toThrow(FAILS);
  });
});

describe('the Worker reads and writes a person\'s own scope', () => {
  const course = { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] };

  it('stores personal courses and items under u:<id>, and pages them back', async () => {
    const id = await createUser('scope-worker');
    expect(personal(id)).toBe('u:' + id);
    const c = await upsertRow(env.DB, 'courses', id, 'bio', course);
    const i = await upsertRow(env.DB, 'items', id, 'mid', normalizeItem({ id: 'mid', title: 'Midterm', type: 'exam', courseId: 'bio' }));
    expect(await env.DB.prepare('SELECT scope FROM items WHERE id = ? AND scope = ?').bind('mid', 'u:' + id).first()).toEqual({ scope: 'u:' + id });
    expect((await getRow(env.DB, 'items', id, 'mid')).courseId).toBe('bio');
    const page = await syncPage(env.DB, id, 0);
    expect(page.changes.map((ch) => `${ch.kind}:${ch.row.id}`)).toEqual(['courses:bio', 'items:mid']);
    await deleteRow(env.DB, 'courses', id, 'bio', Date.now(), c.revision);
    expect((await getRow(env.DB, 'items', id, 'mid')).courseId).toBeNull();
    expect(i.revision).toBeGreaterThan(c.revision);
  });

  it('never reads a class row through a personal route', async () => {
    const id = await createUser('scope-isolated');
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES ('c:' || ?, 'cc', 'SH', 'Shared', '#17B3AE', 1, 1)").bind(id).run();
    await env.DB.prepare("INSERT INTO items (scope, id, type, title, course_id, date, status, created_at, updated_at) VALUES ('c:' || ?, 'x', 'exam', 'Shared', 'cc', '2026-10-01', 'todo', 1, 1)").bind(id).run();
    expect(await getRow(env.DB, 'items', id, 'x')).toBeNull();
    expect((await syncPage(env.DB, id, 0)).changes).toEqual([]);
  });
});
