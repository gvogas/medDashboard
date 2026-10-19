import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace } from './spaces.js';
import { deleteShared, getShared, memberTaskWrite, upsertShared } from '../worker/db.js';
import { normalizeItem } from '../src/core/model.ts';

/* An item as the route hands it over: validated and in its scope's shape. */
const classItem = (over = {}) => ({
  ...normalizeItem({ id: 'x', type: 'assignment', title: 'REST API Project', courseId: 'web', date: '2026-10-15', weight: 20 }),
  status: 'todo', grade: null, checklist: [], completedAt: null, assignees: [], ...over,
});
const task = (over = {}) => ({ ...normalizeItem({ id: 't', type: 'task', title: 'Create incidents endpoint', date: '2026-10-10' }), assignees: [], ...over });

async function space(tag, kind = 'class') {
  const owner = await createUser(tag + '-owner'), editor = await createUser(tag + '-editor');
  const member = await createUser(tag + '-member'), other = await createUser(tag + '-other');
  const s = await makeSpace({ kind, members: { [owner]: 'owner', [editor]: 'editor', [member]: 'member', [other]: 'member' } });
  return { ...s, owner, editor, member, other };
}

describe('shared rows', () => {
  it('are written by editors, who are named on the row, and read by members', async () => {
    const s = await space('sr-write');
    const saved = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem());
    expect(saved).toMatchObject({ id: 'x', scope: s.scope, updatedBy: s.editor, title: 'REST API Project', weight: 20, courseId: 'web' });
    expect(await getShared(env.DB, 'items', s.scope, s.member, 'x')).toMatchObject({ revision: saved.revision });
    expect(await env.DB.prepare("SELECT scope FROM changes WHERE kind = 'items' AND row_id = 'x' AND scope = ?").bind(s.scope).first()).toEqual({ scope: s.scope });
  });

  it('refuse members, outsiders, a course from outside the class, and an archived space', async () => {
    const s = await space('sr-refuse'), outsider = await createUser('sr-refuse-out');
    await expect(upsertShared(env.DB, 'items', s.scope, s.member, 'x', classItem())).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    await expect(upsertShared(env.DB, 'items', s.scope, outsider, 'x', classItem())).rejects.toMatchObject({ status: 404 });
    expect(await getShared(env.DB, 'items', s.scope, outsider, 'x')).toBeNull();
    await expect(upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ courseId: 'nope' }))).rejects.toMatchObject({ status: 400, body: { field: 'courseId' } });
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(s.id).run();
    await expect(upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem())).rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });

  it('merge disjoint edits made at the same revision, so both stand', async () => {
    const s = await space('sr-disjoint');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    const gabriel = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    const alex = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Teams of 3' }), { revision: v1.revision, changed: { notes: '' } });
    expect(alex).toMatchObject({ date: '2026-10-18', notes: 'Teams of 3', updatedBy: s.editor });
    expect(alex.revision).toBe(gabriel.revision + 1);
  });

  it('refuse one field changed by two people, naming the field and who changed it first', async () => {
    const s = await space('sr-same');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    await expect(upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ date: '2026-10-20' }), { revision: v1.revision, changed: { date: '2026-10-15' } }))
      .rejects.toMatchObject({ status: 409, body: { error: 'conflict', fields: ['date'], by: s.owner, current: { date: '2026-10-18' } } });
  });

  it('compare JSON fields by value, whatever the key order', async () => {
    const s = await space('sr-json');
    const links = [{ label: 'Brief', url: 'https://example.edu' }];
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ links }));
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ links, date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    const saved = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ links, title: 'REST API' }),
      { revision: v1.revision, changed: { links: [{ url: 'https://example.edu', label: 'Brief' }], title: 'REST API Project' } });
    expect(saved).toMatchObject({ title: 'REST API', date: '2026-10-18', links });
  });

  it('never merge onto a deleted row, and refuse deleting a row edited since', async () => {
    const s = await space('sr-delete');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    const v2 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    await expect(deleteShared(env.DB, 'items', s.scope, s.editor, 'x', 5, v1.revision)).rejects.toMatchObject({ status: 409, body: { by: s.owner, current: { revision: v2.revision } } });
    await expect(deleteShared(env.DB, 'items', s.scope, s.member, 'x', 5, v2.revision)).rejects.toMatchObject({ status: 403 });
    expect(await deleteShared(env.DB, 'items', s.scope, s.owner, 'x', 5, v2.revision)).toBe(true);
    await expect(upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Late' }), { revision: v1.revision, changed: { notes: '' } }))
      .rejects.toMatchObject({ status: 409, body: { fields: ['notes'], current: { deletedAt: 5 } } });
    expect(await deleteShared(env.DB, 'items', s.scope, s.owner, 'nothing', 5, 1)).toBe(false);
  });

  it('merge two first writes of one new row against the defaults', async () => {
    const s = await space('sr-create');
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'y', classItem({ title: 'Lab 1' }));
    const both = await upsertShared(env.DB, 'items', s.scope, s.editor, 'y', classItem({ title: 'Lab 1', notes: 'Bring goggles' }), { revision: 0, changed: { title: null, notes: null } });
    expect(both).toMatchObject({ title: 'Lab 1', notes: 'Bring goggles', updatedBy: s.editor });
  });

  it('treat a stale write without `changed` as a whole-row write, as an old client sends it', async () => {
    const s = await space('sr-old');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision });
    const refused = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ notes: 'x' }), { revision: v1.revision }).catch((e) => e);
    expect(refused).toMatchObject({ status: 409, body: { error: 'conflict', current: { date: '2026-10-18' } } });
    expect(refused.body).not.toHaveProperty('fields');
  });

  it('retry once when another write lands between reading the row and merging onto it', async () => {
    const s = await space('sr-race');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    const v2 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    let raced = false;
    const racing = {
      prepare(sql) {
        const stmt = env.DB.prepare(sql);
        if (raced || !sql.startsWith('UPDATE items SET')) return stmt;
        raced = true;
        return { bind: (...args) => ({ first: async () => {
          await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18', weight: 25 }), { revision: v2.revision, changed: { weight: 20 } });
          return stmt.bind(...args).first();
        } }) };
      },
      batch: (list) => env.DB.batch(list),
    };
    const saved = await upsertShared(racing, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Teams of 3' }), { revision: v1.revision, changed: { notes: '' } });
    expect(raced).toBe(true);
    expect(saved).toMatchObject({ date: '2026-10-18', weight: 25, notes: 'Teams of 3' });
  });

  it('answer 404 or 403, not a conflict, when access goes between checking it and merging', async () => {
    const s = await space('sr-lost');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    /* `change` runs once, just before the first read of the current row */
    const losing = (change) => ({
      prepare(sql) {
        const stmt = env.DB.prepare(sql);
        if (!change || !/^SELECT .* FROM items WHERE scope = \? AND id = \?/s.test(sql)) return stmt;
        const run = change; change = null;
        return { bind: (...args) => ({ first: async () => { await run(); return stmt.bind(...args).first(); } }) };
      },
      batch: (list) => env.DB.batch(list),
    });
    const write = (db) => upsertShared(db, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Teams of 3' }), { revision: v1.revision, changed: { notes: '' } });
    const role = (r) => env.DB.prepare('UPDATE members SET role = ?, deleted_at = ? WHERE space_id = ? AND user_id = ?').bind(r ?? 'editor', r ? null : 2, s.id, s.editor).run();
    await expect(write(losing(() => role(null)))).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await role('editor');
    await expect(write(losing(() => role('member')))).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    await role('editor');
    await expect(write(losing(() => env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(s.id).run()))).rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });
});

