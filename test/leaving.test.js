import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { achievement, makeSpace, mark, ownItem, post, pref, session, setMember, sharedItem, signInAdmin, spaceRevision } from './spaces.js';
import { copyIds, detach } from '../worker/leaving.js';

let n = 0;
const rows = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();

/* A class with an owner and a member and three items; the member's layer on it. */
async function classWithLayer() {
  const tag = ++n, owner = await createUser('dtown' + tag), member = await createUser('dtmem' + tag);
  const s = await makeSpace({ members: { [owner]: 'owner', [member]: 'member' } });
  await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'REST API Project', weight: 20, notes: 'Use the starter repo' });
  await sharedItem(s.scope, 'q1', { course_id: 'web', title: 'Quiz 1', weight: 10 });
  await sharedItem(s.scope, 'q2', { course_id: 'web', title: 'Quiz 2', weight: 10 });
  await mark(member, s.id, 'a1', { status: 'graded', grade: 88, notes: 'Mine' });
  await mark(member, s.id, 'q1', { hidden: 1 });
  await mark(member, s.id, 'q2', { hidden: 1, grade: 70 });
  await pref(member, s.id);
  await ownItem(member, 'f1', { class_id: s.id, title: 'Extra reading' });
  await session(member, 's1', { course_id: 'web', item_id: 'a1', space_id: s.id });
  await achievement(member, 'g1', { rule: 'grade', item_id: 'a1', space_id: s.id });
  return { owner, member, s };
}

const LEAVING = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role != 'owner')";

