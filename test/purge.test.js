import { env, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../worker/index.js';
import { createUser, signIn } from './helpers.js';
import { makeSpace, mark, sharedItem } from './spaces.js';

describe('nightly purge', () => {
  it('hard-deletes tombstones older than 30 days and keeps newer ones', async () => {
    const api = await signIn();
    await api('/api/quotes/old', { method: 'PUT', body: { text: 'old', source: '' } });
    await api('/api/quotes/new', { method: 'PUT', body: { text: 'new', source: '' } });
    await api('/api/quotes/old', { method: 'DELETE' });
    await api('/api/quotes/new', { method: 'DELETE' });
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await env.DB.prepare("UPDATE quotes SET deleted_at = ? WHERE id = 'old'").bind(old).run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    const { results } = await env.DB.prepare("SELECT id FROM quotes WHERE id IN ('old', 'new') ORDER BY id").all();
    expect(results.map((r) => r.id)).toEqual(['new']);
  });
});

const DAY = 24 * 60 * 60 * 1000;
async function runNightly() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();

describe('nightly purge of shared rows (spec §13)', () => {
  it('keeps a removed item for whoever holds something on it before purging it; drops bare marks', async () => {
    const owner = await createUser('pgo1'), member = await createUser('pgm1'), other = await createUser('pgx1');
    const s = await makeSpace({ members: { [owner]: 'owner', [member]: 'member', [other]: 'member' } });
    const old = Date.now() - 31 * DAY;
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 3', deleted_at: old });
    await mark(member, s.id, 'a1', { grade: 81 });
    await mark(other, s.id, 'a1', { hidden: 1 });
    await runNightly();
    expect(await one("SELECT class_id, grade FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member)).toEqual({ class_id: s.id, grade: 81 });
    expect(await one('SELECT count(*) AS n FROM marks WHERE item_id = ? AND space_id = ?', 'a1', s.id)).toEqual({ n: 1 });   // the kept one's tombstone
    expect(await one('SELECT count(*) AS n FROM items WHERE scope = ? AND id = ?', s.scope, 'a1')).toEqual({ n: 0 });
    await runNightly();   // a rerun changes nothing
    expect(await one("SELECT count(*) AS n, max(grade) AS grade FROM items WHERE scope = 'u:' || ? AND deleted_at IS NULL", member)).toEqual({ n: 1, grade: 81 });
  });

  it('keeps for someone who has since left the class too', async () => {
    const owner = await createUser('pgo4'), gone = await createUser('pgl4');
    const s = await makeSpace({ members: { [owner]: 'owner', [gone]: 'member' } });
    await sharedItem(s.scope, 'b1', { course_id: 'web', deleted_at: Date.now() - 31 * DAY });
    await mark(gone, s.id, 'b1', { notes: 'mine' });
    await env.DB.prepare('UPDATE members SET deleted_at = ? WHERE space_id = ? AND user_id = ?').bind(Date.now() - DAY, s.id, gone).run();
    await runNightly();
    expect(await one("SELECT notes FROM items WHERE scope = 'u:' || ? AND id = 'b1'", gone)).toEqual({ notes: 'mine' });
    expect(await one('SELECT count(*) AS n FROM items WHERE scope = ? AND id = ?', s.scope, 'b1')).toEqual({ n: 0 });
  });

  it('removes a space deleted over 30 days ago with everything in it; a newer one stays', async () => {
    const owner = await createUser('pgo2');
    const gone = await makeSpace({ members: { [owner]: 'owner' } }), fresh = await makeSpace({ members: { [owner]: 'owner' } });
    await sharedItem(gone.scope, 'x', { course_id: 'web' });
    await env.DB.batch([
      env.DB.prepare('UPDATE spaces SET deleted_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, gone.id),
      env.DB.prepare('UPDATE spaces SET deleted_at = ? WHERE id = ?').bind(Date.now() - 2 * DAY, fresh.id),
    ]);
    await runNightly();
    expect(await one('SELECT count(*) AS n FROM spaces WHERE id = ?', gone.id)).toEqual({ n: 0 });
    for (const t of ['items', 'courses', 'changes']) expect(await one(`SELECT count(*) AS n FROM ${t} WHERE scope = ?`, gone.scope)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ?', gone.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM spaces WHERE id = ?', fresh.id)).toEqual({ n: 1 });
    expect(await one('SELECT count(*) AS n FROM courses WHERE scope = ?', fresh.scope)).toEqual({ n: 1 });
  });

  it('deletes invites 90 days after they were made, and old membership tombstones', async () => {
    const owner = await createUser('pgo3'), guest = await createUser('pgg3'), left = await createUser('pgl3');
    const s = await makeSpace({ members: { [owner]: 'owner', [left]: 'member' } });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invites (space_id, user_id, role, created_at, expires_at) VALUES (?, ?, 'member', ?, ?)").bind(s.id, guest, Date.now() - 91 * DAY, Date.now() - 84 * DAY),
      env.DB.prepare('UPDATE members SET deleted_at = ? WHERE space_id = ? AND user_id = ?').bind(Date.now() - 31 * DAY, s.id, left),
    ]);
    await runNightly();
    expect(await one('SELECT count(*) AS n FROM invites WHERE space_id = ?', s.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ?', s.id)).toEqual({ n: 1 });
  });
});
