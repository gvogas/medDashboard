import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, post, signInAdmin, spaceRevision } from './spaces.js';

let owner, editor, member, guest, guest2, guest3, plain, s;
beforeAll(async () => {
  owner = await signInAdmin('iv-owner');
  editor = await signIn('iv-editor'); editor.id = 'u-iv-editor';
  member = await signIn('iv-member'); member.id = 'u-iv-member';
  guest = await signInAdmin('iv-guest');
  guest2 = await signInAdmin('iv-guest2');
  guest3 = await signInAdmin('iv-guest3');
  plain = await signIn('iv-plain');
  s = await makeSpace({ members: { [owner.id]: 'owner', [editor.id]: 'editor', [member.id]: 'member' } });
}, 60_000);

const invite = (api, username, role = null, space = s) => post(api, `/api/spaces/${space.id}/invites`, role ? { username, role } : { username });
const accept = (api, space = s) => post(api, `/api/invites/${space.id}/accept`);
const decline = (api, space = s) => post(api, `/api/invites/${space.id}/decline`);
const withdraw = (api, userId, space = s) => api(`/api/spaces/${space.id}/invites/${userId}`, { method: 'DELETE' });
const row = (space, userId) => env.DB.prepare('SELECT role, status, invited_by AS invitedBy FROM invites WHERE space_id = ? AND user_id = ?').bind(space.id, userId).first();

