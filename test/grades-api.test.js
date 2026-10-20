import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { feed, signIn } from './helpers.js';
import { makeSpace } from './spaces.js';

const course = (over = {}) => ({ code: 'BIO', name: 'Biology', color: '#17B3AE', meetings: [], ...over });
const item = (over = {}) => ({ type: 'quiz', title: 'Quiz 1', courseId: 'bio', date: '2026-10-01', status: 'todo', ...over });
const CATS = [{ id: 'quiz', name: 'Quizzes', weight: 20, drop: 2 }, { id: 'final', name: 'Final', weight: 50, drop: 0 }];
const profile = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };
const put = (api, p, body, revision = 0) => api(p, { method: 'PUT', body, headers: { 'if-match': `"${revision}"` } });

describe('grade categories and credits on your own courses and items', () => {
  it('round-trip, and reach the change feed', async () => {
    const api = await signIn('gr-own');
    const c = await (await api('/api/courses/bio', { method: 'PUT', body: course({ credits: 4, gradeCategories: CATS }) })).json();
    expect(c).toMatchObject({ credits: 4, gradeCategories: CATS });
    const i = await (await api('/api/items/q1', { method: 'PUT', body: item({ category: 'quiz' }) })).json();
    expect(i.category).toBe('quiz');
    const page = await feed(api);
    expect(page.courses[0]).toMatchObject({ credits: 4, gradeCategories: CATS });
    expect(page.items[0].category).toBe('quiz');
  });

  it('start empty: no credits, no categories, no category', async () => {
    const api = await signIn('gr-new');
    expect(await (await api('/api/courses/bio', { method: 'PUT', body: course() })).json()).toMatchObject({ credits: null, gradeCategories: [] });
    expect((await (await api('/api/items/q1', { method: 'PUT', body: item() })).json()).category).toBeNull();
  });

  it('are kept when an older client leaves them out, and cleared when a new one says so', async () => {
    const api = await signIn('gr-old');
    await api('/api/courses/bio', { method: 'PUT', body: course({ credits: 2.5, gradeCategories: CATS }) });
    await api('/api/items/q1', { method: 'PUT', body: item({ category: 'quiz' }) });
    expect(await (await api('/api/courses/bio', { method: 'PUT', body: course({ name: 'Bio II' }) })).json()).toMatchObject({ name: 'Bio II', credits: 2.5, gradeCategories: CATS });
    expect(await (await api('/api/items/q1', { method: 'PUT', body: item({ title: 'Quiz one' }) })).json()).toMatchObject({ title: 'Quiz one', category: 'quiz' });
    expect(await (await api('/api/courses/bio', { method: 'PUT', body: course({ credits: null, gradeCategories: [] }) })).json()).toMatchObject({ credits: null, gradeCategories: [] });
    expect((await (await api('/api/items/q1', { method: 'PUT', body: item({ category: null }) })).json()).category).toBeNull();
  });

  it('are checked', async () => {
    const api = await signIn('gr-bad');
    const bad = async (p, body) => (await (await api(p, { method: 'PUT', body })).json()).field;
    expect(await bad('/api/courses/bio', course({ credits: 31 }))).toBe('credits');
    expect(await bad('/api/courses/bio', course({ gradeCategories: [{ id: 'q', name: 'Q', weight: 120 }] }))).toBe('gradeCategories[0].weight');
    expect(await bad('/api/courses/bio', course({ gradeCategories: [{ id: 'q', name: 'Q', weight: 10, drop: -1 }] }))).toBe('gradeCategories[0].drop');
    expect(await bad('/api/courses/bio', course({ gradeCategories: [CATS[0], CATS[0]] }))).toBe('gradeCategories');
    expect(await bad('/api/courses/bio', course({ gradeCategories: Array.from({ length: 13 }, (_, n) => ({ id: 'c' + n, name: 'C', weight: 1 })) }))).toBe('gradeCategories');
    expect(await bad('/api/items/q1', item({ category: 'x'.repeat(25) }))).toBe('category');
  });
});

