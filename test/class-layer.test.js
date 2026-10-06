import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeSpace, post, setMember, signInAdmin } from './spaces.js';

let owner, ana, ben;
beforeAll(async () => { owner = await signInAdmin('cl-owner'); ana = await signInAdmin('cl-ana'); ben = await signInAdmin('cl-ben'); }, 60_000);
const prefs = (userId, sid) => env.DB.prepare('SELECT color, target, term, archived, deleted_at AS gone FROM space_prefs WHERE user_id = ? AND id = ?').bind(userId, sid).first();

describe('prefs written with a membership (spec §9, §11)', () => {
  it('give the owner of a blank class its colour and term', async () => {
    const res = await post(owner, '/api/spaces', { kind: 'class', course: { code: 'OS', name: 'Operating Systems', color: '#4FBF8B', term: 'Fall 2026', meetings: [] } });
    const { space } = await res.json();
    expect(await prefs(owner.id, space.id)).toEqual({ color: '#4FBF8B', target: null, term: 'Fall 2026', archived: 0, gone: null });
  });

  it("give someone accepting an invite the class's colour unless they use it, else the first free; a retried accept leaves them", async () => {
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    await env.DB.prepare("UPDATE courses SET term = 'Fall 2026' WHERE scope = ?").bind(s.scope).run();
    expect((await ana('/api/courses/mine', { method: 'PUT', body: { code: 'MY', name: 'Mine', color: '#17B3AE', meetings: [] } })).status).toBe(200);
    expect((await post(owner, `/api/spaces/${s.id}/invites`, { username: 'cl-ana' })).status).toBe(201);
    expect((await post(ana, `/api/invites/${s.id}/accept`)).status).toBe(200);
    expect(await prefs(ana.id, s.id)).toEqual({ color: '#E4749B', target: null, term: 'Fall 2026', archived: 0, gone: null });
    await env.DB.prepare("UPDATE space_prefs SET color = '#4F74D9' WHERE user_id = ? AND id = ?").bind(ana.id, s.id).run();
    expect((await post(ana, `/api/invites/${s.id}/accept`)).status).toBe(200);
    expect((await prefs(ana.id, s.id)).color).toBe('#4F74D9');
  });

  it("give someone joining by code the class's colour, and a left member fresh defaults on rejoining", async () => {
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    const { code } = await (await post(owner, `/api/spaces/${s.id}/code`)).json();
    expect((await post(ben, '/api/join', { code })).status).toBe(200);
    expect(await prefs(ben.id, s.id)).toMatchObject({ color: '#17B3AE', gone: null });
    /* left: Stage 5 deletes the prefs with the membership */
    await setMember(s.id, ben.id, null);
    await env.DB.prepare("UPDATE space_prefs SET color = '#B8457E', deleted_at = 7 WHERE user_id = ? AND id = ?").bind(ben.id, s.id).run();
    expect((await post(ben, '/api/join', { code })).status).toBe(200);
    expect(await prefs(ben.id, s.id)).toMatchObject({ color: '#17B3AE', gone: null });
  });
});
