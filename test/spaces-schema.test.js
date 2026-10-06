import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';

const FAILS = /CHECK constraint failed/;
/* Raw rows, so these tests see the schema's own rules and not the Worker's. */
function space(id, kind = 'class', cols = {}) {
  const row = { kind, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO spaces (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .bind(id, ...Object.values(row)).run();
}
const member = (spaceId, userId, role) => env.DB.prepare(
  'INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, 1, 1)',
).bind(spaceId, userId, role).run();

describe('spaces and members in the schema', () => {
  it('takes 12-character Worker-made ids and the two kinds only', async () => {
    await space('aaaaaaaaaaa1');
    await space('aaaaaaaaaaa2', 'project');
    await expect(space('short')).rejects.toThrow(FAILS);
    await expect(space('AAAAAAAAAAA3')).rejects.toThrow(FAILS);
    await expect(space('aaaaaaaaaa-4')).rejects.toThrow(FAILS);
    await expect(space('aaaaaaaaaaa5', 'group')).rejects.toThrow(FAILS);
  });

  it('keeps the school calendar on classes and the parent link, whole, on projects', async () => {
    await space('bbbbbbbbbbb1', 'class', { school_calendar: '{"terms":[]}' });
    await space('bbbbbbbbbbb2', 'project', { parent_space: 'bbbbbbbbbbb1', parent_item: 'a1' });
    await expect(space('bbbbbbbbbbb3', 'project', { school_calendar: '{}' })).rejects.toThrow(FAILS);
    await expect(space('bbbbbbbbbbb4', 'class', { parent_space: 'bbbbbbbbbbb1', parent_item: 'a1' })).rejects.toThrow(FAILS);
    await expect(space('bbbbbbbbbbb5', 'project', { parent_space: 'bbbbbbbbbbb1' })).rejects.toThrow(FAILS);
    await expect(space('bbbbbbbbbbb6', 'class', { school_calendar: '[1]' })).rejects.toThrow(FAILS);
  });

  it('allows one live owner per space, and only the three roles', async () => {
    const a = await createUser('space-owner-a'), b = await createUser('space-owner-b');
    await space('ccccccccccc1');
    await member('ccccccccccc1', a, 'owner');
    await expect(member('ccccccccccc1', b, 'owner')).rejects.toThrow(/UNIQUE constraint failed/);
    await member('ccccccccccc1', b, 'editor');
    await env.DB.prepare("UPDATE members SET deleted_at = 5 WHERE space_id = 'ccccccccccc1' AND user_id = ?").bind(a).run();
    await env.DB.prepare("UPDATE members SET role = 'owner' WHERE space_id = 'ccccccccccc1' AND user_id = ?").bind(b).run();
    await expect(env.DB.prepare("UPDATE members SET role = 'admin' WHERE space_id = 'ccccccccccc1' AND user_id = ?").bind(b).run()).rejects.toThrow(FAILS);
  });

  it('ties each membership to a real space and a real account', async () => {
    const a = await createUser('space-fk');
    await expect(member('nonexistent1', a, 'member')).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await space('ddddddddddd1');
    await expect(member('ddddddddddd1', 'u-nobody', 'member')).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it.each([
    ["SELECT space_id FROM members WHERE user_id = 'u' AND deleted_at IS NULL", 'members_user'],
    ["SELECT id FROM spaces WHERE code_hash = 'x'", 'spaces_code'],
    ['SELECT MAX(revision) FROM spaces', 'spaces_revision'],
  ])('uses an index for %s', async (sql, index) => {
    const plan = await env.DB.prepare('EXPLAIN QUERY PLAN ' + sql).all();
    expect(plan.results.some((row) => row.detail.includes(index))).toBe(true);
  });
});
