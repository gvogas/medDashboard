import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace } from './spaces.js';
import { purgeTombstones } from '../worker/db.js';
import { databaseChecks, databaseCountsSql, summarizeDatabase } from '../scripts/lib/database-health.js';

const FAILS = /CHECK constraint failed/;
/* Raw rows, so these tests see the schema's own rules and not the Worker's. */
function mark(userId, spaceId, itemId, cols = {}) {
  const row = { id: spaceId + ':' + itemId, space_id: spaceId, item_id: itemId, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO marks (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .bind(userId, ...Object.values(row)).run();
}
function pref(userId, spaceId, cols = {}) {
  const row = { id: spaceId, space_id: spaceId, color: '#17B3AE', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO space_prefs (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .bind(userId, ...Object.values(row)).run();
}
const count = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()).n;

describe('marks and space prefs in the schema', () => {
  it("key a mark by '<space>:<item>' and hold it to the rules of the item's own columns", async () => {
    const a = await createUser('ms-a');
    const s = await makeSpace({ members: { [a]: 'member' } });
    await mark(a, s.id, 'a1', { status: 'graded', grade: 91, weight: 25, notes: 'mine', checklist: '[{"id":"x","text":"L1","done":true}]', hidden: 1 });
    await expect(mark(a, s.id, 'a2', { id: s.id + ':other' })).rejects.toThrow(FAILS);
    await expect(mark(a, 'short', 'a3')).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a4', { status: 'started' })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a5', { grade: 101 })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a6', { hidden: 2 })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a7', { checklist: '{}' })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a1')).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('keep one prefs row per person and space, in the twelve course colours', async () => {
    const b = await createUser('ms-b');
    const s = await makeSpace({ members: { [b]: 'member' } });
    await expect(pref(b, s.id, { id: 'otherspace01' })).rejects.toThrow(FAILS);
    await expect(pref(b, s.id, { color: '#000000' })).rejects.toThrow(FAILS);
    await expect(pref(b, s.id, { target: 0 })).rejects.toThrow(FAILS);
    await expect(pref(b, s.id, { term: 'x'.repeat(41) })).rejects.toThrow(FAILS);
    await pref(b, s.id, { target: 80, term: 'Fall 2026', archived: 1 });
    await expect(pref(b, s.id)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("write every change into the person's own feed, never the space's", async () => {
    const c = await createUser('ms-c');
    const s = await makeSpace({ members: { [c]: 'member' } });
    await mark(c, s.id, 'q1', { hidden: 1 });
    await pref(c, s.id);
    const feed = () => env.DB.prepare("SELECT scope, kind, row_id, json_extract(payload, '$.hidden') AS hidden FROM changes WHERE kind IN ('marks', 'space_prefs') AND scope = ? ORDER BY kind").bind('u:' + c).all();
    expect((await feed()).results).toEqual([
      { scope: 'u:' + c, kind: 'marks', row_id: s.id + ':q1', hidden: 1 },
      { scope: 'u:' + c, kind: 'space_prefs', row_id: s.id, hidden: null },
    ]);
    await env.DB.prepare('UPDATE marks SET hidden = 0, revision = revision + 1 WHERE user_id = ?').bind(c).run();
    expect((await feed()).results[0].hidden).toBe(0);
    expect(await count("SELECT count(*) AS n FROM changes WHERE scope = ?", s.scope)).toBe(1);   /* only the class course */
  });

  it('count as tracked rows in the health checks, so their change rows are not orphans', async () => {
    const report = summarizeDatabase(await env.DB.batch([...databaseChecks.map((c) => env.DB.prepare(c.sql)), env.DB.prepare(databaseCountsSql)]));
    expect(report.checks.find((c) => c.name === 'Change-feed orphans').issues).toBe(0);
    expect(report.checks.find((c) => c.name === 'Change-feed record coverage').issues).toBe(0);
    expect(report.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['marks', 'space_prefs']));
  });

  it('go with the account, and their tombstones with the nightly purge', async () => {
    const d = await createUser('ms-d'), e = await createUser('ms-e');
    const s = await makeSpace({ members: { [d]: 'member', [e]: 'member' } });
    await mark(d, s.id, 'a1');
    await pref(d, s.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM changes WHERE scope = 'u:' || ?").bind(d),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(d),
    ]);
    expect(await count('SELECT count(*) AS n FROM marks WHERE user_id = ?', d) + await count('SELECT count(*) AS n FROM space_prefs WHERE user_id = ?', d)).toBe(0);
    await mark(e, s.id, 'a1', { deleted_at: 5 });
    await pref(e, s.id, { deleted_at: 5 });
    await purgeTombstones(env.DB, 10);
    expect(await count('SELECT count(*) AS n FROM marks WHERE user_id = ?', e) + await count('SELECT count(*) AS n FROM space_prefs WHERE user_id = ?', e)).toBe(0);
  });

  it("find a person's marks in a space by an index", async () => {
    const plan = await env.DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM marks WHERE user_id = 'u' AND space_id = 's'").all();
    expect(plan.results.some((row) => /USING .*INDEX.*space_id=\?/.test(row.detail))).toBe(true);
  });
});
