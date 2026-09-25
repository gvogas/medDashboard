import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { upsertRow, deleteRow, syncPage } from '../worker/db.js';
import { normalizeItem, normalizeCourse } from '../public/js/model.js';
import { readQueries, copyStatements } from '../scripts/lib/move-db.js';

async function dump(db) {
  const out = {};
  for (const [name, sql] of readQueries()) {
    const rows = (await db.prepare(sql).all()).results;
    out[name] = name === 'state' ? rows[0] : rows;
  }
  return out;
}

it('copies an old-schema database into a fresh one, row for row, with the change feed and its head', async () => {
  const from = env.MIGRATION_DB, to = env.MOVE_DB;
  await applyD1Migrations(from, env.LEGACY_MIGRATIONS);
  await applyD1Migrations(to, env.TEST_MIGRATIONS);
  // The rows below are written with today's worker/db.js, whose deletes also unlink
  // study sessions (migration 0002); the old schema only needs the empty table for that.
  await from.prepare('CREATE TABLE study_sessions (user_id TEXT, id TEXT, course_id TEXT, item_id TEXT, deleted_at INTEGER, updated_at INTEGER, revision INTEGER)').run();

  for (const id of ['ana', 'ben']) {
    await from.prepare("INSERT INTO users (id, username, password_hash, types, created_at, updated_at, imported_at) VALUES (?, ?, 'hash', '[{\"id\":\"c-quiz1\",\"label\":\"Quiz\",\"color\":\"#B03A7A\",\"kind\":\"graded\"}]', 100, 100, 50)")
      .bind(id, id).run();
    await upsertRow(from, 'courses', id, 'bio', normalizeCourse({ id: 'bio', code: 'BIO', name: "Biology 'n' more", color: '#17B3AE', meetings: [{ id: 'm', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: 'Hall B' }] }), 200);
    await upsertRow(from, 'items', id, 'mid', normalizeItem({
      id: 'mid', title: 'Midterm: α & β', type: 'exam', courseId: 'bio', date: '2026-10-05', start: '09:00', end: '10:00',
      where: 'Hall B', status: 'graded', grade: 87.5, weight: 20, notes: "Line one\nline 'two'",
      checklist: [{ id: 's', text: 'Review', done: true }], links: [{ label: 'Notes', url: 'https://example.edu' }],
    }), 210);
    await upsertRow(from, 'items', id, 'q', normalizeItem({ id: 'q', title: 'Quiz', type: 'c-quiz1', date: '2026-10-06' }), 220);
    await upsertRow(from, 'quotes', id, 'k', { text: 'Keep going', source: '' }, 230);
  }
  const gone = await upsertRow(from, 'items', 'ana', 'old', normalizeItem({ id: 'old', title: 'Old' }), 240);
  await deleteRow(from, 'items', 'ana', 'old', 250, gone.revision);
  /* a later write replaces an earlier change, so the head sits above the last kept seq */
  const bio = await upsertRow(from, 'courses', 'ben', 'extra', normalizeCourse({ id: 'extra', code: 'X', name: 'Extra', color: '#8B5CC7' }), 260);
  await upsertRow(from, 'courses', 'ben', 'extra', normalizeCourse({ id: 'extra', code: 'X', name: 'Extra 2', color: '#8B5CC7' }), 270, bio.revision);
  await from.prepare("INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES ('ana', 'enc', 'acc', 999, 280)").run();
  await from.prepare('UPDATE sync_state SET floor = 2 WHERE id = 1').run();
  await from.prepare("INSERT INTO login_throttle (username, fails, updated_at) VALUES ('ana', 3, 1)").run();
  const head = (await from.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'").first()).seq;
  await from.prepare("INSERT INTO changes (seq, user_id, kind, row_id, payload) VALUES (?, 'ana', 'x', 'x', '{}')").bind(head + 5).run();
  await from.prepare("DELETE FROM changes WHERE kind = 'x'").run();

  const source = await dump(from);
  expect(source.state.head).toBeGreaterThan(Math.max(...source.changes.map((c) => c.seq)));
  await to.batch(copyStatements(source).map((sql) => to.prepare(sql)));
  const copied = await dump(to);

  expect(copied).toEqual(source);
  expect((await to.prepare('SELECT count(*) AS n FROM login_throttle').first()).n).toBe(0);
  expect(await to.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
  for (const cursor of [0, 3]) {
    expect(await syncPage(to, 'ben', cursor, 50)).toEqual(await syncPage(from, 'ben', cursor, 50));
  }
  /* the next write in the copy numbers on from the old head */
  const next = await upsertRow(to, 'quotes', 'ana', 'n', { text: 'New', source: '' }, 300);
  expect(next.revision).toBe(source.state.head + 1);
  /* and the twelve colours are accepted there */
  await upsertRow(to, 'courses', 'ana', 'c12', normalizeCourse({ id: 'c12', code: 'SL', name: 'Slate', color: '#7D8A99' }), 310);
});
