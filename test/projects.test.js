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

  it('refuses a parent you cannot see, a missing date, a bad title, and past 20 spaces', async () => {
    const me = await signInAdmin('pjx' + ++n);
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

  it('is for admins only until Stage 10: making, inviting, accepting, joining', async () => {
    const plain = await signIn('pjp' + ++n);
    const refused = await make(plain, { title: 'X', date: '2026-10-30' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'forbidden' });
    const admin = await signInAdmin('pja' + n);
    const { space } = await (await make(admin, { title: 'Team', date: '2026-10-30' })).json();
    const invite = await post(admin, `/api/spaces/${space.id}/invites`, { username: 'pjp' + n });
    expect(invite.status).toBe(409);
    expect(await invite.json()).toEqual({ error: 'not_admin' });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'editor', ?, ?)")
      .bind(space.id, 'u-pjp' + n, admin.id, Date.now(), Date.now() + 86_400_000).run();
    const accept = await post(plain, `/api/invites/${space.id}/accept`);
    expect(accept.status).toBe(403);
    expect(await accept.json()).toEqual({ error: 'not_admin' });
    const { code } = await (await post(admin, `/api/spaces/${space.id}/code`)).json();
    const join = await post(plain, '/api/join', { code });
    expect(join.status).toBe(403);
    expect(await join.json()).toEqual({ error: 'not_admin' });
  });

  it('an admin invited joins as an editor, with prefs', async () => {
    const owner = await signInAdmin('pji' + ++n), mate = await signInAdmin('pjm' + n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await post(owner, `/api/spaces/${space.id}/invites`, { username: 'pjm' + n });
    expect((await (await post(mate, `/api/invites/${space.id}/accept`)).json()).space).toMatchObject({ role: 'editor' });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND id = ?', mate.id, space.id)).toEqual({ n: 1 });
  });
});
