import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, setMember, sharedItem } from './spaces.js';
import { personal, readMemberships, readPage, syncPageV3, upsertRow } from '../worker/db.js';

const course = { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] };
async function pageAll(userId, cursors, sv, limit) {
  const pages = [];
  for (let more = true; more;) {
    const page = await syncPageV3(env.DB, userId, Object.entries(cursors), sv, limit);
    pages.push(page);
    ({ cursors, more } = page);
  }
  return pages;
}

describe('sync v3', () => {
  it("pages the person's own scope and their spaces in one sequence order, a few rows at a time", async () => {
    const ana = await createUser('v3-order'), gabriel = await createUser('v3-order-g');
    const web = await makeSpace({ members: { [gabriel]: 'owner', [ana]: 'member' } });   /* its course is the first change */
    await upsertRow(env.DB, 'courses', ana, 'bio', course);
    await sharedItem(web.scope, 'a1', { course_id: 'web' });
    await upsertRow(env.DB, 'quotes', ana, 'q', { text: 'Go', source: '' });
    await sharedItem(web.scope, 'a2', { course_id: 'web' });
    const pages = await pageAll(ana, {}, 0, 2);
    expect(pages.flatMap((p) => p.changes.map((c) => `${c.scope === web.scope ? 'web' : 'own'}:${c.kind}:${c.row.id}`)))
      .toEqual(['web:courses:web', 'own:courses:bio', 'web:items:a1', 'own:quotes:q', 'web:items:a2']);
    expect(pages.map((p) => p.more)).toEqual([true, true, false]);
    expect(Object.keys(pages.at(-1).cursors).sort()).toEqual([personal(ana), web.scope].sort());
    expect(pages[0].changes[0].row).toMatchObject({ scope: web.scope, code: 'WEB', updatedBy: null });
    expect(pages[1].changes[0].row).toMatchObject({ scope: web.scope, courseId: 'web', assignees: [], completedBy: null });
    expect(pages[0].scopes).toMatchObject([{ id: web.id, scope: web.scope, kind: 'class', role: 'member', name: 'Web Services' }]);
  });

  it('loads a space the client did not send from 0, and sends back the scopes it may not read', async () => {
    const ana = await createUser('v3-new'), owner = await createUser('v3-new-o');
    const old = await makeSpace({ members: { [owner]: 'owner' } });
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    const head = (await syncPageV3(env.DB, ana, [], 0)).cursors[personal(ana)];
    const page = await syncPageV3(env.DB, ana, [[personal(ana), head], [old.scope, 3], ['u:u-someone', 2]], 0);
    expect(page.revoked).toEqual([old.scope, 'u:u-someone']);
    expect(page.reset).toEqual([]);
    expect(page.changes.map((c) => `${c.scope}:${c.row.id}`)).toEqual([`${web.scope}:web`]);
  });

  it('sends member lists only for spaces above sv, and all of them when sv is 0', async () => {
    const ana = await createUser('v3-sv', 'Ana'), ben = await createUser('v3-sv-b');
    const web = await makeSpace({ members: { [ana]: 'owner', [ben]: 'member' } });
    const [first] = await readMemberships(env.DB, ana, 0);
    expect(first).toMatchObject({ id: web.id, scope: web.scope, kind: 'class', role: 'owner', archived: false, name: 'Web Services', parent: null });
    expect(first.members).toEqual([{ userId: ana, name: 'Ana', role: 'owner' }, { userId: ben, name: 'v3-sv-b', role: 'member' }]);
    const [held] = await readMemberships(env.DB, ana, first.revision);
    expect(held).not.toHaveProperty('members');
    await setMember(web.id, ben, 'editor');
    const [moved] = await readMemberships(env.DB, ana, first.revision);
    expect(moved.members.map((m) => m.role)).toEqual(['owner', 'editor']);
  });

  it('pages nothing from a space the person left between reading their spaces and reading the page', async () => {
    const ana = await createUser('v3-race'), owner = await createUser('v3-race-o');
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    expect((await readMemberships(env.DB, ana, 0)).map((s) => s.scope)).toEqual([web.scope]);
    await setMember(web.id, ana, null);
    const { rows } = await readPage(env.DB, ana, [[personal(ana), 0], [web.scope, 0]]);
    expect(rows.filter((r) => r.scope === web.scope)).toEqual([]);
    expect((await syncPageV3(env.DB, ana, [[web.scope, 0]], 0)).revoked).toEqual([web.scope]);
  });

  it('resets only a scope whose cursor fell below the floor; cursor 0 never resets', async () => {
    const ana = await createUser('v3-reset'), owner = await createUser('v3-reset-o');
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    await upsertRow(env.DB, 'quotes', ana, 'q', { text: 'Go', source: '' });
    const head = (await syncPageV3(env.DB, ana, [], 0)).cursors[personal(ana)];
    await env.DB.prepare('UPDATE sync_state SET floor = ? WHERE id = 1').bind(head).run();
    try {
      const page = await syncPageV3(env.DB, ana, [[personal(ana), head], [web.scope, 1]], 0);
      expect(page).toMatchObject({ reset: [web.scope], more: true, changes: [] });
      expect(page.cursors[web.scope]).toBe(0);
      const again = await syncPageV3(env.DB, ana, Object.entries(page.cursors), 0);
      expect(again.reset).toEqual([]);
      expect(again.changes.map((c) => c.row.id)).toEqual(['web']);
    } finally {
      await env.DB.prepare('UPDATE sync_state SET floor = 0 WHERE id = 1').run();
    }
  });

  it('finishes a resync from 0 that pages below the floor, rather than resetting it forever', async () => {
    const ana = await createUser('v3-resync'), owner = await createUser('v3-resync-o');
    for (const id of ['q1', 'q2', 'q3']) await upsertRow(env.DB, 'quotes', ana, id, { text: id, source: '' });
    const floor = (await syncPageV3(env.DB, ana, [], 0)).cursors[personal(ana)];
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });   /* its rows lie above the floor */
    await env.DB.prepare('UPDATE sync_state SET floor = ? WHERE id = 1').bind(floor).run();
    try {
      let cursors = {}, more = true;
      const pages = [];
      for (let n = 0; more && n < 10; n++) {
        const page = await syncPageV3(env.DB, ana, Object.entries(cursors), 0, 1);
        pages.push(page);
        ({ cursors, more } = page);
      }
      expect(more).toBe(false);
      expect(pages.flatMap((p) => p.reset)).toEqual([]);
      expect(pages.flatMap((p) => p.changes.map((c) => c.row.id))).toEqual(['q1', 'q2', 'q3', 'web']);
      /* below the floor, the cursor says it is a resync begun at this floor */
      expect(pages[0].cursors[personal(ana)]).toMatch(new RegExp(`^r\\d+\\.${floor}$`));
      /* the space paged nothing yet, but its cursor waits just below its first row, above the floor */
      expect(pages[0].cursors[web.scope]).toBeGreaterThanOrEqual(floor);
      expect(Object.values(cursors).every((c) => typeof c === 'number' && c >= floor)).toBe(true);
    } finally {
      await env.DB.prepare('UPDATE sync_state SET floor = 0 WHERE id = 1').run();
    }
  });

  it('resets a resync begun at an older floor, and an untagged cursor below the floor', async () => {
    const ana = await createUser('v3-resync-old');
    for (const id of ['q1', 'q2']) await upsertRow(env.DB, 'quotes', ana, id, { text: id, source: '' });
    const head = (await syncPageV3(env.DB, ana, [], 0)).cursors[personal(ana)];
    await env.DB.prepare('UPDATE sync_state SET floor = ? WHERE id = 1').bind(head).run();
    try {
      const first = await syncPageV3(env.DB, ana, [], 0, 1);
      const token = first.cursors[personal(ana)];
      expect(token).toMatch(/^r\d+\.\d+$/);
      expect((await syncPageV3(env.DB, ana, [[personal(ana), token]], 0, 1)).reset).toEqual([]);
      const seq = Number(token.slice(1).split('.')[0]);
      expect((await syncPageV3(env.DB, ana, [[personal(ana), seq]], 0, 1)).reset).toEqual([personal(ana)]);
      await env.DB.prepare('UPDATE sync_state SET floor = ? WHERE id = 1').bind(head + 1).run();   /* a purge since the resync began */
      expect((await syncPageV3(env.DB, ana, [[personal(ana), token]], 0, 1)).reset).toEqual([personal(ana)]);
    } finally {
      await env.DB.prepare('UPDATE sync_state SET floor = 0 WHERE id = 1').run();
    }
  });

  it('answers GET /api/sync?v=3, refuses malformed cursors, and keeps v2 as it was', async () => {
    const api = await signIn('v3-route');
    const ok = await (await api('/api/sync?v=3&cursors=' + encodeURIComponent('u:u-v3-route:0,c:abcdefghij12:4') + '&sv=0')).json();
    expect(ok).toMatchObject({ scopes: [], more: false, reset: [], revoked: ['c:abcdefghij12'] });
    expect(Object.keys(ok.cursors)).toEqual(['u:u-v3-route']);
    const tagged = await api('/api/sync?v=3&cursors=' + encodeURIComponent('u:u-v3-route:r0.0'));
    expect(tagged.status).toBe(200);
    for (const bad of ['u:u-v3-route', 'x:1:2', 'c:abcdefghij12:-1', 'u:a:1,u:a:2', 'u:a:r1', 'u:a:r.1', 'u:a:r1.', 'u:a:R1.2', 'u:a:r1.2.3', Array.from({ length: 26 }, (_, i) => `u:x${i}:1`).join(',')]) {
      expect((await api('/api/sync?v=3&cursors=' + encodeURIComponent(bad))).status).toBe(400);
    }
    expect((await api('/api/sync?v=3&sv=x')).status).toBe(400);
    expect(await (await api('/api/sync?v=2&cursor=0')).json()).toMatchObject({ reset: false, more: false, changes: [] });
  });
});
