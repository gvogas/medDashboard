import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { makeSpace, post, sharedItem, signInAdmin, spaceRevision } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
async function pair() {
  const tag = ++n, owner = await signInAdmin('sao' + tag), member = await signInAdmin('sam' + tag);
  const s = await makeSpace({ members: { [owner.id]: 'owner', [member.id]: 'editor' } });
  await sharedItem(s.scope, 'a1', { course_id: 'web' });
  return { owner, member, s };
}

describe('archiving a class', () => {
  it('the owner archives and unarchives; it is read-only meanwhile, but the owner still manages members', async () => {
    const { owner, member, s } = await pair();
    const archive = (api, archived) => post(api, `/api/spaces/${s.id}/archive`, { archived });
    expect((await archive(member, true)).status).toBe(403);
    expect(await (await archive(owner, 'yes')).json()).toEqual({ error: 'invalid', field: 'archived' });
    const before = await spaceRevision(s.id);
    expect((await archive(owner, true)).status).toBe(204);
    expect(await one('SELECT archived FROM spaces WHERE id = ?', s.id)).toEqual({ archived: 1 });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    /* shared edits and invites are refused; a role change and a transfer are not */
    const edit = await member(`/api/spaces/${s.id}/items/a1`, { method: 'DELETE', headers: { 'if-match': '"1"' } });
    expect(await edit.json()).toEqual({ error: 'archived' });
    expect((await post(owner, `/api/spaces/${s.id}/invites`, { username: 'nobody' })).status).toBe(403);
    expect((await owner(`/api/spaces/${s.id}/members/${member.id}`, { method: 'PUT', body: { role: 'member' } })).status).toBe(200);
    expect((await post(owner, `/api/spaces/${s.id}/transfer`, { userId: member.id })).status).toBe(204);
    /* the new owner unarchives; again is a no-op */
    expect((await archive(member, false)).status).toBe(204);
    expect((await archive(member, false)).status).toBe(204);
    expect(await one('SELECT archived FROM spaces WHERE id = ?', s.id)).toEqual({ archived: 0 });
  });

  it('while archived, roles, transfer, removal and leaving still work; codes and invites do not (Decision 4)', async () => {
    const tag = ++n, owner = await signInAdmin('aro' + tag), a = await signInAdmin('ara' + tag);
    const b = await signInAdmin('arb' + tag), c = await signInAdmin('arc' + tag);
    const s = await makeSpace({ archived: 1, members: { [owner.id]: 'owner', [a.id]: 'member', [b.id]: 'member', [c.id]: 'member' } });
    expect((await owner(`/api/spaces/${s.id}/members/${a.id}`, { method: 'PUT', body: { role: 'editor' } })).status).toBe(200);
    expect((await post(owner, `/api/spaces/${s.id}/transfer`, { userId: a.id })).status).toBe(204);
    expect((await a(`/api/spaces/${s.id}/members/${b.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await post(c, `/api/spaces/${s.id}/leave`)).status).toBe(204);
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ? AND deleted_at IS NULL', s.id)).toEqual({ n: 2 });
    const code = await post(a, `/api/spaces/${s.id}/code`);
    expect(code.status).toBe(403);
    expect(await code.json()).toEqual({ error: 'archived' });
    const inv = await post(a, `/api/spaces/${s.id}/invites`, { username: 'nobody' });
    expect(inv.status).toBe(403);
    expect(await inv.json()).toEqual({ error: 'archived' });
  });
});

describe('deleting a class', () => {
  it('only while the owner is its only member; with a copy by default', async () => {
    const { owner, member, s } = await pair();
    const del = (api, body = {}) => api(`/api/spaces/${s.id}`, { method: 'DELETE', body });
    expect((await del(member)).status).toBe(403);
    const busy = await del(owner);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: 'members' });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, role, created_at, expires_at) VALUES (?, ?, 'member', 1, 2)").bind(s.id, member.id).run();
    expect((await owner(`/api/spaces/${s.id}/members/${member.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await del(owner)).status).toBe(204);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM spaces WHERE id = ?', s.id)).toEqual({ gone: 1 });
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", owner.id)).toEqual({ n: 1 });
    expect(await one('SELECT count(*) AS n FROM invites WHERE space_id = ?', s.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ? AND deleted_at IS NULL', s.id)).toEqual({ n: 0 });
    expect((await owner(`/api/spaces/${s.id}`)).status).toBe(404);
    expect((await del(owner)).status).toBe(404);
  });

  it('without a copy, nothing comes into your scope', async () => {
    const tag = ++n, owner = await signInAdmin('solo' + tag);
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    expect((await owner(`/api/spaces/${s.id}`, { method: 'DELETE', body: { keepCopy: false } })).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", owner.id)).toEqual({ n: 0 });
  });
});
