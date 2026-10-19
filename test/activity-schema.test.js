import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, sharedItem } from './spaces.js';

/* A time on a 10-minute boundary, so T0 and T0 + 9 minutes share a bucket. */
const T0 = 600_000 * 2_833_334;
const MIN = 60_000;
const rows = async (spaceId) => (await env.DB.prepare(`SELECT actor_id, verb, subject, subject_user, old_value, new_value, detail, n
  FROM activity WHERE space_id = ? ORDER BY seq`).bind(spaceId).all()).results.map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
const edit = (scope, id, sets, by, at, ...binds) => env.DB.prepare(`UPDATE items SET ${sets}, updated_by = ?, updated_at = ?, revision = revision + 1
  WHERE scope = ? AND id = ?`).bind(...binds, by, at, scope, id).run();
let n = 0;
async function space(kind = 'class') {
  const tag = ++n, alex = await createUser('aca' + tag, 'Alex'), sam = await createUser('acs' + tag);
  const s = await makeSpace({ kind, members: { [alex]: 'owner', [sam]: 'member' } });
  return { alex, sam, s };
}

describe('activity from shared rows (spec §12)', () => {
  it('records nothing for personal rows', async () => {
    const me = await createUser('acp' + ++n);
    await env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at) VALUES ('u:' || ?, 'x', 'task', 'Mine', '2026-10-15', 'todo', 1, 1)").bind(me).run();
    await edit('u:' + me, 'x', "date = '2026-10-18', title = 'Mine 2'", me, T0);
    /* a trigger would file it under the scope's id (and refuse it, not being 12 characters) */
    expect((await env.DB.prepare('SELECT count(*) AS n FROM activity WHERE space_id = ? OR actor_id = ?').bind(me, me).first()).n).toBe(0);
  });

  it('coalesces creations by one person in ten minutes into one row with up to ten titles', async () => {
    const { alex, s } = await space();
    for (let i = 1; i <= 12; i++) await sharedItem(s.scope, 'a' + i, { course_id: 'web', title: 'Lab ' + i, updated_by: alex, updated_at: T0 + i * 1000 });
    const [r] = await rows(s.id);
    expect(r).toMatchObject({ actor_id: alex, verb: 'item.created', subject: '', subject_user: '', n: 12 });
    expect(r.detail.titles).toEqual(['Lab 1', 'Lab 2', 'Lab 3', 'Lab 4', 'Lab 5', 'Lab 6', 'Lab 7', 'Lab 8', 'Lab 9', 'Lab 10']);
    expect(r.detail.by).toBe('Alex');
  });

  it('keeps the first "from" of a date change and drops the row when it goes back', async () => {
    const { alex, s } = await space();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'REST API', date: '2026-10-15', updated_by: alex, updated_at: T0 - 20 * MIN });
    await edit(s.scope, 'a1', "date = '2026-10-18'", alex, T0);
    await edit(s.scope, 'a1', "date = '2026-10-20', start = '09:00'", alex, T0 + 5 * MIN);
    const moved = (await rows(s.id)).filter((r) => r.verb === 'item.date');
    expect(moved).toEqual([expect.objectContaining({ subject: 'a1', old_value: '2026-10-15||', new_value: '2026-10-20|09:00|', n: 2 })]);
    await edit(s.scope, 'a1', "date = '2026-10-15', start = ''", alex, T0 + 9 * MIN);
    expect((await rows(s.id)).filter((r) => r.verb === 'item.date')).toEqual([]);
  });

  it('records deletion and restoring as one verb, and title and weight changes', async () => {
    const { alex, s } = await space();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Quiz', weight: 10, updated_by: alex, updated_at: T0 - 30 * MIN });
    await edit(s.scope, 'a1', 'weight = 15, title = ?', alex, T0, 'Quiz 1');
    await edit(s.scope, 'a1', 'deleted_at = ?', alex, T0 + MIN, T0 + MIN);
    const got = (await rows(s.id)).filter((r) => r.verb !== 'item.created').map((r) => [r.verb, r.old_value, r.new_value]);
    expect(got).toEqual([['item.weight', '10.0', '15.0'], ['item.title', 'Quiz', 'Quiz 1'], ['item.deleted', '0', '1']]);
    await edit(s.scope, 'a1', 'deleted_at = NULL', alex, T0 + 2 * MIN);
    expect((await rows(s.id)).some((r) => r.verb === 'item.deleted')).toBe(false);
  });

  it('records class times and the instructor on the class course', async () => {
    const { alex, s } = await space();
    await env.DB.prepare(`UPDATE courses SET meetings = '[{"id":"m1","kind":"Lecture","weekday":1,"start":"09:00","end":"10:00","room":"B2"}]',
      instructor = 'Dr. Ng', updated_by = ?, updated_at = ? WHERE scope = ?`).bind(alex, T0, s.scope).run();
    expect((await rows(s.id)).map((r) => [r.verb, r.subject, r.detail.title])).toEqual([
      ['course.meetings', 'web', 'Web Services'], ['course.instructor', 'web', 'Web Services'],
    ]);
  });

  it('records each new assignee, a task left with nobody, and completion with its assignees', async () => {
    const { alex, sam, s } = await space('project');
    await sharedItem(s.scope, 't1', { title: 'Endpoint', assignees: JSON.stringify([sam]), updated_by: alex, updated_at: T0 });
    await edit(s.scope, 't1', 'assignees = ?', alex, T0 + MIN, JSON.stringify([sam, alex]));
    await edit(s.scope, 't1', "status = 'done', completed_at = ?, completed_by = ?", sam, T0 + 2 * MIN, T0 + 2 * MIN, sam);
    /* in the next bucket: taking them off within the same ten minutes would cancel the assignments */
    await edit(s.scope, 't1', "assignees = '[]'", alex, T0 + 10 * MIN);
    const got = (await rows(s.id)).filter((r) => r.verb.startsWith('task.'));
    expect(got.map((r) => [r.actor_id, r.verb, r.subject_user, r.new_value])).toEqual([
      [alex, 'task.assigned', sam, sam], [alex, 'task.assigned', alex, alex], [sam, 'task.status', '', 'done'], [alex, 'task.unassigned', '', '[]'],
    ]);
    expect(got[2].detail.assignees).toEqual([sam, alex]);
    expect(got[0].detail.whom).toBe('acs' + n);
  });

  it('drops an assignment taken back in the same ten minutes, for a person and for everyone', async () => {
    const { alex, sam, s } = await space('project');
    await sharedItem(s.scope, 't3', { title: 'Review', updated_by: alex, updated_at: T0 - 30 * MIN });
    await edit(s.scope, 't3', 'assignees = ?', alex, T0, JSON.stringify([sam, '*']));
    await edit(s.scope, 't3', 'assignees = ?', alex, T0 + MIN, JSON.stringify([alex]));
    const assigned = () => rows(s.id).then((all) => all.filter((r) => r.verb === 'task.assigned').map((r) => r.new_value));
    expect(await assigned()).toEqual([alex]);
    /* an assignment from an earlier bucket stays: it was news when it happened */
    await edit(s.scope, 't3', "assignees = '[]'", alex, T0 + 20 * MIN);
    expect(await assigned()).toEqual([alex]);
  });

  it('writes "everyone" as an empty subject_user', async () => {
    const { alex, s } = await space('project');
    await sharedItem(s.scope, 't2', { title: 'Slides', assignees: '["*"]', updated_by: alex, updated_at: T0 });
    expect((await rows(s.id)).filter((r) => r.verb === 'task.assigned').map((r) => [r.subject_user, r.new_value])).toEqual([['', '*']]);
  });

  it('refuses an unknown verb and keeps inbox_seen per person', async () => {
    const me = await createUser('acq' + ++n);
    await expect(env.DB.prepare("INSERT INTO activity (space_id, verb, bucket, at) VALUES ('abcdefabcdef', 'item.sneezed', 1, 1)").run()).rejects.toThrow(/CHECK constraint failed/);
    await env.DB.prepare('INSERT INTO inbox_seen (user_id, seq) VALUES (?, 5)').bind(me).run();
    await expect(env.DB.prepare('INSERT INTO inbox_seen (user_id, seq) VALUES (?, 6)').bind(me).run()).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
