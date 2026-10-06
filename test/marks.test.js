import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, sharedItem } from './spaces.js';

let me, other, outsider, s, p, a;
beforeAll(async () => {
  me = await signIn('mk-me'); other = await signIn('mk-other'); outsider = await signIn('mk-out');
  s = await makeSpace({ members: { 'u-mk-me': 'member', 'u-mk-other': 'owner' } });
  a = await makeSpace({ members: { 'u-mk-me': 'member' }, archived: 1 });
  p = await makeSpace({ kind: 'project', members: { 'u-mk-me': 'editor' } });
  await sharedItem(s.scope, 'a1', { course_id: 'web', weight: 20 });
  await sharedItem(s.scope, 'gone', { course_id: 'web', deleted_at: 5 });
  await sharedItem(a.scope, 'a1', { course_id: 'web' });
  await sharedItem(p.scope, 't1');
}, 60_000);

const at = (rev) => ({ 'if-match': `"${rev}"` });
const put = (api, sid, item, body, rev = 0) => api(`/api/marks/${sid}/${item}`, { method: 'PUT', body, headers: at(rev) });
const blank = { status: 'todo', grade: null, weight: null, notes: '', checklist: [], completedAt: null, hidden: false };

describe('your mark on a shared item', () => {
  it('is written by a member on a live item, kept as yours, and read back', async () => {
    const res = await put(me, s.id, 'a1', { ...blank, status: 'graded', grade: 87, notes: 'Teams of 3' });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ id: s.id + ':a1', spaceId: s.id, itemId: 'a1', status: 'graded', grade: 87, notes: 'Teams of 3', hidden: false });
    expect(await (await me(`/api/marks/${s.id}/a1`)).json()).toMatchObject({ grade: 87 });
    expect((await other(`/api/marks/${s.id}/a1`)).status).toBe(404);
  });

  it('is refused outside the space, on a deleted or missing item, and malformed', async () => {
    expect((await put(outsider, s.id, 'a1', blank)).status).toBe(404);
    expect((await put(me, s.id, 'gone', blank)).status).toBe(404);
    expect((await put(me, s.id, 'nope', blank)).status).toBe(404);
    expect(await (await put(me, s.id, 'a1', { ...blank, grade: 120 })).json()).toEqual({ error: 'invalid', field: 'grade' });
    expect(await (await put(me, s.id, 'a1', { ...blank, status: 'started' })).json()).toEqual({ error: 'invalid', field: 'status' });
  });

  it('still saves in an archived class; on a project item only your notes and hidden', async () => {
    expect((await put(me, a.id, 'a1', { ...blank, status: 'done' })).status).toBe(200);
    expect(await (await put(me, p.id, 't1', { ...blank, status: 'done' })).json()).toEqual({ error: 'invalid', field: 'status' });
    expect((await put(me, p.id, 't1', { ...blank, notes: 'Ask Sam', hidden: true })).status).toBe(200);
  });

  it("merges two devices' first marks on one item field by field; the same field differing conflicts", async () => {
    await sharedItem(s.scope, 'b1', { course_id: 'web' });
    const first = await (await put(me, s.id, 'b1', { ...blank, notes: 'from the phone' })).json();
    const second = await put(me, s.id, 'b1', { ...blank, status: 'done', completedAt: 5, changed: { status: null, completedAt: null } });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ notes: 'from the phone', status: 'done', completedAt: 5, revision: first.revision + 1 });
    const clash = await put(me, s.id, 'b1', { ...blank, notes: 'from the laptop', changed: { notes: null } });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: 'conflict', fields: ['notes'], current: { notes: 'from the phone' } });
  });

  it('writes the whole mark at its revision, and merges a stale edit onto the newer one', async () => {
    await sharedItem(s.scope, 'c1', { course_id: 'web' });
    const v1 = await (await put(me, s.id, 'c1', { ...blank, grade: 70, status: 'graded' })).json();
    const v2 = await (await put(me, s.id, 'c1', { ...v1, weight: 30 }, v1.revision)).json();
    const merged = await put(me, s.id, 'c1', { ...v1, notes: 'retake', changed: { notes: '' } }, v1.revision);
    expect(await merged.json()).toMatchObject({ weight: 30, notes: 'retake', grade: 70, revision: v2.revision + 1 });
    expect((await put(me, s.id, 'c1', { ...v1, grade: 10 }, v1.revision)).status).toBe(409);
    expect((await me(`/api/marks/${s.id}/c1`, { method: 'DELETE', headers: at(v2.revision + 1) })).status).toBe(204);
    expect((await me(`/api/marks/${s.id}/c1`)).status).toBe(404);
  });

  it('revives a mark you deleted when a device writes it fresh at revision 0', async () => {
    await sharedItem(s.scope, 'd1', { course_id: 'web' });
    const v1 = await (await put(me, s.id, 'd1', { ...blank, notes: 'first' })).json();
    expect((await me(`/api/marks/${s.id}/d1`, { method: 'DELETE', headers: at(v1.revision) })).status).toBe(204);
    const res = await put(me, s.id, 'd1', { ...blank, status: 'done', grade: 91, changed: { status: null, grade: null } });
    expect(res.status).toBe(200);
    const revived = await res.json();
    expect(revived).toMatchObject({ status: 'done', grade: 91, notes: '', deletedAt: null });
    expect(revived.revision).toBeGreaterThan(v1.revision);
    expect(await (await me(`/api/marks/${s.id}/d1`)).json()).toMatchObject({ status: 'done', grade: 91 });
    /* the guard still holds: a deleted item's mark is not revived */
    expect((await put(me, s.id, 'gone', { ...blank, notes: 'x' })).status).toBe(404);
  });
});

describe('your prefs for a space', () => {
  const pref = { color: '#4F74D9', target: 85, term: 'Fall 2026', archived: false };
  it('are written whole by a member at a revision, and refused to anyone else', async () => {
    expect((await outsider(`/api/space_prefs/${s.id}`, { method: 'PUT', body: pref, headers: at(0) })).status).toBe(404);
    const v1 = await (await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: pref, headers: at(0) })).json();
    expect(v1).toMatchObject({ id: s.id, spaceId: s.id, color: '#4F74D9', target: 85, term: 'Fall 2026', archived: false });
    expect((await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: { ...pref, archived: true }, headers: at(0) })).status).toBe(409);
    const v2 = await (await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: { ...pref, archived: true }, headers: at(v1.revision) })).json();
    expect(v2.archived).toBe(true);
    expect(await (await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: { ...pref, color: '#000000' }, headers: at(v2.revision) })).json()).toEqual({ error: 'invalid', field: 'color' });
    expect(await (await me(`/api/space_prefs/${s.id}`)).json()).toMatchObject({ archived: true });
  });
});

describe('sync', () => {
  it("pages your marks and prefs in your own scope, and never another member's", async () => {
    const mine = await (await me('/api/sync?v=3&cursors=')).json();
    expect(mine.changes.filter((c) => c.scope === 'u:u-mk-me' && c.kind === 'marks').map((c) => c.row.id)).toContain(s.id + ':a1');
    expect(mine.changes.find((c) => c.kind === 'marks' && c.row.id === s.id + ':a1').row).toMatchObject({ grade: 87, hidden: false, checklist: [] });
    expect(mine.changes.some((c) => c.kind === 'space_prefs' && c.row.id === s.id)).toBe(true);
    const theirs = await (await other('/api/sync?v=3&cursors=')).json();
    expect(theirs.changes.some((c) => c.kind === 'marks' || c.kind === 'space_prefs')).toBe(false);
  });
});
