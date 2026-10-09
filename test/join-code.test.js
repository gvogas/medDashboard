import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, post, signInAdmin } from './spaces.js';
import { hashCode, newCode } from '../worker/invites.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;
let owner, editor, member, joiner1, joiner2, plain, s;
beforeAll(async () => {
  owner = await signInAdmin('jc-owner');
  editor = await signIn('jc-editor'); editor.id = 'u-jc-editor';
  member = await signIn('jc-member'); member.id = 'u-jc-member';
  joiner1 = await signInAdmin('jc-joiner1');
  joiner2 = await signInAdmin('jc-joiner2');
  plain = await signIn('jc-plain');
  s = await makeSpace({ members: { [owner.id]: 'owner', [editor.id]: 'editor', [member.id]: 'member' } });
}, 60_000);

const makeCode = (api, space = s) => post(api, `/api/spaces/${space.id}/code`);
const join = (api, code) => post(api, '/api/join', { code });
const usesLeft = async (space = s) => (await env.DB.prepare('SELECT code_uses_left AS n FROM spaces WHERE id = ?').bind(space.id).first()).n;

describe('join codes', () => {
  it('are 8 Crockford characters from 40 random bits, kept as their SHA-256', async () => {
    const codes = new Set(Array.from({ length: 100 }, newCode));
    expect(codes.size).toBe(100);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await hashCode('7KQ2M9XD')).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashCode('7KQ2M9XD')).not.toBe(await hashCode('7KQ2M9XE'));
  });

  it('are made by the owner only, stored only as the hash, for 7 days and 10 uses', async () => {
    expect((await makeCode(editor)).status).toBe(403);
    expect((await makeCode(member)).status).toBe(403);
    expect((await makeCode(joiner1)).status).toBe(404);
    const before = Date.now();
    const res = await makeCode(owner);
    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(made.usesLeft).toBe(10);
    expect(made.expires - before).toBeGreaterThanOrEqual(WEEK_MS);
    expect(made.expires - before).toBeLessThan(WEEK_MS + 60_000);
    const stored = await env.DB.prepare('SELECT code_hash, code_expires, code_uses_left FROM spaces WHERE id = ?').bind(s.id).first();
    expect(stored).toEqual({ code_hash: await hashCode(made.code), code_expires: made.expires, code_uses_left: 10 });
    expect((await (await owner(`/api/spaces/${s.id}`)).json()).code).toEqual({ expires: made.expires, usesLeft: 10 });
  });

  it('let an admin join as the code is typed, as a member, once; a new code retires the old', async () => {
    const old = (await (await makeCode(owner)).json()).code;
    const { code } = await (await makeCode(owner)).json();
    expect((await join(joiner1, old)).status).toBe(404);
    const typed = (code.slice(0, 4) + ' ' + code.slice(4)).toLowerCase();
    const res = await join(joiner1, typed);
    expect(res.status).toBe(200);
    expect((await res.json()).space).toMatchObject({ id: s.id, role: 'member', name: 'Web Services', members: 4 });
    expect(await usesLeft()).toBe(9);
    expect((await join(joiner1, code)).status).toBe(200);
    expect(await usesLeft()).toBe(9);
    const page = await (await joiner1('/api/sync?v=3&cursors=')).json();
    expect(page.scopes.map((x) => x.id)).toContain(s.id);
  });

  it('take a pending invite with its role, and mark it accepted', async () => {
    expect((await post(owner, `/api/spaces/${s.id}/invites`, { username: 'jc-joiner2', role: 'editor' })).status).toBe(201);
    const { code } = await (await makeCode(owner)).json();
    expect((await (await join(joiner2, code)).json()).space).toMatchObject({ role: 'editor' });
    expect(await env.DB.prepare('SELECT status FROM invites WHERE space_id = ? AND user_id = ?').bind(s.id, joiner2.id).first()).toEqual({ status: 'accepted' });
  });

  it('refuse: not an admin 403, malformed 400, unknown 404, expired or used up 410', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    const { code } = await (await makeCode(owner, t)).json();
    const late = await signInAdmin('jc-late');
    expect(await (await join(plain, code)).json()).toEqual({ error: 'forbidden' });
    expect(await (await join(late, 'ABC')).json()).toEqual({ error: 'invalid', field: 'code' });
    expect(await (await join(late, 12345678)).json()).toEqual({ error: 'invalid', field: 'code' });
    expect(await (await join(late, 'ZZZZZZZZ')).json()).toEqual({ error: 'not_found' });
    await env.DB.prepare('UPDATE spaces SET code_expires = 1 WHERE id = ?').bind(t.id).run();
    expect(await (await join(late, code)).json()).toEqual({ error: 'expired' });
    await env.DB.prepare('UPDATE spaces SET code_expires = ?, code_uses_left = 0 WHERE id = ?').bind(Date.now() + 1e9, t.id).run();
    expect((await join(late, code)).status).toBe(410);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE space_id = ?').bind(t.id).first()).n).toBe(1);
  });

  it('stop at 30 members (409 full) and at 20 spaces (409 limit), using nothing', async () => {
    const crowd = { [owner.id]: 'owner' };
    for (let i = 0; i < 29; i++) crowd[await createUser(`jc-crowd-${i}`)] = 'member';
    const full = await makeSpace({ members: crowd });
    const { code } = await (await makeCode(owner, full)).json();
    const busy = await signInAdmin('jc-busy');
    expect(await (await join(busy, code)).json()).toEqual({ error: 'full' });
    expect(await usesLeft(full)).toBe(10);
    const room = await makeSpace({ members: { [owner.id]: 'owner' } });
    const second = (await (await makeCode(owner, room)).json()).code;
    for (let i = 0; i < 20; i++) await makeSpace({ members: { [busy.id]: 'member' } });
    expect(await (await join(busy, second)).json()).toEqual({ error: 'limit' });
    expect(await usesLeft(room)).toBe(10);
  });

  it('refuse while the class is archived (403 archived), using nothing; unarchived, it joins', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    const { code } = await (await makeCode(owner, t)).json();
    const shut = await signInAdmin('jc-shut');
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(t.id).run();
    const res = await join(shut, code);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'archived' });
    expect(await usesLeft(t)).toBe(10);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE space_id = ?').bind(t.id).first()).n).toBe(1);
    await env.DB.prepare('UPDATE spaces SET archived = 0 WHERE id = ?').bind(t.id).run();
    expect((await join(shut, code)).status).toBe(200);
    expect(await usesLeft(t)).toBe(9);
  });

  it('count ten tries an hour per person', async () => {
    const tries = await signInAdmin('jc-tries');
    for (let i = 0; i < 10; i++) expect((await join(tries, 'ZZZZZZZZ')).status).toBe(404);
    const res = await join(tries, 'ZZZZZZZZ');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
  });

  it('can be turned off by the owner', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner', [editor.id]: 'editor' } });
    const { code } = await (await makeCode(owner, t)).json();
    expect((await editor(`/api/spaces/${t.id}/code`, { method: 'DELETE' })).status).toBe(403);
    expect((await owner(`/api/spaces/${t.id}/code`, { method: 'DELETE' })).status).toBe(204);
    expect((await (await owner(`/api/spaces/${t.id}`)).json()).code).toBeNull();
    const late2 = await signInAdmin('jc-late2');
    expect((await join(late2, code)).status).toBe(404);
  });
});