describe('detach', () => {
  it('copies the class into your scope with your layer folded in, once', async () => {
    const { member, s } = await classWithLayer();
    const before = await spaceRevision(s.id);
    expect(await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 })).toBe(true);
    expect(await one("SELECT id, name, color, term, target, archived FROM courses WHERE scope = 'u:' || ?", member))
      .toEqual({ id: 'web', name: 'Web Services', color: '#4F74D9', term: 'Fall 2026', target: 85, archived: 0 });
    expect(await rows("SELECT id, course_id, class_id, status, grade, weight, notes FROM items WHERE scope = 'u:' || ? ORDER BY id", member)).toEqual([
      { id: 'a1', course_id: 'web', class_id: null, status: 'graded', grade: 88, weight: 20, notes: 'Mine\n\nClass notes:\nUse the starter repo' },
      { id: 'f1', course_id: 'web', class_id: null, status: 'todo', grade: null, weight: null, notes: '' },
      { id: 'q2', course_id: 'web', class_id: null, status: 'todo', grade: 70, weight: 10, notes: '' },
    ]);
    expect(await one('SELECT course_id, item_id, space_id FROM study_sessions WHERE user_id = ?', member)).toEqual({ course_id: 'web', item_id: 'a1', space_id: null });
    expect(await one('SELECT item_id, space_id FROM achievements WHERE user_id = ?', member)).toEqual({ item_id: 'a1', space_id: null });
    expect(await one('SELECT count(*) AS n FROM marks WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
    expect(await one('SELECT deleted_at FROM members WHERE space_id = ? AND user_id = ?', s.id, member)).toEqual({ deleted_at: 50 });
    expect(await one('SELECT count(*) AS n FROM items WHERE scope = ? AND deleted_at IS NULL', s.scope)).toEqual({ n: 3 });
    const after = await spaceRevision(s.id);
    expect(after).toBeGreaterThan(before);
    /* a retry finds no membership: nothing more, not even the revision */
    const revisions = await rows("SELECT id, revision FROM items WHERE scope = 'u:' || ? ORDER BY id", member);
    expect(await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 60 })).toBe(false);
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", member)).toEqual({ n: 3 });
    expect(await rows("SELECT id, revision FROM items WHERE scope = 'u:' || ? ORDER BY id", member)).toEqual(revisions);
    expect(await one('SELECT updated_at FROM study_sessions WHERE user_id = ?', member)).toEqual({ updated_at: 50 });
    expect(await one('SELECT deleted_at FROM members WHERE space_id = ? AND user_id = ?', s.id, member)).toEqual({ deleted_at: 50 });
    expect(await spaceRevision(s.id)).toBe(after);
  });

  it('without a copy, drops your layer and unfiles your items; sessions keep the class', async () => {
    const { member, s } = await classWithLayer();
    expect(await detach(env.DB, member, s.id, { keepCopy: false, who: LEAVING, now: 50 })).toBe(true);
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", member)).toEqual({ n: 0 });
    expect(await rows("SELECT id, course_id, class_id FROM items WHERE scope = 'u:' || ?", member)).toEqual([{ id: 'f1', course_id: null, class_id: null }]);
    expect(await one('SELECT space_id FROM study_sessions WHERE user_id = ?', member)).toEqual({ space_id: s.id });
    expect(await one('SELECT count(*) AS n FROM marks WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
    expect(await detach(env.DB, member, s.id, { keepCopy: false, who: LEAVING, now: 60 })).toBe(false);
    expect(await one("SELECT updated_at FROM items WHERE scope = 'u:' || ? AND id = 'f1'", member)).toEqual({ updated_at: 50 });
  });

  it('refuses when the membership does not meet `who`: the owner cannot leave', async () => {
    const { owner, member, s } = await classWithLayer();
    await pref(owner, s.id);
    expect(await detach(env.DB, owner, s.id, { keepCopy: true, who: LEAVING, now: 50 })).toBe(false);
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", owner)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND deleted_at IS NULL', owner)).toEqual({ n: 1 });
    expect(await one('SELECT deleted_at FROM members WHERE space_id = ? AND user_id = ?', s.id, owner)).toEqual({ deleted_at: null });
    expect(await one('SELECT count(*) AS n FROM marks WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 3 });
  });

  it("gives a copy a new id when a live row of yours has the class's, and revives a tombstone under its own", async () => {
    const { member, s } = await classWithLayer();
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES ('u:' || ?, 'web', 'WEB', 'Mine', '#17B3AE', 1, 1)").bind(member).run();
    await ownItem(member, 'q2', { deleted_at: 3, title: 'Old quiz 2' });
    await ownItem(member, 'a1', { title: 'My own a1' });
    expect(await copyIds(env.DB, member, s.id)).toEqual({ course: 'kweb', items: JSON.stringify([['a1', 'ka1'], ['q1', 'q1'], ['q2', 'q2']]) });
    await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 });
    expect(await rows("SELECT id, course_id, title, deleted_at FROM items WHERE scope = 'u:' || ? AND id IN ('a1', 'ka1', 'q2') ORDER BY id", member)).toEqual([
      { id: 'a1', course_id: null, title: 'My own a1', deleted_at: null },
      { id: 'ka1', course_id: 'kweb', title: 'REST API Project', deleted_at: null },
      { id: 'q2', course_id: 'kweb', title: 'Quiz 2', deleted_at: null },
    ]);
    expect(await one("SELECT name FROM courses WHERE scope = 'u:' || ? AND id = 'web'", member)).toEqual({ name: 'Mine' });
    expect(await one('SELECT course_id, item_id FROM study_sessions WHERE user_id = ?', member)).toEqual({ course_id: 'kweb', item_id: 'ka1' });
    expect(await one('SELECT item_id FROM achievements WHERE user_id = ?', member)).toEqual({ item_id: 'ka1' });
  });

  it('leaving the same class a third time lands a third copy: no copy id is ever a live row', async () => {
    const { member, s } = await classWithLayer();
    const grades = [];
    for (const [i, grade] of [88, 90, 91].entries()) {
      if (i) {
        await setMember(s.id, member, 'member');
        await env.DB.prepare("UPDATE marks SET deleted_at = NULL, grade = ? WHERE user_id = ? AND item_id = 'a1'").bind(grade, member).run();
      }
      expect(await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 + i })).toBe(true);
      grades.push(grade);
    }
    expect(await rows("SELECT id, course_id, grade FROM items WHERE scope = 'u:' || ? AND title = 'REST API Project' AND deleted_at IS NULL ORDER BY grade", member)).toEqual([
      { id: 'a1', course_id: 'web', grade: 88 },
      { id: 'ka1', course_id: 'kweb', grade: 90 },
      { id: 'k1a1', course_id: 'k1web', grade: 91 },
    ]);
    expect(await rows("SELECT id FROM courses WHERE scope = 'u:' || ? AND deleted_at IS NULL ORDER BY id", member)).toEqual([{ id: 'k1web' }, { id: 'kweb' }, { id: 'web' }]);
  });

  it("never gives two class items one copy id, nor a 'k' id the class or you already use", async () => {
    const { member, s } = await classWithLayer();
    await sharedItem(s.scope, 'ka1', { course_id: 'web', title: 'Lab 1' });
    await mark(member, s.id, 'ka1', { grade: 77 });
    await ownItem(member, 'a1', { title: 'My own a1' });
    const long = 'x'.repeat(23);
    await sharedItem(s.scope, long + '1', { course_id: 'web', title: 'Long 1' });
    await sharedItem(s.scope, long + '2', { course_id: 'web', title: 'Long 2' });
    await mark(member, s.id, long + '1', { grade: 61 });
    await mark(member, s.id, long + '2', { grade: 62 });
    await ownItem(member, long + '1');
    await ownItem(member, long + '2');
    const map = JSON.parse((await copyIds(env.DB, member, s.id)).items);
    expect(new Set(map.map(([, to]) => to)).size).toBe(map.length);
    expect(map).toContainEqual(['ka1', 'ka1']);
    expect(map).toContainEqual(['a1', 'k1a1']);
    expect(map.every(([, to]) => to.length <= 24)).toBe(true);
    await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 });
    expect(await rows("SELECT title, grade FROM items WHERE scope = 'u:' || ? AND course_id = 'web' AND deleted_at IS NULL AND grade IS NOT NULL ORDER BY grade", member)).toEqual([
      { title: 'Long 1', grade: 61 },
      { title: 'Long 2', grade: 62 },
      { title: 'Quiz 2', grade: 70 },
      { title: 'Lab 1', grade: 77 },
      { title: 'REST API Project', grade: 88 },
    ]);
  });

  it('brings a removed item along when your mark on it holds something', async () => {
    const { member, s } = await classWithLayer();
    await env.DB.prepare("UPDATE items SET deleted_at = 9 WHERE scope = ? AND id = 'a1'").bind(s.scope).run();
    await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 });
    expect(await one("SELECT grade, deleted_at FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member)).toEqual({ grade: 88, deleted_at: null });
  });
});