describe('a project member writing a task', () => {
  it('completes a task assigned to them: only status and completion are written, and the Worker names who', async () => {
    const p = await space('mt-done', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member] }));
    const done = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ title: 'Hacked', status: 'done', completedAt: 5, assignees: [] }), { changed: { status: 'todo', completedAt: null }, now: 7000 });
    expect(done).toMatchObject({ status: 'done', completedAt: 7000, completedBy: p.member, title: 'Create incidents endpoint', assignees: [p.member], updatedBy: p.member });
  });

  it('sets only todo or done, with the completion time the Worker\'s own', async () => {
    const p = await space('mt-status', 'project');
    const v1 = await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member] }));
    for (const status of ['graded', 'submitted', 'missed']) {
      await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status, completedAt: 5 }), { changed: { status: 'todo', completedAt: null } }))
        .rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    }
    /* a completion time alone is the Worker's to set: nothing is written */
    expect(await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ completedAt: 5 }), { changed: { completedAt: null } })).toMatchObject({ completedAt: null, revision: v1.revision });
    const done = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5 }), { changed: { status: 'todo', completedAt: null }, now: 7000 });
    expect(done).toMatchObject({ status: 'done', completedAt: 7000 });
    /* done again (another device, offline) changes nothing and keeps the first time */
    const again = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 9 }), { changed: { status: 'todo', completedAt: null }, now: 8000 });
    expect(again).toMatchObject({ completedAt: 7000, revision: done.revision });
    const reopened = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'todo', completedAt: 9 }), { changed: { status: 'done', completedAt: 7000 } });
    expect(reopened).toMatchObject({ status: 'todo', completedAt: null, completedBy: null });
  });

  it('writes nothing for a claim or unclaim that changes nothing', async () => {
    const p = await space('mt-noop', 'project');
    const v1 = await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member] }));
    expect(await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ assignees: [p.member] }), { changed: { assignees: [] } })).toMatchObject({ revision: v1.revision });
    expect(await memberTaskWrite(env.DB, p.scope, p.other, 't', task({ assignees: [p.member] }), { changed: { assignees: [p.member, p.other] } })).toMatchObject({ revision: v1.revision, assignees: [p.member] });
  });

  it('refuses a task assigned to someone else, any other field, a whole-row write and an archived project', async () => {
    const p = await space('mt-refuse', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member] }));
    const forbidden = { status: 403, body: { error: 'forbidden' } };
    await expect(memberTaskWrite(env.DB, p.scope, p.other, 't', task({ status: 'done', completedAt: 5 }), { changed: { status: 'todo', completedAt: null } })).rejects.toMatchObject(forbidden);
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ title: 'Mine' }), { changed: { title: 'Create incidents endpoint' } })).rejects.toMatchObject(forbidden);
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task(), {})).rejects.toMatchObject(forbidden);
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 'project', task({ status: 'done' }), { changed: { status: 'todo' } })).rejects.toMatchObject(forbidden);
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(p.id).run();
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5 }), { changed: { status: 'todo', completedAt: null } }))
      .rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });

  it('claims an unassigned task and unclaims only themselves, from the current list', async () => {
    const p = await space('mt-claim', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task());
    const claimed = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ assignees: [p.member, p.other] }), { changed: { assignees: [] } });
    expect(claimed.assignees).toEqual([p.member]);
    /* claimed while it looked unassigned: a lost race, so a conflict (an already taken task is 403, below) */
    await expect(memberTaskWrite(env.DB, p.scope, p.other, 't', task({ assignees: [p.other] }), { changed: { assignees: [] } })).rejects.toMatchObject({ status: 409 });
    const left = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ assignees: [] }), { changed: { assignees: [p.member] } });
    expect(left.assignees).toEqual([]);
  });

  /* a claim and a completion made close together (or offline) reach the Worker as one write */
  it('takes a claim with a completion, and an unclaim with a reopening, in one write', async () => {
    const p = await space('mt-both', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task());
    const both = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5, assignees: [p.member] }),
      { changed: { assignees: [], status: 'todo', completedAt: null }, now: 7000 });
    expect(both).toMatchObject({ assignees: [p.member], status: 'done', completedAt: 7000, completedBy: p.member });
    /* someone else's task stays theirs, and so does its status */
    await expect(memberTaskWrite(env.DB, p.scope, p.other, 't', task({ status: 'todo', assignees: [p.other] }), { changed: { assignees: [p.member], status: 'done', completedAt: 7000 } }))
      .rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const back = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'todo', assignees: [] }),
      { changed: { assignees: [p.member], status: 'done', completedAt: 7000 } });
    expect(back).toMatchObject({ assignees: [], status: 'todo', completedAt: null, completedBy: null, revision: both.revision + 1 });
    /* a claim beside any other field is still refused */
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ title: 'Mine', assignees: [p.member] }), { changed: { assignees: [], title: 'Create incidents endpoint' } }))
      .rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });

  it('takes an unclaim with a completion, refuses a claim of a task for everyone, and writes nothing when nothing changes', async () => {
    const p = await space('mt-both-more', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member, p.other] }));
    const off = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5, assignees: [p.other] }),
      { changed: { assignees: [p.member, p.other], status: 'todo', completedAt: null }, now: 7000 });
    expect(off).toMatchObject({ assignees: [p.other], status: 'done', completedAt: 7000, completedBy: p.member });
    /* nothing to claim and nothing to complete: the current row, its revision unmoved */
    const same = await memberTaskWrite(env.DB, p.scope, p.other, 't', task({ status: 'done', completedAt: 9, assignees: [p.other] }),
      { changed: { assignees: [], status: 'todo', completedAt: null } });
    expect(same).toMatchObject({ revision: off.revision, status: 'done', completedAt: 7000, assignees: [p.other] });
    await upsertShared(env.DB, 'items', p.scope, p.owner, 'all', task({ assignees: ['*'] }));
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 'all', task({ status: 'done', completedAt: 5, assignees: ['*', p.member] }),
      { changed: { assignees: ['*'], status: 'todo', completedAt: null } })).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });

  it('answers a claim someone else won first as a conflict, and one of a task already taken as forbidden', async () => {
    const p = await space('mt-race', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task());
    const won = await memberTaskWrite(env.DB, p.scope, p.other, 't', task({ assignees: [p.other] }), { changed: { assignees: [] } });
    /* queued while the task was unassigned */
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5, assignees: [p.member] }), { changed: { assignees: [], status: 'todo', completedAt: null } }))
      .rejects.toMatchObject({ status: 409, body: { error: 'conflict', fields: ['assignees'], current: { assignees: [p.other], revision: won.revision } } });
    /* queued when it was already someone else's */
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ assignees: [p.other, p.member] }), { changed: { assignees: [p.other] } }))
      .rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });

  it('refuses a claim of a task assigned to someone else that comes with a completion', async () => {
    const p = await space('mt-both-other', 'project');
    const v1 = await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.other] }));
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5, assignees: [p.member] }), { changed: { assignees: [p.other], status: 'todo', completedAt: null } }))
      .rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect(await getShared(env.DB, 'items', p.scope, p.owner, 't')).toMatchObject({ status: 'todo', assignees: [p.other], revision: v1.revision });
  });

  it('lets anyone complete a task for everyone, and an editor\'s later edit keeps who completed it', async () => {
    const p = await space('mt-all', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: ['*'] }));
    const done = await memberTaskWrite(env.DB, p.scope, p.other, 't', task({ status: 'done', completedAt: 5, assignees: ['*'] }), { changed: { status: 'todo', completedAt: null } });
    expect(done.completedBy).toBe(p.other);
    const retitled = await upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ title: 'Incidents API', status: 'done', completedAt: 5, assignees: ['*'] }), { revision: done.revision });
    expect(retitled).toMatchObject({ title: 'Incidents API', completedBy: p.other });
    const reopened = await upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ title: 'Incidents API', assignees: ['*'] }), { revision: retitled.revision });
    expect(reopened.completedBy).toBeNull();
  });

  it('refuses an editor assigning someone who is not in the project', async () => {
    const p = await space('mt-assign', 'project'), outsider = await createUser('mt-assign-out');
    await expect(upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ assignees: [outsider] }))).rejects.toMatchObject({ status: 400, body: { field: 'assignees' } });
    expect(await upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ assignees: [p.member, p.other] }))).toMatchObject({ assignees: [p.member, p.other] });
  });
});
