import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { deleteRow, upsertRow } from '../worker/db.js';
import { normalizeItem } from '../src/core/model.ts';

const course = { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] };

describe('database relationships and inspection views', () => {
  it('rejects direct course deletion without attempting to null the item owner', async () => {
    const id = await createUser('schema-owner');
    const parent = await upsertRow(env.DB, 'courses', id, 'c', course);
    await upsertRow(env.DB, 'items', id, 'i', normalizeItem({ id: 'i', title: 'Study', courseId: 'c' }));
    await expect(env.DB.prepare('DELETE FROM courses WHERE user_id = ? AND id = ?').bind(id, 'c').run())
      .rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect(await env.DB.prepare('SELECT user_id, course_id FROM items WHERE user_id = ?').bind(id).first())
      .toEqual({ user_id: id, course_id: 'c' });
    await deleteRow(env.DB, 'courses', id, 'c', Date.now(), parent.revision);
    await env.DB.prepare('DELETE FROM courses WHERE user_id = ? AND id = ?').bind(id, 'c').run();
    expect(await env.DB.prepare('SELECT user_id, course_id FROM items WHERE user_id = ?').bind(id).first())
      .toEqual({ user_id: id, course_id: null });
  });

  it('stores project items and a background per user', async () => {
    const id = await createUser('schema-project');
    const saved = await upsertRow(env.DB, 'items', id, 'p', normalizeItem({ id: 'p', title: 'Compiler', type: 'project' }));
    expect(saved.type).toBe('project');
    expect(await env.DB.prepare('SELECT bg FROM users WHERE id = ?').bind(id).first()).toEqual({ bg: 'med' });
    await expect(env.DB.prepare("UPDATE users SET bg = 'law' WHERE id = ?").bind(id).run()).rejects.toThrow(/CHECK constraint failed/);
    await expect(env.DB.prepare("UPDATE items SET type = 'essay' WHERE user_id = ?").bind(id).run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it('rejects invalid item revisions at the database boundary', async () => {
    const id = await createUser('schema-revision');
    await upsertRow(env.DB, 'items', id, 'i', normalizeItem({ id: 'i', title: 'Study' }));
    for (const revision of [0, -1, 1.5, 'invalid']) {
      await expect(env.DB.prepare('UPDATE items SET revision = ? WHERE user_id = ?').bind(revision, id).run())
        .rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it('shows live records and counts without joining another account with the same course ID', async () => {
    const first = await createUser('schema-first'), second = await createUser('schema-second');
    await upsertRow(env.DB, 'courses', first, 'shared', course);
    await upsertRow(env.DB, 'courses', second, 'shared', { ...course, name: 'Private class' });
    await upsertRow(env.DB, 'items', first, 'live', normalizeItem({ id: 'live', title: 'Keep', courseId: 'shared' }));
    const removed = await upsertRow(env.DB, 'items', first, 'deleted', normalizeItem({ id: 'deleted', title: 'Remove' }));
    await deleteRow(env.DB, 'items', first, removed.id, Date.now(), removed.revision);
    const rows = (await env.DB.prepare('SELECT * FROM active_items WHERE user_id = ?').bind(first).all()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'live', course_name: 'Biology' });
    const summary = await env.DB.prepare('SELECT * FROM account_summary WHERE user_id = ?').bind(first).first();
    expect(summary).toMatchObject({ courses: 1, items: 1, quotes: 0 });
    expect(Object.keys(summary).sort()).toEqual(['courses', 'created_at', 'items', 'quotes', 'study_sessions', 'user_id', 'username']);
  });

  it.each([
    ["SELECT id FROM items WHERE user_id = 'u' AND course_id = 'c'", 'items_user_course'],
    ['DELETE FROM login_throttle WHERE updated_at < 100 AND locked_until < 100', 'login_throttle_updated'],
    ['DELETE FROM spotify_oauth_states WHERE expires_at <= 100', 'spotify_oauth_states_expires'],
    ['DELETE FROM spotify_refresh_locks WHERE expires_at <= 100', 'spotify_refresh_locks_expires'],
  ])('uses an index for %s', async (sql, index) => {
    const plan = await env.DB.prepare('EXPLAIN QUERY PLAN ' + sql).all();
    expect(plan.results.some((row) => row.detail.includes(index))).toBe(true);
  });
});
