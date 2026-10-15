import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, signInAdmin } from './spaces.js';

let n = 0;
const verbs = async (spaceId) => (await env.DB.prepare(`SELECT actor_id, verb, subject_user, old_value, new_value, json_extract(detail, '$.space') AS space
  FROM activity WHERE space_id = ? AND verb GLOB 'member.*' OR (space_id = ? AND verb GLOB 'space.*') ORDER BY seq`).bind(spaceId, spaceId).all()).results;
async function people() {
  const tag = ++n;
  const make = async (p) => { const api = await signIn(p + tag); api.id = 'u-' + p + tag; return api; };
  return { owner: await make('aro'), ed: await make('are'), guest: await make('arg') };
}

describe('member and space activity (spec §12)', () => {
  it('records a join by invite once, however often accept is retried', async () => {
    const { owner, guest } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?)")
      .bind(s.id, guest.id, owner.id, Date.now(), Date.now() + 86_400_000).run();
    await post(guest, `/api/invites/${s.id}/accept`);
    await post(guest, `/api/invites/${s.id}/accept`);
    expect(await verbs(s.id)).toEqual([{ actor_id: guest.id, verb: 'member.joined', subject_user: '', old_value: null, new_value: null, space: 'Web Services' }]);
  });

  it('records a join by code once', async () => {
    const { owner, guest } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    const { code } = await (await post(owner, `/api/spaces/${s.id}/code`)).json();
    expect((await post(guest, '/api/join', { code })).status).toBe(200);
    expect((await post(guest, '/api/join', { code })).status).toBe(200);
    expect((await verbs(s.id)).map((r) => [r.actor_id, r.verb])).toEqual([[guest.id, 'member.joined']]);
  });

  it('records a role change and a transfer about the person they concern', async () => {
    const { owner, ed } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner', [ed.id]: 'member' } });
    await owner(`/api/spaces/${s.id}/members/${ed.id}`, { method: 'PUT', body: { role: 'editor' } });
    await owner(`/api/spaces/${s.id}/members/${ed.id}`, { method: 'PUT', body: { role: 'editor' } });
    await post(owner, `/api/spaces/${s.id}/transfer`, { userId: ed.id });
    expect((await verbs(s.id)).map((r) => [r.verb, r.subject_user, r.old_value, r.new_value])).toEqual([
      ['member.role', ed.id, 'member', 'editor'], ['space.transferred', ed.id, null, null],
    ]);
  });

  it('records leaving, a removal (about the removed person) and archiving', async () => {
    const { owner, ed, guest } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner', [ed.id]: 'member', [guest.id]: 'member' } });
    await post(ed, `/api/spaces/${s.id}/leave`, { keepCopy: false });
    await post(ed, `/api/spaces/${s.id}/leave`, { keepCopy: false });
    await owner(`/api/spaces/${s.id}/members/${guest.id}`, { method: 'DELETE' });
    await owner(`/api/spaces/${s.id}/members/${guest.id}`, { method: 'DELETE' });
    await post(owner, `/api/spaces/${s.id}/archive`, { archived: true });
    await post(owner, `/api/spaces/${s.id}/archive`, { archived: true });
    expect((await verbs(s.id)).map((r) => [r.actor_id, r.verb, r.subject_user, r.new_value])).toEqual([
      [ed.id, 'member.left', '', null], [owner.id, 'member.removed', guest.id, null], [owner.id, 'space.archived', '', '1'],
    ]);
  });

  it('records the hand-on when an owner account is deleted, about the heir, with the old owner as actor', async () => {
    const admin = await signInAdmin('ar-admin');
    const { owner, ed, guest } = await people();
    const kept = await makeSpace({ members: { [owner.id]: 'owner', [ed.id]: 'editor', [guest.id]: 'member' } });
    const alone = await makeSpace({ members: { [owner.id]: 'owner' } });
    const only = await makeSpace({ members: { [ed.id]: 'owner', [owner.id]: 'member' } });
    const name = owner.id.slice(2);
    expect((await admin(`/api/admin/accounts/${owner.id}`, { method: 'DELETE', body: { confirm: name } })).status).toBe(204);
    const rows = await env.DB.prepare(`SELECT actor_id, subject_user, json_extract(detail, '$.by') AS by, json_extract(detail, '$.space') AS space
      FROM activity WHERE space_id = ? AND verb = 'space.transferred'`).bind(kept.id).all();
    expect(rows.results).toEqual([{ actor_id: owner.id, subject_user: ed.id, by: name, space: 'Web Services' }]);
    for (const s of [alone, only]) expect(await verbs(s.id)).toEqual([]);
  });
});
