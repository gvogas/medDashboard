import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { upsertRow, deleteRow, syncPage } from '../worker/db.js';
import { normalizeItem } from '../public/js/model.js';

it('upgrades existing items without changing their data, revisions, or sync history, and rolls back failed copies', async () => {
  const db = env.MIGRATION_DB;
  const index = env.TEST_MIGRATIONS.findIndex((migration) => migration.name.startsWith('0007_'));
  expect(index).toBeGreaterThan(0);
  await applyD1Migrations(db, env.TEST_MIGRATIONS.slice(0, index));
  for (const id of ['legacy-1', 'legacy-2']) {
    await db.prepare('INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, 100, 100)')
      .bind(id, id, 'test-only').run();
    await upsertRow(db, 'courses', id, 'shared', {
      code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: 'Tutor', term: 'Autumn', archived: false, meetings: [],
    }, 100);
    await upsertRow(db, 'items', id, 'shared', normalizeItem({
      id: 'shared', title: 'Study: α & β', type: 'assignment', courseId: 'shared', date: '2026-10-03',
      start: '09:00', end: '10:00', where: 'Lab', status: 'graded', grade: 95, weight: 20,
      notes: 'Keep every field\nand newline.', checklist: [{ id: 'step', text: 'Review', done: true }],
      links: [{ label: 'Notes', url: 'https://example.edu/notes' }], recur: 'weekly', weekday: 6,
      recurUntil: '2026-12-05', dept: 'Biology', completedAt: 200,
    }), 200);
  }
  const tombstone = await upsertRow(db, 'items', 'legacy-1', 'deleted', normalizeItem({ id: 'deleted', title: 'Old work' }), 150);
  await deleteRow(db, 'items', 'legacy-1', 'deleted', 200, tombstone.revision);
  const snapshot = async () => ({
    items: (await db.prepare('SELECT * FROM items ORDER BY user_id, id').all()).results,
    changes: (await db.prepare('SELECT * FROM changes ORDER BY seq').all()).results,
    sequence: await db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'").first(),
    floor: await db.prepare('SELECT floor FROM sync_state').first(),
  });

  // Old SQLite constraints allowed a zero revision. An upgrade must fail intact
  // when a copied row violates the new constraint, not leave half a schema.
  const saved = await db.prepare("SELECT revision FROM items WHERE user_id = 'legacy-1' AND id = 'shared'").first();
  await db.prepare("UPDATE items SET revision = 0 WHERE user_id = 'legacy-1' AND id = 'shared'").run();
  const invalid = await snapshot();
  await expect(applyD1Migrations(db, [env.TEST_MIGRATIONS[index]])).rejects.toThrow(/CHECK constraint failed/);
  expect(await snapshot()).toEqual(invalid);
  expect(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'items_next'").first()).toBeNull();
  await db.prepare("UPDATE items SET revision = ? WHERE user_id = 'legacy-1' AND id = 'shared'").bind(saved.revision).run();

  const before = await snapshot();
  const cursor = (await syncPage(db, 'legacy-1', 0)).cursor;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.slice(index));
  expect(await snapshot()).toEqual(before);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  expect((await syncPage(db, 'legacy-1', cursor)).changes).toEqual([]);
  const item = before.items.find((row) => row.user_id === 'legacy-1' && row.id === 'shared');
  await deleteRow(db, 'items', 'legacy-1', item.id, 300, item.revision);
  expect((await syncPage(db, 'legacy-1', cursor)).changes).toEqual([
    { kind: 'items', row: expect.objectContaining({ id: item.id, deletedAt: 300, revision: item.revision + 1 }) },
  ]);
});