describe('your grading scale and pass marks', () => {
  it('round-trip on /api/me, are kept when left out, and {} goes back to the defaults', async () => {
    const api = await signIn('gr-scale');
    const grading = { scale: [{ letter: 'H', min: 85, points: 4 }, { letter: 'P', min: 50, points: 2 }], pass: [50, 65] };
    const saved = await (await api('/api/me', { method: 'PUT', body: { ...profile, grading } })).json();
    expect(saved.grading).toEqual(grading);
    const kept = await (await api('/api/me', { method: 'PUT', body: { ...profile, displayName: 'Ana' } })).json();
    expect(kept).toMatchObject({ displayName: 'Ana', grading });
    expect((await (await api('/api/me', { method: 'PUT', body: { ...profile, grading: {} } })).json()).grading).toEqual({});
  });

  it('is checked', async () => {
    const api = await signIn('gr-scale-bad');
    const field = async (grading) => (await (await api('/api/me', { method: 'PUT', body: { ...profile, grading } })).json()).field;
    expect(await field({ pass: [0] })).toBe('grading.pass[0]');
    expect(await field({ pass: [50, 60, 70, 80, 90, 95] })).toBe('grading.pass');
    expect(await field({ scale: [{ letter: 'A', min: 90, points: 11 }] })).toBe('grading.scale[0].points');
    expect(await field({ scale: [{ letter: 'A', min: 90, points: 4 }, { letter: 'B', min: 90, points: 3 }] })).toBe('grading.scale');
    expect(await field([])).toBe('grading');
  });
});

describe('in a class', () => {
  const ROLES = ['owner', 'member'];
  const as = {};
  let cls, proj;
  beforeAll(async () => {
    for (const role of ROLES) as[role] = await signIn(`gr-${role}`);
    const members = { 'u-gr-owner': 'owner', 'u-gr-member': 'member' };
    cls = await makeSpace({ members });
    proj = await makeSpace({ kind: 'project', members });
  });
  const path = (s, table, id) => `/api/spaces/${s.id}/${table}/${id}`;

  it("the course's categories and credits are the class's, merged field by field", async () => {
    const current = await (await as.owner(path(cls, 'courses', 'web'))).json();
    const body = { code: current.code, name: current.name, color: current.color, instructor: current.instructor, term: current.term, meetings: current.meetings };
    const saved = await (await put(as.owner, path(cls, 'courses', 'web'), { ...body, credits: 4, gradeCategories: CATS, changed: { credits: null, gradeCategories: [] } }, current.revision)).json();
    expect(saved).toMatchObject({ credits: 4, gradeCategories: CATS });
    expect(await (await as.member(path(cls, 'courses', 'web'))).json()).toMatchObject({ credits: 4, gradeCategories: CATS });
    /* a member is not an editor */
    expect((await put(as.member, path(cls, 'courses', 'web'), { ...body, credits: 1, changed: { credits: 4 } }, saved.revision)).status).toBe(403);
  });

  it("a class item's category is the class's; a project's task has none", async () => {
    const it1 = await (await put(as.owner, path(cls, 'items', 'g1'), { type: 'quiz', title: 'Quiz', courseId: 'web', date: '2026-10-15', status: 'todo', category: 'quiz' })).json();
    expect(it1.category).toBe('quiz');
    const res = await put(as.owner, path(proj, 'items', 'g2'), { type: 'task', title: 'Task', date: '2026-10-10', status: 'todo', assignees: [], category: 'quiz' });
    expect(await res.json()).toEqual({ error: 'invalid', field: 'category' });
  });

  it('leaving keeps the categories and credits on your copy', async () => {
    const leaver = await signIn('gr-leaver');
    const s = await makeSpace({ members: { 'u-gr-leaver': 'member', 'u-gr-owner': 'owner' } });
    await env.DB.prepare('UPDATE courses SET credits = 4, grade_categories = ? WHERE scope = ?').bind(JSON.stringify(CATS), 'c:' + s.id).run();
    expect((await leaver(`/api/spaces/${s.id}/leave`, { method: 'POST', body: { keep: true } })).ok).toBe(true);
    const copy = await env.DB.prepare("SELECT credits, grade_categories FROM courses WHERE scope = 'u:u-gr-leaver' AND deleted_at IS NULL").first();
    expect(copy).toEqual({ credits: 4, grade_categories: JSON.stringify(CATS) });
  });
});
