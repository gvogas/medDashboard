import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, sharedItem, signInAdmin } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const make = (api, body) => post(api, '/api/spaces', { kind: 'project', ...body });

describe('making a team project (spec §10, §20)', () => {
  it('makes the space, your membership as owner, its project item and your prefs', async () => {
    const me = await signInAdmin('pjo' + ++n);
    const res = await make(me, { title: 'Fire Response API', date: '2026-10-30' });
    expect(res.status).toBe(201);
    const { space } = await res.json();
    expect(space).toMatchObject({ kind: 'project', name: 'Fire Response API', role: 'owner', members: 1, scope: 'p:' + space.id });
    expect(await one("SELECT type, title, date, status FROM items WHERE scope = ? AND id = 'project'", space.scope))
      .toEqual({ type: 'project', title: 'Fire Response API', date: '2026-10-30', status: 'todo' });
    expect(await one('SELECT term FROM space_prefs WHERE user_id = ? AND id = ?', me.id, space.id)).toEqual({ term: '' });
    expect(await one('SELECT count(*) AS n FROM activity WHERE space_id = ?', space.id)).toEqual({ n: 0 });
  });

  it("takes the assignment's date when it belongs to one you can see", async () => {
    const me = await signInAdmin('pjl' + ++n);
    const cls = await makeSpace({ members: { [me.id]: 'member' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web', title: 'REST API Project', date: '2026-10-15' });
    const { space } = await (await make(me, { title: 'Fire Response API', parent: { space: cls.id, item: 'a1' } })).json();
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-10-15' });
    expect(await one('SELECT parent_space, parent_item FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: cls.id, parent_item: 'a1' });
  });

  it('refuses a parent you cannot see, a missing date, a bad title, and past 20 spaces (not an admin)', async () => {
    const me = await signIn('pjx' + ++n);
    me.id = 'u-pjx' + n;
    const theirs = await makeSpace({ members: {} });
    await sharedItem(theirs.scope, 'a1', { course_id: 'web' });
    const mine = await makeSpace({ members: { [me.id]: 'member' } });
    await sharedItem(mine.scope, 'gone', { course_id: 'web', deleted_at: 5 });
    const team = await makeSpace({ kind: 'project', members: { [me.id]: 'owner' } });
    await sharedItem(team.scope, 't1');
    for (const parent of [{ space: mine.id, item: 'nope' }, { space: mine.id, item: 'gone' }, { space: team.id, item: 't1' }, { space: team.id, item: 'project' }]) {
      expect(await (await make(me, { title: 'X', parent })).json()).toEqual({ error: 'invalid', field: 'parent' });
    }
    expect(await (await make(me, { title: 'X', parent: { space: theirs.id, item: 'a1' } })).json()).toEqual({ error: 'invalid', field: 'parent' });
    expect(await (await make(me, { title: 'X' })).json()).toEqual({ error: 'invalid', field: 'date' });
    expect(await (await make(me, { title: '', date: '2026-10-30' })).json()).toEqual({ error: 'invalid', field: 'title' });
    expect(await (await make(me, { title: 'A\0B', date: '2026-10-30' })).json()).toEqual({ error: 'invalid', field: 'title' });
    for (let i = 0; i < 18; i++) await makeSpace({ members: { [me.id]: 'member' } });
    const full = await make(me, { title: 'One more', date: '2026-10-30' });
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'limit' });
  });

  it('is open to everyone: making, inviting, accepting, joining by code', async () => {
    const tag = ++n;
    const plain = await signIn('pjp' + tag), other = await signIn('pjq' + tag);
    plain.id = 'u-pjp' + tag; other.id = 'u-pjq' + tag;
    const made = await make(plain, { title: 'Team', date: '2026-10-30' });
    expect(made.status).toBe(201);
    const { space } = await made.json();
    expect((await post(plain, `/api/spaces/${space.id}/invites`, { username: 'pjq' + tag })).status).toBe(201);
    expect((await post(other, `/api/invites/${space.id}/accept`)).status).toBe(200);
    const third = await signIn('pjr' + tag);
    const { code } = await (await post(plain, `/api/spaces/${space.id}/code`)).json();
    expect((await post(third, '/api/join', { code })).status).toBe(200);
  });

  it('an admin invited joins as an editor, with prefs', async () => {
    const owner = await signInAdmin('pji' + ++n), mate = await signInAdmin('pjm' + n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await post(owner, `/api/spaces/${space.id}/invites`, { username: 'pjm' + n });
    expect((await (await post(mate, `/api/invites/${space.id}/accept`)).json()).space).toMatchObject({ role: 'editor' });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND id = ?', mate.id, space.id)).toEqual({ n: 1 });
  });
});

const task = (api, sid, id, body, rev = 0) => api(`/api/spaces/${sid}/items/${id}`, { method: 'PUT', headers: { 'if-match': `"${rev}"` },
  body: { type: 'task', title: id, date: '2026-10-20', status: 'todo', assignees: [], ...body } });

describe('tasks (spec §5, §10)', () => {
  it('editors add tasks up to 200; a write to one that exists is never refused for it', async () => {
    const owner = await signInAdmin('ptl' + ++n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.batch(Array.from({ length: 199 }, (_, i) => env.DB.prepare(`INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at)
      VALUES (?, ?, 'task', 't', '2026-10-20', 'todo', 1, 1)`).bind(space.scope, 'x' + i)));
    const last = await task(owner, space.id, 'last', {});
    expect(last.status).toBe(200);
    const over = await task(owner, space.id, 'over', {});
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: 'limit' });
    const again = await task(owner, space.id, 'last', { title: 'Last one' }, (await last.json()).revision);
    expect(again.status).toBe(200);
  });

  it('reviving a deleted task needs room too', async () => {
    const owner = await signInAdmin('ptv' + ++n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.batch(Array.from({ length: 199 }, (_, i) => env.DB.prepare(`INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at)
      VALUES (?, ?, 'task', 't', '2026-10-20', 'todo', 1, 1)`).bind(space.scope, 'x' + i)));
    expect((await task(owner, space.id, 'gone', {})).status).toBe(200);
    await env.DB.prepare("UPDATE items SET deleted_at = 5 WHERE scope = ? AND id = 'gone'").bind(space.scope).run();
    const { revision } = await one("SELECT revision FROM items WHERE scope = ? AND id = 'gone'", space.scope);
    expect((await task(owner, space.id, 'new', {})).status).toBe(200);
    const revived = await task(owner, space.id, 'gone', {}, revision);
    expect(revived.status).toBe(409);
    expect(await revived.json()).toEqual({ error: 'limit' });
    await env.DB.prepare("UPDATE items SET deleted_at = 6 WHERE scope = ? AND id = 'new'").bind(space.scope).run();
    expect((await task(owner, space.id, 'gone', {}, revision)).status).toBe(200);
  });

  it("a member completes a task assigned to them, and claims an unassigned one", async () => {
    const owner = await signInAdmin('ptm' + ++n), mate = await signInAdmin('ptn' + n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', 1, 1)").bind(space.id, mate.id).run();
    const t1 = await (await task(owner, space.id, 't1', { assignees: [mate.id] })).json();
    const done = await mate(`/api/spaces/${space.id}/items/t1`, { method: 'PUT', headers: { 'if-match': `"${t1.revision}"` },
      body: { ...t1, status: 'done', completedAt: Date.now(), changed: { status: 'todo', completedAt: null } } });
    expect((await done.json())).toMatchObject({ status: 'done', completedBy: mate.id });
    const t2 = await (await task(owner, space.id, 't2', {})).json();
    const claimed = await mate(`/api/spaces/${space.id}/items/t2`, { method: 'PUT', headers: { 'if-match': `"${t2.revision}"` },
      body: { ...t2, assignees: [mate.id], changed: { assignees: [] } } });
    expect((await claimed.json()).assignees).toEqual([mate.id]);
  });
});

describe('linking a project to an assignment (spec §10)', () => {
  it('the owner links it (taking the date), relinks, and unlinks; activity says so', async () => {
    const owner = await signInAdmin('pkl' + ++n);
    const cls = await makeSpace({ members: { [owner.id]: 'member' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web', title: 'REST API Project', date: '2026-10-15' });
    await sharedItem(cls.scope, 'a2', { course_id: 'web', title: 'GraphQL Project', date: '2026-11-02' });
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    const link = (parent) => post(owner, `/api/spaces/${space.id}/link`, { parent });
    /* rows by one person coalesce within ten minutes (Stage 7); each act here comes later */
    const later = () => env.DB.prepare("UPDATE activity SET bucket = bucket - 1 WHERE space_id = ? AND verb = 'space.linked'").bind(space.id).run();
    expect((await link({ space: cls.id, item: 'a1' })).status).toBe(204);
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-10-15' });
    expect(await one('SELECT parent_space, parent_item FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: cls.id, parent_item: 'a1' });
    await later();
    expect((await link({ space: cls.id, item: 'a2' })).status).toBe(204);
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-11-02' });
    expect(await one('SELECT parent_space, parent_item FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: cls.id, parent_item: 'a2' });
    await later();
    expect((await link(null)).status).toBe(204);
    expect(await one('SELECT parent_space, parent_item FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: null, parent_item: null });
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-11-02' });
    const notes = (await env.DB.prepare(`SELECT old_value, new_value, json_extract(detail, '$.assignment') AS a FROM activity
      WHERE space_id = ? AND verb = 'space.linked' ORDER BY seq`).bind(space.id).all()).results;
    expect(notes).toEqual([{ old_value: '', new_value: 'a1', a: 'REST API Project' }, { old_value: 'a1', new_value: 'a2', a: 'GraphQL Project' },
      { old_value: 'a2', new_value: null, a: null }]);
  });

  it('a link undone within its ten minutes leaves no row (spec §12)', async () => {
    const owner = await signInAdmin('pku' + ++n);
    const cls = await makeSpace({ members: { [owner.id]: 'member' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web' });
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    const link = (parent) => post(owner, `/api/spaces/${space.id}/link`, { parent });
    expect((await link({ space: cls.id, item: 'a1' })).status).toBe(204);
    expect((await link(null)).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM activity WHERE space_id = ? AND verb = 'space.linked'", space.id)).toEqual({ n: 0 });
  });

  it('refuses an editor, an archived project, a bad or deleted assignment or one in a class you are not in, and a class space', async () => {
    const owner = await signInAdmin('pkr' + ++n), ed = await signInAdmin('pke' + n);
    const cls = await makeSpace({ members: {} });
    await sharedItem(cls.scope, 'a1', { course_id: 'web' });
    const mine = await makeSpace({ members: { [owner.id]: 'owner' } });
    await sharedItem(mine.scope, 'gone', { course_id: 'web', deleted_at: 5 });
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'editor', 1, 1)").bind(space.id, ed.id).run();
    expect((await post(ed, `/api/spaces/${space.id}/link`, { parent: null })).status).toBe(403);
    expect(await (await post(owner, `/api/spaces/${space.id}/link`, { parent: { space: cls.id, item: 'a1' } })).json()).toEqual({ error: 'invalid', field: 'parent' });
    expect(await (await post(owner, `/api/spaces/${space.id}/link`, { parent: { space: mine.id, item: 'gone' } })).json()).toEqual({ error: 'invalid', field: 'parent' });
    const malformed = await post(owner, `/api/spaces/${space.id}/link`, { parent: { space: 'x' } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid', field: 'parent' });
    expect((await post(owner, `/api/spaces/${mine.id}/link`, { parent: null })).status).toBe(404);
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(space.id).run();
    const archived = await post(owner, `/api/spaces/${space.id}/link`, { parent: null });
    expect(archived.status).toBe(403);
    expect(await archived.json()).toEqual({ error: 'archived' });
  });
});
