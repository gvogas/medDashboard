import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { post, sharedItem, signInAdmin } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
async function team() {
  const tag = ++n, owner = await signInAdmin('plo' + tag), sam = await signInAdmin('pls' + tag), kim = await signInAdmin('plk' + tag);
  const { space } = await (await post(owner, '/api/spaces', { kind: 'project', title: 'Fire Response API', date: '2026-10-30' })).json();
  await env.DB.batch([sam, kim].map((m) => env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'editor', 1, 1)").bind(space.id, m.id)));
  await sharedItem(space.scope, 't1', { title: 'Endpoint', assignees: JSON.stringify([sam.id]), updated_by: owner.id });
  await sharedItem(space.scope, 't2', { title: 'Slides', assignees: JSON.stringify([sam.id, kim.id]), updated_by: owner.id });
  await env.DB.prepare("INSERT INTO marks (user_id, id, space_id, item_id, notes, created_at, updated_at) VALUES (?, ? || ':t1', ?, 't1', 'mine', 1, 1)").bind(sam.id, space.id, space.id).run();
  return { owner, sam, kim, space };
}
const assignees = async (scope, id) => JSON.parse((await one('SELECT assignees FROM items WHERE scope = ? AND id = ?', scope, id)).assignees);

describe('leaving or being removed from a project (spec §10, §13)', () => {
  it('strips you from every task, deletes your notes there, copies nothing', async () => {
    const { sam, kim, space } = await team();
    expect((await post(sam, `/api/spaces/${space.id}/leave`, { keepCopy: true })).status).toBe(204);
    expect(await assignees(space.scope, 't1')).toEqual([]);
    expect(await assignees(space.scope, 't2')).toEqual([kim.id]);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM marks WHERE user_id = ? AND space_id = ?', sam.id, space.id)).toEqual({ gone: 1 });
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM space_prefs WHERE user_id = ? AND id = ?', sam.id, space.id)).toBeNull();
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", sam.id)).toEqual({ n: 0 });
    const verbs = (await env.DB.prepare("SELECT verb, subject FROM activity WHERE space_id = ? AND verb IN ('task.unassigned', 'member.left') ORDER BY seq").bind(space.id).all()).results;
    expect(verbs).toEqual([{ verb: 'task.unassigned', subject: 't1' }, { verb: 'member.left', subject: '' }]);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM members WHERE space_id = ? AND user_id = ?', space.id, sam.id)).toEqual({ gone: 1 });
    expect((await post(sam, `/api/spaces/${space.id}/leave`, {})).status).toBe(404);
  });

  it('the owner removes a member the same way; the owner cannot leave', async () => {
    const { owner, kim, space } = await team();
    expect((await owner(`/api/spaces/${space.id}/members/${kim.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await assignees(space.scope, 't2')).toEqual([expect.stringMatching(/^u-pls/)]);
    expect(await one("SELECT subject_user FROM activity WHERE space_id = ? AND verb = 'member.removed'", space.id)).toEqual({ subject_user: kim.id });
    expect((await owner(`/api/spaces/${space.id}/members/${kim.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await owner(`/api/spaces/${space.id}/members/${owner.id}`, { method: 'DELETE' })).status).toBe(403);
    const res = await post(owner, `/api/spaces/${space.id}/leave`, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'owner' });
  });

  it('an editor cannot remove anyone', async () => {
    const { sam, kim, space } = await team();
    expect((await sam(`/api/spaces/${space.id}/members/${kim.id}`, { method: 'DELETE' })).status).toBe(403);
    expect(await assignees(space.scope, 't2')).toEqual([sam.id, kim.id]);
  });
});

describe('deleting a project (spec §13)', () => {
  it('needs the owner and the typed title; tells everyone; takes every layer and invite with it', async () => {
    const { owner, sam, kim, space } = await team();
    const del = (api, confirm) => api(`/api/spaces/${space.id}`, { method: 'DELETE', body: { confirm } });
    expect((await del(sam, 'Fire Response API')).status).toBe(403);
    expect(await (await del(owner, 'fire')).json()).toEqual({ error: 'invalid', field: 'confirm' });
    expect(await one('SELECT deleted_at FROM spaces WHERE id = ?', space.id)).toEqual({ deleted_at: null });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, role, created_at, expires_at) VALUES (?, ?, 'editor', 1, 2) ON CONFLICT DO NOTHING").bind(space.id, kim.id).run();
    expect((await del(owner, ' Fire Response API ')).status).toBe(204);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM spaces WHERE id = ?', space.id)).toEqual({ gone: 1 });
    expect(await one('SELECT count(*) AS n FROM marks WHERE space_id = ? AND deleted_at IS NULL', space.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE space_id = ? AND deleted_at IS NULL', space.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM invites WHERE space_id = ?', space.id)).toEqual({ n: 0 });
    const told = (await env.DB.prepare("SELECT subject_user, json_extract(detail, '$.space') AS space FROM activity WHERE space_id = ? AND verb = 'space.deleted' ORDER BY subject_user").bind(space.id).all()).results;
    expect(told).toEqual([{ subject_user: kim.id, space: 'Fire Response API' }, { subject_user: sam.id, space: 'Fire Response API' }]);
    const page = await (await sam(`/api/sync?v=3&cursors=${encodeURIComponent(`u:${sam.id}:0,${space.scope}:0`)}&sv=0`)).json();
    expect(page.revoked).toEqual([space.scope]);
    expect((await del(owner, 'Fire Response API')).status).toBe(404);
  });
});