describe('leaving and removing, through the routes', () => {
  async function three() {
    const tag = ++n;
    const owner = await signInAdmin('lvo' + tag), member = await signInAdmin('lvm' + tag), outsider = await signInAdmin('lvx' + tag);
    const s = await makeSpace({ members: { [owner.id]: 'owner', [member.id]: 'member' } });
    await sharedItem(s.scope, 'a1', { course_id: 'web', weight: 20 });
    await mark(member.id, s.id, 'a1', { grade: 75 });
    return { owner, member, outsider, s };
  }

  it('a member leaves with a copy by default, and the revision moves', async () => {
    const { member, s } = await three();
    const before = await spaceRevision(s.id);
    expect((await post(member, `/api/spaces/${s.id}/leave`, {})).status).toBe(204);
    expect(await one("SELECT grade FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id)).toEqual({ grade: 75 });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    expect((await post(member, `/api/spaces/${s.id}/leave`, {})).status).toBe(404);
  });

  it('keepCopy false leaves no course; a bad keepCopy is refused', async () => {
    const { member, s } = await three();
    expect(await (await post(member, `/api/spaces/${s.id}/leave`, { keepCopy: 'yes' })).json()).toEqual({ error: 'invalid', field: 'keepCopy' });
    expect((await post(member, `/api/spaces/${s.id}/leave`, { keepCopy: false })).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", member.id)).toEqual({ n: 0 });
  });

  it('the owner cannot leave; an outsider gets 404', async () => {
    const { owner, outsider, s } = await three();
    const res = await post(owner, `/api/spaces/${s.id}/leave`, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'owner' });
    expect((await post(outsider, `/api/spaces/${s.id}/leave`, {})).status).toBe(404);
  });

  it('the owner removes a member, who keeps a copy; nobody else removes, nor the owner themselves', async () => {
    const { owner, member, outsider, s } = await three();
    const remove = (api, uid) => api(`/api/spaces/${s.id}/members/${uid}`, { method: 'DELETE' });
    expect((await remove(member, owner.id)).status).toBe(403);
    expect((await remove(outsider, member.id)).status).toBe(404);
    expect((await remove(owner, owner.id)).status).toBe(403);
    expect((await remove(owner, member.id)).status).toBe(204);
    expect(await one("SELECT grade FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id)).toEqual({ grade: 75 });
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM members WHERE space_id = ? AND user_id = ?', s.id, member.id)).toEqual({ gone: 1 });
    expect((await remove(owner, member.id)).status).toBe(404);
  });

  it('a member who merged their course gets it back under its ids on leaving', async () => {
    const { member, s } = await three();
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at, deleted_at) VALUES ('u:' || ?, 'web', 'WEB', 'Web', '#17B3AE', 1, 1, 5)").bind(member.id).run();
    expect((await post(member, `/api/spaces/${s.id}/leave`, {})).status).toBe(204);
    expect(await one("SELECT id, deleted_at FROM courses WHERE scope = 'u:' || ?", member.id)).toEqual({ id: 'web', deleted_at: null });
  });
});
