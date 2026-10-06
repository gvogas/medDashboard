import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace } from './spaces.js';

const FAILS = /CHECK constraint failed/;
/* A raw row, so these tests see the schema's own rules and not the Worker's. */
function invite(spaceId, userId, cols = {}) {
  const row = { invited_by: null, role: 'member', status: 'pending', created_at: 1, expires_at: 2, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO invites (space_id, user_id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`)
    .bind(spaceId, userId, ...Object.values(row)).run();
}
const count = async (spaceId) => (await env.DB.prepare('SELECT count(*) AS n FROM invites WHERE space_id = ?').bind(spaceId).first()).n;

describe('invites in the schema', () => {
  it('keeps one invite per person and space', async () => {
    const a = await createUser('inv-schema-a');
    const s = await makeSpace();
    await invite(s.id, a);
    await expect(invite(s.id, a)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('gives only the two roles an invite can give, its three states, and an expiry after it was made', async () => {
    const b = await createUser('inv-schema-b');
    const s = await makeSpace();
    await expect(invite(s.id, b, { role: 'owner' })).rejects.toThrow(FAILS);
    await expect(invite(s.id, b, { status: 'revoked' })).rejects.toThrow(FAILS);
    await expect(invite(s.id, b, { created_at: 5, expires_at: 5 })).rejects.toThrow(FAILS);
    await invite(s.id, b, { role: 'editor', status: 'declined' });
  });

  it('goes with its space and with the invited account; the inviter leaving keeps it, unsigned', async () => {
    const c = await createUser('inv-schema-c'), boss = await createUser('inv-schema-boss');
    const s = await makeSpace({ members: { [boss]: 'owner' } });
    await invite(s.id, c, { invited_by: boss });
    await expect(invite('nonexistent1', c)).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(boss).run();
    expect(await env.DB.prepare('SELECT invited_by FROM invites WHERE space_id = ? AND user_id = ?').bind(s.id, c).first()).toEqual({ invited_by: null });
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c).run();
    expect(await count(s.id)).toBe(0);
    const d = await createUser('inv-schema-d');
    const t = await makeSpace();
    await invite(t.id, d);
    await env.DB.prepare('DELETE FROM spaces WHERE id = ?').bind(t.id).run();
    expect(await count(t.id)).toBe(0);
  });

  it.each([
    ["SELECT space_id FROM invites WHERE user_id = 'u' AND status = 'pending'", 'invites_user'],
    ['SELECT space_id FROM invites WHERE created_at < 5', 'invites_created'],
  ])('uses an index for %s', async (sql, index) => {
    const plan = await env.DB.prepare('EXPLAIN QUERY PLAN ' + sql).all();
    expect(plan.results.some((row) => row.detail.includes(index))).toBe(true);
  });
});