describe('invites', () => {
  it("go by username with the class's default role; only the owner gives another", async () => {
    const res = await invite(editor, 'IV-Guest');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ userId: guest.id, username: 'iv-guest', name: 'iv-guest', role: 'member', status: 'pending', invitedBy: editor.id });
    expect(await (await invite(editor, 'iv-guest2', 'editor')).json()).toEqual({ error: 'forbidden' });
    expect(await (await invite(owner, 'iv-guest2', 'editor')).json()).toMatchObject({ userId: guest2.id, role: 'editor' });
    expect((await invite(member, 'iv-guest3')).status).toBe(403);
    expect((await invite(guest3, 'iv-guest')).status).toBe(404);
  });

  it('name what is wrong: no such account, already a member, a bad body; a plain account is invited like anyone', async () => {
    const nobody = await invite(owner, 'nobody-here');
    expect(nobody.status).toBe(404);
    expect(await nobody.json()).toEqual({ error: 'no_user' });
    expect(await (await invite(owner, 'x')).json()).toEqual({ error: 'no_user' });
    expect(await (await invite(owner, 'iv-member')).json()).toEqual({ error: 'member' });
    expect(await (await invite(owner, 'iv-plain')).json()).toMatchObject({ role: 'member' });
    expect(await (await post(owner, `/api/spaces/${s.id}/invites`, { username: 7 })).json()).toEqual({ error: 'invalid', field: 'username' });
    expect(await (await invite(owner, 'iv-guest3', 'owner')).json()).toEqual({ error: 'invalid', field: 'role' });
  });

  it('are listed to the one invited, with who sent them; a decline shows to the inviter; a repeat refreshes the one row', async () => {
    const mine = await (await guest('/api/invites')).json();
    expect(mine.invites).toEqual([expect.objectContaining({ spaceId: s.id, kind: 'class', name: 'Web Services', role: 'member', from: 'iv-editor', expired: false })]);
    expect((await decline(guest)).status).toBe(204);
    expect((await decline(guest)).status).toBe(404);
    expect((await (await guest('/api/invites')).json()).invites).toEqual([]);
    expect((await (await owner(`/api/spaces/${s.id}`)).json()).invites.find((i) => i.userId === guest.id)).toMatchObject({ status: 'declined' });
    expect((await invite(owner, 'iv-guest')).status).toBe(201);
    expect(await row(s, guest.id)).toEqual({ role: 'member', status: 'pending', invitedBy: owner.id });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM invites WHERE space_id = ? AND user_id = ?').bind(s.id, guest.id).first()).n).toBe(1);
  });

  it('accepted make you a member with their role, move the space on, and sync loads the class from 0; again is the same', async () => {
    const before = await spaceRevision(s.id);
    const res = await accept(guest);
    expect(res.status).toBe(200);
    expect((await res.json()).space).toMatchObject({ id: s.id, scope: s.scope, name: 'Web Services', role: 'member', members: 4 });
    expect(await row(s, guest.id)).toMatchObject({ status: 'accepted' });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    const page = await (await guest('/api/sync?v=3&cursors=')).json();
    expect(page.scopes.map((x) => x.id)).toContain(s.id);
    expect(page.changes.filter((c) => c.scope === s.scope).map((c) => `${c.kind}:${c.row.id}`)).toEqual(['courses:web']);
    expect((await accept(guest)).status).toBe(200);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE space_id = ?').bind(s.id).first()).n).toBe(4);
    expect(await (await invite(owner, 'iv-guest')).json()).toEqual({ error: 'member' });
  });

  it('refuse to be accepted when withdrawn or missing, expired, or the class is gone', async () => {
    expect((await accept(guest3)).status).toBe(404);
    /* expired: 410, shown as expired, and still pending */
    expect((await invite(owner, 'iv-guest3')).status).toBe(201);
    await env.DB.prepare('UPDATE invites SET created_at = 1, expires_at = 2 WHERE space_id = ? AND user_id = ?').bind(s.id, guest3.id).run();
    expect((await (await guest3('/api/invites')).json()).invites).toEqual([expect.objectContaining({ spaceId: s.id, expired: true })]);
    expect(await (await accept(guest3)).json()).toEqual({ error: 'expired' });
    expect((await accept(guest3)).status).toBe(410);
    expect(await row(s, guest3.id)).toMatchObject({ status: 'pending' });
    /* withdrawn: by the one who sent it, or the owner */
    expect((await invite(owner, 'iv-guest3')).status).toBe(201);
    expect(await (await withdraw(editor, guest3.id)).json()).toEqual({ error: 'forbidden' });
    expect((await withdraw(member, guest3.id)).status).toBe(403);
    expect((await withdraw(owner, guest3.id)).status).toBe(204);
    expect((await withdraw(owner, guest3.id)).status).toBe(404);
    expect((await accept(guest3)).status).toBe(404);
    expect((await invite(editor, 'iv-guest3')).status).toBe(201);
    expect((await withdraw(editor, guest3.id)).status).toBe(204);
    /* a class deleted before the invite was accepted */
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    expect((await invite(owner, 'iv-guest3', null, t)).status).toBe(201);
    await env.DB.prepare('UPDATE spaces SET deleted_at = 5 WHERE id = ?').bind(t.id).run();
    expect((await accept(guest3, t)).status).toBe(404);
  });

  it('refuse to be accepted while the class is archived (403 archived); the invite stays pending for when it is unarchived', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    const shut = await signInAdmin('iv-shut');
    expect((await invite(owner, 'iv-shut', null, t)).status).toBe(201);
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(t.id).run();
    const before = await spaceRevision(t.id);
    const res = await accept(shut, t);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'archived' });
    expect(await row(t, shut.id)).toMatchObject({ status: 'pending' });
    expect(await spaceRevision(t.id)).toBe(before);
    expect(await env.DB.prepare('SELECT 1 AS x FROM members WHERE space_id = ? AND user_id = ?').bind(t.id, shut.id).first()).toBeNull();
    await env.DB.prepare('UPDATE spaces SET archived = 0 WHERE id = ?').bind(t.id).run();
    expect((await accept(shut, t)).status).toBe(200);
    expect(await row(t, shut.id)).toMatchObject({ status: 'accepted' });
  });

  it('are accepted by a plain account like anyone, who becomes a member', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    const sent = await invite(owner, 'iv-plain', null, t);
    expect(sent.status).toBe(201);
    const { userId } = await sent.json();
    const res = await accept(plain, t);
    expect(res.status).toBe(200);
    expect((await res.json()).space).toMatchObject({ id: t.id, role: 'member' });
    expect(await row(t, userId)).toMatchObject({ status: 'accepted' });
    expect(await env.DB.prepare('SELECT role FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL').bind(t.id, userId).first()).toEqual({ role: 'member' });
  });

  it('stop at 20 spaces (409 limit) and 30 members (409 full); the invite stays pending', async () => {
    const busy = await signInAdmin('iv-busy');
    for (let i = 0; i < 20; i++) await makeSpace({ members: { [busy.id]: 'member' } });
    expect((await invite(owner, 'iv-busy')).status).toBe(201);
    expect(await (await accept(busy)).json()).toEqual({ error: 'limit' });
    expect(await row(s, busy.id)).toMatchObject({ status: 'pending' });

    const crowd = { [owner.id]: 'owner' };
    for (let i = 0; i < 29; i++) crowd[await createUser(`iv-crowd-${i}`)] = 'member';
    const full = await makeSpace({ members: crowd });
    const late = await signInAdmin('iv-late');
    expect((await invite(owner, 'iv-late', null, full)).status).toBe(201);
    expect(await (await accept(late, full)).json()).toEqual({ error: 'full' });
    expect(await row(full, late.id)).toMatchObject({ status: 'pending' });
  });

  it('count 20 an hour per person sending them, unknown names too', async () => {
    const boss = await signInAdmin('iv-boss');
    const t = await makeSpace({ members: { [boss.id]: 'owner' } });
    for (let i = 0; i < 20; i++) expect((await invite(boss, `nobody-${i}`, null, t)).status).toBe(404);
    const res = await invite(boss, 'iv-guest', null, t);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
  });
});
