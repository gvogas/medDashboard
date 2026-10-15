import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, sharedItem } from './spaces.js';
import { unreadCount } from '../worker/activity.js';

let n = 0;
const at = (ms) => ({ updated_at: ms, created_at: ms });
async function team() {
  const tag = ++n, alex = await signIn('ina' + tag), sam = await signIn('ins' + tag), out = await signIn('ino' + tag);
  alex.id = 'u-ina' + tag; sam.id = 'u-ins' + tag; out.id = 'u-ino' + tag;
  const s = await makeSpace({ members: { [alex.id]: 'owner', [sam.id]: 'member' } });
  return { alex, sam, out, s };
}
const inbox = async (api) => (await api('/api/inbox')).json();

describe('GET /api/inbox (spec §12)', () => {
  it("holds others' news in your spaces since you joined, never your own", async () => {
    const { alex, sam, s } = await team();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 1', updated_by: alex.id, ...at(Date.now()) });
    await sharedItem(s.scope, 'a2', { course_id: 'web', title: 'Lab 2', updated_by: sam.id, ...at(Date.now() + 700_000) });
    const box = await inbox(sam);
    expect(box.items.map((r) => [r.verb, r.detail.titles])).toEqual([['item.created', ['Lab 1']]]);
    expect(box.items[0]).toMatchObject({ spaceId: s.id, space: 'Web Services', kind: 'class', actor: alex.id, about: false });
    expect(box.invites).toEqual([]);
    expect(box.seen).toBe(0);
  });

  it('leaves out activity from before you joined and verbs that do not concern you', async () => {
    const { alex, sam, s } = await team();
    await env.DB.prepare('UPDATE members SET joined_at = ? WHERE space_id = ? AND user_id = ?').bind(Date.now(), s.id, sam.id).run();
    /* 20 minutes back: another bucket, so it cannot coalesce with the creation below */
    await sharedItem(s.scope, 'old', { course_id: 'web', updated_by: alex.id, ...at(Date.now() - 1_200_000) });
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Quiz', weight: 5, updated_by: alex.id, ...at(Date.now() + 1000) });
    await env.DB.prepare('UPDATE items SET weight = 7, updated_by = ?, updated_at = ? WHERE scope = ? AND id = ?').bind(alex.id, Date.now() + 2000, s.scope, 'a1').run();
    expect((await inbox(sam)).items.map((r) => r.verb)).toEqual(['item.created']);
  });

  it('keeps rows about you after you left, and nothing else from that space', async () => {
    const { alex, sam, s } = await team();
    await env.DB.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject_user, detail, bucket, at)
      VALUES (?, ?, 'member.removed', ?, '{"space":"Web Services","by":"Alex"}', 1, ?)`).bind(s.id, alex.id, sam.id, Date.now()).run();
    await env.DB.prepare('UPDATE members SET deleted_at = 5 WHERE space_id = ? AND user_id = ?').bind(s.id, sam.id).run();
    await sharedItem(s.scope, 'a3', { course_id: 'web', updated_by: alex.id, ...at(Date.now() + 1000) });
    const box = await inbox(sam);
    expect(box.items.map((r) => [r.verb, r.about, r.space])).toEqual([['member.removed', true, 'Web Services']]);
  });

  it('lists your pending invites', async () => {
    const { alex, out, s } = await team();
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?)")
      .bind(s.id, out.id, alex.id, Date.now(), Date.now() + 86_400_000).run();
    expect((await inbox(out)).invites).toEqual([expect.objectContaining({ spaceId: s.id, name: 'Web Services', expired: false })]);
  });
});

describe('unreadCount (Decision 5)', () => {
  it('counts pending unexpired invites and inbox rows above what you read', async () => {
    const { alex, sam, out, s } = await team();
    await sharedItem(s.scope, 'u1', { course_id: 'web', updated_by: alex.id, ...at(Date.now()) });
    await sharedItem(s.scope, 'u2', { course_id: 'web', updated_by: alex.id, ...at(Date.now() + 700_000) });
    expect(await unreadCount(env.DB, sam.id)).toBe(2);
    const top = (await inbox(sam)).items[0].seq;
    await sam('/api/inbox/seen', { method: 'PUT', body: { seq: top } });
    expect(await unreadCount(env.DB, sam.id)).toBe(0);
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?)")
      .bind(s.id, out.id, alex.id, Date.now(), Date.now() + 86_400_000).run();
    expect(await unreadCount(env.DB, out.id)).toBe(1);
    expect(await unreadCount(env.DB, out.id, Date.now() + 2 * 86_400_000)).toBe(0);
  });
});

describe('PUT /api/inbox/seen', () => {
  it('moves forward only, never past the newest row', async () => {
    const { alex, sam, s } = await team();
    await sharedItem(s.scope, 'a1', { course_id: 'web', updated_by: alex.id, ...at(Date.now()) });
    const top = (await inbox(sam)).items[0].seq;
    const put = (seq) => sam('/api/inbox/seen', { method: 'PUT', body: { seq } });
    expect((await put(top + 1000)).status).toBe(204);
    expect((await inbox(sam)).seen).toBe(top);
    await put(0);
    expect((await inbox(sam)).seen).toBe(top);
    expect((await put(-1)).status).toBe(400);
    expect((await put('x')).status).toBe(400);
  });
});

describe('GET /api/spaces/:sid/activity', () => {
  it("shows a member the space's whole history, newest first, a page at a time; 404 outside it", async () => {
    const { alex, sam, out, s } = await team();
    for (let i = 0; i < 32; i++) await sharedItem(s.scope, 'b' + i, { course_id: 'web', updated_by: alex.id, ...at(Date.now() + i * 700_000) });
    const first = await (await sam(`/api/spaces/${s.id}/activity`)).json();
    expect(first.items).toHaveLength(30);
    expect(first.more).toBe(true);
    const rest = await (await sam(`/api/spaces/${s.id}/activity?before=${first.items[29].seq}`)).json();
    expect(rest.items).toHaveLength(2);
    expect(rest.more).toBe(false);
    expect((await out(`/api/spaces/${s.id}/activity`)).status).toBe(404);
    expect((await sam(`/api/spaces/${s.id}/activity?before=x`)).status).toBe(400);
  });
});
