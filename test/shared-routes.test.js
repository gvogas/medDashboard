import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace } from './spaces.js';

const ROLES = ['owner', 'editor', 'member', 'outsider'];
const as = {}, uid = (role) => `u-rt-${role}`;
let cls, proj;
beforeAll(async () => {
  for (const role of ROLES) as[role] = await signIn(`rt-${role}`);
  const members = { [uid('owner')]: 'owner', [uid('editor')]: 'editor', [uid('member')]: 'member' };
  cls = await makeSpace({ members });
  proj = await makeSpace({ kind: 'project', members });
});

const path = (s, table, id) => `/api/spaces/${s.id}/${table}/${id}`;
const put = (api, p, body, revision = 0) => api(p, { method: 'PUT', body, headers: { 'if-match': `"${revision}"` } });
const del = (api, p, revision) => api(p, { method: 'DELETE', headers: { 'if-match': `"${revision}"` } });
const item = (over = {}) => ({ type: 'assignment', title: 'REST API Project', courseId: 'web', date: '2026-10-15', status: 'todo', weight: 20, ...over });
const task = { type: 'task', title: 'Create incidents endpoint', date: '2026-10-10', status: 'todo', assignees: [] };

describe('shared routes', () => {
  it('answer 404 to someone outside the space, whatever they ask', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await as.outsider(path(cls, 'items', 'x'), { method, body: method === 'PUT' ? item() : undefined, headers: { 'if-match': '"0"' } });
      expect(res.status).toBe(404);
    }
    expect((await as.owner(path(proj, 'courses', 'web'))).status).toBe(404);
    expect((await as.owner('/api/spaces/nonexistent1/items/x')).status).toBe(404);
  });

  it('let editors write class items, in class shape, and members only read them', async () => {
    const res = await put(as.editor, path(cls, 'items', 'a1'), item({ status: 'done', grade: 90, checklist: [{ id: 'c', text: 'x', done: true }] }));
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ scope: cls.scope, updatedBy: uid('editor'), status: 'todo', grade: null, checklist: [], weight: 20 });
    expect(await (await as.member(path(cls, 'items', 'a1'))).json()).toMatchObject({ id: 'a1', revision: saved.revision });
    expect(await (await put(as.member, path(cls, 'items', 'a1'), item(), saved.revision)).json()).toEqual({ error: 'forbidden' });
    expect((await del(as.member, path(cls, 'items', 'a1'), saved.revision)).status).toBe(403);
    expect(await (await put(as.editor, path(cls, 'items', 'a2'), item({ type: 'c-quiz1' }))).json()).toEqual({ error: 'invalid', field: 'type' });
    expect(await (await put(as.editor, path(cls, 'items', 'a2'), item({ courseId: null }))).json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect(await (await put(as.editor, path(cls, 'items', 'a2'), item({ courseId: 'other' }))).json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect((await del(as.editor, path(cls, 'items', 'a1'), saved.revision)).status).toBe(204);
    expect((await as.member(path(cls, 'items', 'a1'))).status).toBe(404);
  });

  it('keep the class course and the project item, made with the space, from being created or deleted', async () => {
    const course = { code: 'WEB', name: 'Web Services', color: '#17B3AE', target: 80, archived: true, meetings: [] };
    expect((await put(as.owner, path(cls, 'courses', 'second'), course)).status).toBe(403);
    const current = await (await as.owner(path(cls, 'courses', 'web'))).json();
    const res = await put(as.owner, path(cls, 'courses', 'web'), { ...course, name: 'Web Services II' }, current.revision);
    expect(await res.json()).toMatchObject({ name: 'Web Services II', target: null, archived: false, updatedBy: uid('owner') });
    expect((await del(as.owner, path(cls, 'courses', 'web'), current.revision + 1)).status).toBe(403);
    expect((await del(as.owner, path(proj, 'items', 'project'), 1)).status).toBe(403);
    expect((await put(as.owner, path(proj, 'items', 'project'), { ...task, type: 'project' })).status).toBe(403);
    expect(await (await put(as.owner, path(proj, 'items', 'other'), { ...task, type: 'project' })).json()).toEqual({ error: 'invalid', field: 'type' });
    expect(await (await put(as.owner, path(proj, 'items', 'w'), { ...task, weight: 10 })).json()).toEqual({ error: 'invalid', field: 'weight' });
  });

  it('refuse writes to an archived space and still serve reads', async () => {
    const s = await makeSpace({ archived: 1, members: { [uid('owner')]: 'owner' } });
    expect(await (await put(as.owner, path(s, 'items', 'x'), item())).json()).toEqual({ error: 'archived' });
    expect((await as.owner(path(s, 'courses', 'web'))).status).toBe(200);
  });

  it('let a project member complete or claim a task and nothing else', async () => {
    const created = await (await put(as.editor, path(proj, 'items', 't1'), task)).json();
    const claimed = await (await put(as.member, path(proj, 'items', 't1'),
      { ...task, title: 'Mine now', assignees: [uid('member'), uid('editor')], changed: { assignees: [] } }, created.revision)).json();
    expect(claimed).toMatchObject({ assignees: [uid('member')], title: 'Create incidents endpoint' });
    const done = await (await put(as.member, path(proj, 'items', 't1'),
      { ...task, status: 'done', completedAt: 5, changed: { status: 'todo', completedAt: null } }, claimed.revision)).json();
    expect(done).toMatchObject({ status: 'done', completedBy: uid('member'), assignees: [uid('member')] });
    expect(await (await put(as.member, path(proj, 'items', 't1'), { ...task, title: 'x', changed: { title: 'Create incidents endpoint' } }, done.revision)).json()).toEqual({ error: 'forbidden' });
    expect(await (await put(as.member, path(proj, 'items', 't2'), task)).json()).toEqual({ error: 'forbidden' });
    expect(await (await put(as.editor, path(proj, 'items', 't3'), { ...task, assignees: [uid('outsider')] })).json()).toEqual({ error: 'invalid', field: 'assignees' });
    expect(await (await put(as.editor, path(proj, 'items', 't3'), { ...task, assignees: ['*', uid('member')] })).json()).toEqual({ error: 'invalid', field: 'assignees' });
  });

  it('merge through the route, and name the field and who on a conflict', async () => {
    const v1 = await (await put(as.owner, path(cls, 'items', 'm1'), item())).json();
    await put(as.owner, path(cls, 'items', 'm1'), { ...item({ date: '2026-10-18' }), changed: { date: '2026-10-15' } }, v1.revision);
    /* `by` names the row's last writer, so the conflict is checked before the editor's own merge */
    const same = await put(as.editor, path(cls, 'items', 'm1'), { ...item({ date: '2026-10-20' }), changed: { date: '2026-10-15' } }, v1.revision);
    expect(same.status).toBe(409);
    expect(await same.json()).toMatchObject({ error: 'conflict', fields: ['date'], by: uid('owner'), current: { date: '2026-10-18' } });
    const notes = await put(as.editor, path(cls, 'items', 'm1'), { ...item({ notes: 'Teams of 3' }), changed: { notes: '' } }, v1.revision);
    expect(await notes.json()).toMatchObject({ date: '2026-10-18', notes: 'Teams of 3' });
    expect(await (await put(as.editor, path(cls, 'items', 'm1'), { ...item(), changed: { status: 'todo' } }, v1.revision)).json()).toEqual({ error: 'invalid', field: 'changed' });
  });
});
