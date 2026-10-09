import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { achievement, makeSpace, mark, ownItem, post, session, sharedItem, signInAdmin } from './spaces.js';
import { keepItems } from '../worker/leaving.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const rows = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;
async function pair(role = 'member', archived = 0) {
  const tag = ++n, owner = await signInAdmin('kpo' + tag), member = await signInAdmin('kpm' + tag);
  const s = await makeSpace({ members: { [owner.id]: 'owner', [member.id]: role }, archived });
  return { owner, member, s };
}

describe('Keep as mine', () => {
  it('copies a removed item with your layer into your scope, filed under the class', async () => {
    const { owner, member, s } = await pair();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 3', weight: 15, deleted_at: 9, updated_by: owner.id });
    await mark(member.id, s.id, 'a1', { grade: 90, status: 'graded' });
    await session(member.id, 's1', { course_id: 'web', item_id: 'a1', space_id: s.id });
    await achievement(member.id, 'g1', { rule: 'grade', item_id: 'a1', space_id: s.id });
    const keep = () => post(member, `/api/spaces/${s.id}/items/a1/keep`);
    expect((await keep()).status).toBe(204);
    expect(await one("SELECT title, course_id, class_id, grade, status, weight FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id))
      .toEqual({ title: 'Lab 3', course_id: null, class_id: s.id, grade: 90, status: 'graded', weight: 15 });
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM marks WHERE user_id = ?', member.id)).toEqual({ gone: 1 });
    expect(await one('SELECT course_id, item_id, space_id FROM study_sessions WHERE user_id = ?', member.id)).toEqual({ course_id: null, item_id: 'a1', space_id: null });
    expect(await one('SELECT item_id, space_id FROM achievements WHERE user_id = ?', member.id)).toEqual({ item_id: 'a1', space_id: null });
    /* a retry: your mark is gone, so there is nothing of yours to keep */
    expect((await keep()).status).toBe(404);
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", member.id)).toEqual({ n: 1 });
  });

  it('takes a free id when one of yours is live, and a repeated batch copies nothing twice', async () => {
    const { member, s } = await pair();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 3', deleted_at: 9 });
    await sharedItem(s.scope, 'ka1', { course_id: 'web', title: 'Lab 3b', deleted_at: 9 });
    await ownItem(member.id, 'a1', { title: 'My own a1' });
    await mark(member.id, s.id, 'a1', { notes: 'Mine' });
    await mark(member.id, s.id, 'ka1', { grade: 70 });
    await session(member.id, 's1', { item_id: 'a1', space_id: s.id });
    await keepItems(env.DB, member.id, s.id, ['a1', 'ka1'], 50);
    expect(await rows("SELECT id, title, notes, grade, class_id FROM items WHERE scope = 'u:' || ? ORDER BY id", member.id)).toEqual([
      { id: 'a1', title: 'My own a1', notes: '', grade: null, class_id: null },
      { id: 'k1a1', title: 'Lab 3', notes: 'Mine', grade: null, class_id: s.id },
      { id: 'ka1', title: 'Lab 3b', notes: '', grade: 70, class_id: s.id },
    ]);
    expect(await one('SELECT item_id, space_id FROM study_sessions WHERE user_id = ?', member.id)).toEqual({ item_id: 'k1a1', space_id: null });
    await keepItems(env.DB, member.id, s.id, ['a1', 'ka1'], 60);
    expect(await one("SELECT count(*) AS n, max(updated_at) AS at FROM items WHERE scope = 'u:' || ?", member.id)).toEqual({ n: 3, at: 50 });
    expect(await one('SELECT item_id, updated_at FROM study_sessions WHERE user_id = ?', member.id)).toEqual({ item_id: 'k1a1', updated_at: 50 });
  });

  it('copies only items holding something of yours; the others keep their sessions and marks', async () => {
    const { member, s } = await pair();
    await sharedItem(s.scope, 'b1', { course_id: 'web', deleted_at: 9 });
    await mark(member.id, s.id, 'b1', { hidden: 1 });
    await session(member.id, 's1', { item_id: 'b1', space_id: s.id });
    await keepItems(env.DB, member.id, s.id, ['b1'], 50);
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", member.id)).toEqual({ n: 0 });
    expect(await one('SELECT item_id, space_id FROM study_sessions WHERE user_id = ?', member.id)).toEqual({ item_id: 'b1', space_id: s.id });
    expect(await one('SELECT deleted_at FROM marks WHERE user_id = ?', member.id)).toEqual({ deleted_at: null });
  });

  it('is refused on a live item, on one holding nothing of yours, and outside the class', async () => {
    const { owner, member, s } = await pair();
    await sharedItem(s.scope, 'live', { course_id: 'web' });
    await sharedItem(s.scope, 'bare', { course_id: 'web', deleted_at: 9 });
    await mark(member.id, s.id, 'live', { grade: 50 });
    await mark(member.id, s.id, 'bare', { hidden: 1 });
    expect((await post(member, `/api/spaces/${s.id}/items/live/keep`)).status).toBe(404);
    expect((await post(member, `/api/spaces/${s.id}/items/bare/keep`)).status).toBe(404);
    expect((await post(member, `/api/spaces/${s.id}/items/none/keep`)).status).toBe(404);
    const outsider = await signInAdmin('kpx' + ++n);
    expect((await post(outsider, `/api/spaces/${s.id}/items/bare/keep`)).status).toBe(404);
    expect((await post(owner, `/api/spaces/${s.id}/items/bare/keep`)).status).toBe(404);
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", member.id)).toEqual({ n: 0 });
  });

  it('works in an archived class', async () => {
    const { member, s } = await pair('member', 1);
    await sharedItem(s.scope, 'a1', { course_id: 'web', deleted_at: 9 });
    await mark(member.id, s.id, 'a1', { status: 'done' });
    expect((await post(member, `/api/spaces/${s.id}/items/a1/keep`)).status).toBe(204);
    expect(await one("SELECT status, class_id FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id)).toEqual({ status: 'done', class_id: s.id });
  });
});

describe('sharing one item with the class', () => {
  it('makes an item filed under the class a class item, your layer moving to a mark', async () => {
    const { owner, s } = await pair();
    await ownItem(owner.id, 'p1', { class_id: s.id, title: 'Reading 4', status: 'done', notes: 'Chapter 4 only', weight: 5 });
    await session(owner.id, 's1', { item_id: 'p1' });
    await achievement(owner.id, 'g1', { rule: 'grade', item_id: 'p1' });
    const res = await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['p1'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shared: 1 });
    expect(await one('SELECT title, course_id, status, notes, weight, updated_by FROM items WHERE scope = ? AND id = ?', s.scope, 'p1'))
      .toEqual({ title: 'Reading 4', course_id: 'web', status: 'todo', notes: '', weight: 5, updated_by: owner.id });
    expect(await one('SELECT status, notes FROM marks WHERE user_id = ? AND id = ?', owner.id, s.id + ':p1')).toEqual({ status: 'done', notes: 'Chapter 4 only' });
    expect(await one("SELECT deleted_at IS NOT NULL AS gone FROM items WHERE scope = 'u:' || ? AND id = 'p1'", owner.id)).toEqual({ gone: 1 });
    expect(await one('SELECT course_id, space_id FROM study_sessions WHERE user_id = ?', owner.id)).toEqual({ course_id: 'web', space_id: s.id });
    expect(await one('SELECT space_id FROM achievements WHERE user_id = ?', owner.id)).toEqual({ space_id: s.id });
    /* a retry: the item is no longer yours to share */
    expect((await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['p1'] })).status).toBe(400);
  });

  it('lets an editor share, makes no mark for an item holding nothing, and revives a class tombstone', async () => {
    const { member: editor, s } = await pair('editor');
    await sharedItem(s.scope, 'p2', { course_id: 'web', title: 'Old', deleted_at: 9 });
    await ownItem(editor.id, 'p2', { class_id: s.id, title: 'New reading' });
    expect(await (await post(editor, `/api/spaces/${s.id}/absorb`, { items: ['p2'] })).json()).toEqual({ shared: 1 });
    expect(await one('SELECT title, deleted_at FROM items WHERE scope = ? AND id = ?', s.scope, 'p2')).toEqual({ title: 'New reading', deleted_at: null });
    expect(await one('SELECT count(*) AS n FROM marks WHERE user_id = ?', editor.id)).toEqual({ n: 0 });
  });

  it('refuses members, custom types, lecture reviews, items not filed under it, and an id the class has', async () => {
    const { owner, member, s } = await pair();
    await ownItem(member.id, 'm1', { class_id: s.id });
    expect((await post(member, `/api/spaces/${s.id}/absorb`, { items: ['m1'] })).status).toBe(403);
    await ownItem(owner.id, 'c1', { class_id: s.id, type: 'c-essay' });
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['c1'] })).json()).toEqual({ error: 'invalid', field: 'type' });
    await ownItem(owner.id, 'rvabcdefg1', { class_id: s.id, type: 'task' });
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['rvabcdefg1'] })).json()).toEqual({ error: 'invalid', field: 'items' });
    await ownItem(owner.id, 'loose');
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['loose'] })).json()).toEqual({ error: 'invalid', field: 'items' });
    await ownItem(owner.id, 'dup', { class_id: s.id });
    await sharedItem(s.scope, 'dup', { course_id: 'web' });
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['dup'] })).json()).toEqual({ error: 'exists' });
    for (const items of [[], 'dup', ['dup', 'dup'], [7]]) {
      expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items })).json()).toEqual({ error: 'invalid', field: 'items' });
    }
    const outsider = await signInAdmin('kpx' + ++n);
    expect((await post(outsider, `/api/spaces/${s.id}/absorb`, { items: ['loose'] })).status).toBe(404);
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ? AND deleted_at IS NOT NULL", owner.id)).toEqual({ n: 0 });
  });

  it('is refused in an archived class', async () => {
    const { owner, s } = await pair('member', 1);
    await ownItem(owner.id, 'p1', { class_id: s.id });
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['p1'] })).json()).toEqual({ error: 'archived' });
  });
});
