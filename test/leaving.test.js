import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { achievement, makeSpace, mark, ownItem, pref, session, sharedItem, spaceRevision } from './spaces.js';
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

  it('brings a removed item along when your mark on it holds something', async () => {
    const { member, s } = await classWithLayer();
    await env.DB.prepare("UPDATE items SET deleted_at = 9 WHERE scope = ? AND id = 'a1'").bind(s.scope).run();
    await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 });
    expect(await one("SELECT grade, deleted_at FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member)).toEqual({ grade: 88, deleted_at: null });
  });
});
