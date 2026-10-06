import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { post, signInAdmin } from './spaces.js';

const course = { code: 'OS', name: 'Operating Systems', color: '#4FBF8B', instructor: 'Dr. Lin', term: 'Fall 2026', meetings: [] };
let owner, plain;
beforeAll(async () => { owner = await signInAdmin('cls-owner'); plain = await signIn('cls-plain'); });

const make = (api, body) => post(api, '/api/spaces', body);
const classRows = async (scope) => (await env.DB.prepare(
  'SELECT id, type, status, grade, notes, checklist, course_id AS courseId, updated_by AS updatedBy FROM items WHERE scope = ? ORDER BY id',
).bind(scope).all()).results;

describe('making a class', () => {
  it('refuses anyone who is not an admin while classes are theirs alone', async () => {
    const res = await make(plain, { kind: 'class', course });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('checks what it is given', async () => {
    expect(await (await make(owner, { kind: 'project', title: 'x' })).json()).toEqual({ error: 'invalid', field: 'kind' });
    expect(await (await make(owner, { kind: 'class' })).json()).toEqual({ error: 'invalid', field: 'course' });
    expect(await (await make(owner, { kind: 'class', course: { ...course, name: '' } })).json()).toEqual({ error: 'invalid', field: 'name' });
    expect(await (await make(owner, { kind: 'class', convertCourseId: 'nope', items: [] })).json()).toEqual({ error: 'invalid', field: 'convertCourseId' });
    expect(await (await make(owner, { kind: 'class', convertCourseId: 'nope', items: 'a1' })).json()).toEqual({ error: 'invalid', field: 'items' });
  });

  it('makes a blank class: the space, you as owner and its course, in class shape; sync brings it', async () => {
    const res = await make(owner, { kind: 'class', course: { ...course, target: 80, archived: true } });
    expect(res.status).toBe(201);
    const { space } = await res.json();
    expect(space).toMatchObject({ kind: 'class', name: 'Operating Systems', role: 'owner', members: 1 });
    expect(space.id).toMatch(/^[a-z0-9]{12}$/);
    expect(space.scope).toBe('c:' + space.id);
    const saved = await env.DB.prepare('SELECT id, name, target, archived, updated_by AS updatedBy FROM courses WHERE scope = ?').bind(space.scope).first();
    expect(saved).toMatchObject({ name: 'Operating Systems', target: null, archived: 0, updatedBy: owner.id });
    expect(saved.id).toMatch(/^[a-z0-9]{12}$/);
    const page = await (await owner('/api/sync?v=3&cursors=')).json();
    expect(page.scopes.find((s) => s.id === space.id)).toMatchObject({ role: 'owner', name: 'Operating Systems' });
    expect(page.changes.filter((c) => c.scope === space.scope).map((c) => c.kind)).toEqual(['courses']);
  });

  it('converts a course: moves it and the items ticked into the class, your layer into marks and prefs; again answers the class', async () => {
    const put = (path, body) => owner(path, { method: 'PUT', body });
    expect((await put('/api/courses/db', { code: 'DB', name: 'Databases', color: '#4F74D9', instructor: 'Dr. Ito', term: 'Fall 2026', archived: false, meetings: [], target: 85 })).status).toBe(200);
    const item = (id, over = {}) => put('/api/items/' + id, {
      type: 'assignment', title: id, courseId: 'db', date: '2026-10-15', status: 'graded', grade: 91, weight: 20, notes: 'mine',
      links: [{ label: 'Spec', url: 'https://example.com' }], ...over,
    });
    for (const res of await Promise.all([
      item('a1'),
      item('q1', { type: 'quiz', status: 'todo', grade: null, weight: 10, notes: '', links: [] }),
      item('t1', { type: 'task', status: 'done', grade: null, weight: null, links: [] }),
      item('c1', { type: 'c-viva', links: [] }),
      item('rvab12cd31', { type: 'task', title: 'Review 1/4 DB Lecture', status: 'todo', grade: null, weight: null, notes: '', links: [] }),
    ])) expect(res.status).toBe(200);
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const session = (id, over = {}) => put('/api/study_sessions/' + id, { courseId: 'db', itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 30, ...over });
    for (const res of await Promise.all([
      session('s-course'), session('s-a1', { itemId: 'a1' }), session('s-t1', { itemId: 't1' }),
      put('/api/achievements/h1', { name: 'DB hours', sticker: PNG, rule: 'hours', courseId: 'db', target: 10 }),
      put('/api/achievements/g1', { name: 'A1 grade', sticker: PNG, rule: 'grade', itemId: 'a1', target: 90 }),
    ])) expect(res.status).toBe(200);
    const refused = async (items) => (await make(owner, { kind: 'class', convertCourseId: 'db', items })).json();
    expect(await refused(['a1', 'c1'])).toEqual({ error: 'invalid', field: 'items' });
    expect(await refused(['a1', 'rvab12cd31'])).toEqual({ error: 'invalid', field: 'items' });
    expect(await refused(['a1', 'elsewhere'])).toEqual({ error: 'invalid', field: 'items' });

    const res = await make(owner, { kind: 'class', convertCourseId: 'db', items: ['a1', 'q1', 'a1'] });
    expect(res.status).toBe(201);
    const { space } = await res.json();
    expect(space).toMatchObject({ name: 'Databases', role: 'owner' });
    expect(await env.DB.prepare('SELECT id, code, color, target, archived FROM courses WHERE scope = ?').bind(space.scope).first())
      .toEqual({ id: 'db', code: 'DB', color: '#4F74D9', target: null, archived: 0 });
    expect(await classRows(space.scope)).toEqual([
      { id: 'a1', type: 'assignment', status: 'todo', grade: null, notes: '', checklist: '[]', courseId: 'db', updatedBy: owner.id },
      { id: 'q1', type: 'quiz', status: 'todo', grade: null, notes: '', checklist: '[]', courseId: 'db', updatedBy: owner.id },
    ]);

    /* your layer moved with it (spec §13): a mark for the item you had touched; your colour, target and term */
    expect((await env.DB.prepare('SELECT id, status, grade, weight, notes FROM marks WHERE user_id = ?').bind(owner.id).all()).results)
      .toEqual([{ id: space.id + ':a1', status: 'graded', grade: 91, weight: null, notes: 'mine' }]);
    expect(await env.DB.prepare('SELECT color, target, term, archived FROM space_prefs WHERE user_id = ? AND id = ?').bind(owner.id, space.id).first())
      .toEqual({ color: '#4F74D9', target: 85, term: 'Fall 2026', archived: 0 });
    /* your course and the ticked items are gone from your own rows; the rest are filed under the class */
    expect((await env.DB.prepare('SELECT id, course_id AS courseId, class_id AS classId, deleted_at IS NOT NULL AS gone FROM items WHERE scope = ? ORDER BY id').bind('u:' + owner.id).all()).results).toEqual([
      { id: 'a1', courseId: 'db', classId: null, gone: 1 },
      { id: 'c1', courseId: null, classId: space.id, gone: 0 },
      { id: 'q1', courseId: 'db', classId: null, gone: 1 },
      { id: 'rvab12cd31', courseId: null, classId: space.id, gone: 0 },
      { id: 't1', courseId: null, classId: space.id, gone: 0 },
    ]);
    expect(await env.DB.prepare("SELECT deleted_at IS NOT NULL AS gone FROM courses WHERE scope = ? AND id = 'db'").bind('u:' + owner.id).first()).toEqual({ gone: 1 });
    /* sessions and achievements on the class's rows carry its space; one on an item that stays yours loses its course */
    expect((await env.DB.prepare('SELECT id, course_id AS courseId, item_id AS itemId, space_id AS spaceId FROM study_sessions WHERE user_id = ? ORDER BY id').bind(owner.id).all()).results).toEqual([
      { id: 's-a1', courseId: 'db', itemId: 'a1', spaceId: space.id },
      { id: 's-course', courseId: 'db', itemId: null, spaceId: space.id },
      { id: 's-t1', courseId: null, itemId: 't1', spaceId: null },
    ]);
    expect((await env.DB.prepare('SELECT id, space_id AS spaceId FROM achievements WHERE user_id = ? ORDER BY id').bind(owner.id).all()).results)
      .toEqual([{ id: 'g1', spaceId: space.id }, { id: 'h1', spaceId: space.id }]);

    /* the same convert again answers the class it made and writes nothing */
    const again = await make(owner, { kind: 'class', convertCourseId: 'db', items: ['a1', 'q1'] });
    expect(again.status).toBe(200);
    expect((await again.json()).space.id).toBe(space.id);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM courses WHERE scope GLOB 'c:*' AND id = 'db'").first()).n).toBe(1);
    expect(await classRows(space.scope)).toHaveLength(2);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM marks WHERE user_id = ?').bind(owner.id).first()).n).toBe(1);
  });

  it('stops at 20 spaces with 409 limit, and leaves nothing half made', async () => {
    const full = await signInAdmin('cls-full');
    for (let i = 0; i < 20; i++) expect((await make(full, { kind: 'class', course })).status).toBe(201);
    const res = await make(full, { kind: 'class', course });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'limit' });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE user_id = ?').bind(full.id).first()).n).toBe(20);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM spaces AS s WHERE NOT EXISTS (SELECT 1 FROM members WHERE space_id = s.id)').first()).n).toBe(0);
  });
});
