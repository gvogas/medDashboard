import { describe, expect, it } from 'vitest';
import { post, signInAdmin } from './spaces.js';

let n = 0;
const task = (api, sid, id, body, rev = 0) => api(`/api/spaces/${sid}/items/${id}`, { method: 'PUT', headers: { 'if-match': `"${rev}"` },
  body: { type: 'task', title: id, date: '2026-10-20', status: 'todo', assignees: [], ...body } });
const inbox = async (api) => (await (await api('/api/inbox')).json()).items.map((r) => [r.verb, r.about, r.detail.title ?? r.space]);
async function team() {
  const tag = ++n, gabriel = await signInAdmin('pig' + tag), alex = await signInAdmin('pia' + tag), sam = await signInAdmin('pis' + tag);
  const { space } = await (await post(gabriel, '/api/spaces', { kind: 'project', title: 'Fire Response API', date: '2026-10-30' })).json();
  for (const m of [alex, sam]) {
    await post(gabriel, `/api/spaces/${space.id}/invites`, { username: m === alex ? 'pia' + tag : 'pis' + tag });
    await post(m, `/api/invites/${space.id}/accept`);
  }
  return { gabriel, alex, sam, space };
}

describe("a project's events in the inbox (spec §12, §21)", () => {
  it('tells an assignee, tells everyone of a task for everyone, and tells the assignees of its completion', async () => {
    const { gabriel, alex, sam, space } = await team();
    await task(gabriel, space.id, 'endpoint', { title: 'Create incidents endpoint', assignees: [alex.id] });
    const all = await (await task(gabriel, space.id, 'slides', { title: 'Slides', assignees: ['*'] })).json();
    expect(await inbox(alex)).toEqual(expect.arrayContaining([['task.assigned', true, 'Create incidents endpoint'], ['task.assigned', false, 'Slides']]));
    expect(await inbox(sam)).not.toContainEqual(['task.assigned', false, 'Create incidents endpoint']);
    await task(sam, space.id, 'slides', { ...all, status: 'done', completedAt: Date.now(), changed: { status: 'todo', completedAt: null } }, all.revision);
    expect(await inbox(alex)).toContainEqual(['task.status', false, 'Slides']);
  });

  it('tells you that you were removed, even though you left the project (§21 step 26)', async () => {
    const { gabriel, alex, space } = await team();
    await gabriel(`/api/spaces/${space.id}/members/${alex.id}`, { method: 'DELETE' });
    expect(await inbox(alex)).toContainEqual(['member.removed', true, 'Fire Response API']);
  });

  it('tells every other member that the project was deleted', async () => {
    const { gabriel, alex, sam, space } = await team();
    await gabriel(`/api/spaces/${space.id}`, { method: 'DELETE', body: { confirm: 'Fire Response API' } });
    for (const m of [alex, sam]) expect(await inbox(m)).toContainEqual(['space.deleted', true, 'Fire Response API']);
    expect(await inbox(gabriel)).not.toContainEqual(['space.deleted', true, 'Fire Response API']);
  });

  it('counts the assignment in the unread number on the next sync', async () => {
    const { gabriel, alex, space } = await team();
    await task(gabriel, space.id, 'docs', { title: 'Write docs', assignees: [alex.id] });
    const page = await (await alex(`/api/sync?v=3&cursors=${encodeURIComponent('u:' + alex.id + ':0')}&sv=0`)).json();
    expect(page.unread).toBeGreaterThanOrEqual(1);
  });
});
