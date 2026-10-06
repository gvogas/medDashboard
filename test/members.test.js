import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, spaceRevision } from './spaces.js';

const ROLES = ['owner', 'editor', 'member', 'outsider'];
const as = {}, uid = (role) => `u-mb-${role}`;
let s;
beforeAll(async () => {
  for (const role of ROLES) as[role] = await signIn(`mb-${role}`);
  s = await makeSpace({ members: { [uid('owner')]: 'owner', [uid('editor')]: 'editor', [uid('member')]: 'member' } });
});

const details = async (role, space = s) => (await as[role](`/api/spaces/${space.id}`)).json();
const setRole = (role, target, body, space = s) => as[role](`/api/spaces/${space.id}/members/${target}`, { method: 'PUT', body });
const roles = async (space) => (await env.DB.prepare('SELECT user_id AS id, role FROM members WHERE space_id = ? AND deleted_at IS NULL ORDER BY user_id').bind(space.id).all()).results;

describe("a class's details", () => {
  it('show the members to everyone in it, invites to owner and editors, the code to the owner only', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, status, created_at, expires_at) VALUES (?, ?, ?, 'member', 'pending', 1, ?)")
        .bind(s.id, uid('outsider'), uid('owner'), Date.now() + 1e9),
      env.DB.prepare('UPDATE spaces SET code_hash = ?, code_expires = ?, code_uses_left = 4 WHERE id = ?').bind('a'.repeat(64), Date.now() + 1e9, s.id),
    ]);
    const o = await details('owner');
    expect(o).toMatchObject({ id: s.id, scope: s.scope, kind: 'class', role: 'owner', archived: false, code: { usesLeft: 4 } });
    /* all joined at the same moment, so in user id order */
    expect(o.members.map((m) => [m.username, m.role])).toEqual([['mb-editor', 'editor'], ['mb-member', 'member'], ['mb-owner', 'owner']]);
    expect(o.members.find((m) => m.role === 'owner')).toMatchObject({ userId: uid('owner'), name: 'mb-owner', joinedAt: 1 });
    expect(o.invites).toEqual([expect.objectContaining({ userId: uid('outsider'), name: 'mb-outsider', role: 'member', status: 'pending', invitedBy: uid('owner') })]);
    expect(await details('editor')).toMatchObject({ role: 'editor', code: null, invites: [expect.objectContaining({ userId: uid('outsider') })] });
    expect(await details('member')).toMatchObject({ role: 'member', code: null, invites: [] });
    expect((await as.outsider(`/api/spaces/${s.id}`)).status).toBe(404);
    await env.DB.prepare('UPDATE invites SET created_at = 1, expires_at = 2 WHERE space_id = ?').bind(s.id).run();
    expect((await details('owner')).invites[0].status).toBe('expired');
  });
});

describe('roles', () => {
  it('let the owner make a member an editor and back, moving the space revision', async () => {
    const before = await spaceRevision(s.id);
    const res = await setRole('owner', uid('member'), { role: 'editor' });
    expect(await res.json()).toEqual({ userId: uid('member'), role: 'editor' });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    expect(await (await setRole('owner', uid('member'), { role: 'member' })).json()).toEqual({ userId: uid('member'), role: 'member' });
  });

  it('are the owner alone to change, never their own, never to owner', async () => {
    expect(await (await setRole('editor', uid('member'), { role: 'editor' })).json()).toEqual({ error: 'forbidden' });
    expect((await setRole('member', uid('editor'), { role: 'member' })).status).toBe(403);
    expect((await setRole('outsider', uid('member'), { role: 'editor' })).status).toBe(404);
    expect(await (await setRole('owner', uid('owner'), { role: 'editor' })).json()).toEqual({ error: 'forbidden' });
    expect(await (await setRole('owner', uid('member'), { role: 'owner' })).json()).toEqual({ error: 'invalid', field: 'role' });
    expect((await setRole('owner', uid('outsider'), { role: 'editor' })).status).toBe(404);
    expect(await roles(s)).toEqual([{ id: uid('editor'), role: 'editor' }, { id: uid('member'), role: 'member' }, { id: uid('owner'), role: 'owner' }]);
  });
});

describe('handing a class on', () => {
  it('makes a member the owner and the old owner an editor, in one batch; only the owner can', async () => {
    const t = await makeSpace({ members: { [uid('owner')]: 'owner', [uid('member')]: 'member' } });
    const transfer = (role, userId) => post(as[role], `/api/spaces/${t.id}/transfer`, { userId });
    expect((await transfer('outsider', uid('member'))).status).toBe(404);
    expect((await transfer('member', uid('member'))).status).toBe(403);
    expect((await transfer('owner', uid('outsider'))).status).toBe(404);
    expect(await (await transfer('owner', uid('owner'))).json()).toEqual({ error: 'invalid', field: 'userId' });
    expect(await roles(t)).toEqual([{ id: uid('member'), role: 'member' }, { id: uid('owner'), role: 'owner' }]);
    const before = await spaceRevision(t.id);
    expect((await transfer('owner', uid('member'))).status).toBe(204);
    expect(await roles(t)).toEqual([{ id: uid('member'), role: 'owner' }, { id: uid('owner'), role: 'editor' }]);
    expect(await spaceRevision(t.id)).toBeGreaterThan(before);
    expect((await transfer('owner', uid('member'))).status).toBe(403);
  });
});
