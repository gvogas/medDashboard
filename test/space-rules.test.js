import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, spaceRevision } from './spaces.js';
import { MY_SPACES, LIVE_MEMBERS, randomId, spaceSummary, touchSpace } from '../worker/spaces.js';
import { assertOwner, ownerGuard } from '../worker/access.js';
import { normalizeCode, REVIEW_ID } from '../src/core/shared.ts';

describe('what the class routes share', () => {
  it('makes ids of [a-z0-9], twelve by default, different each time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{12}$/);
    expect(randomId(5)).toMatch(/^[a-z0-9]{5}$/);
  });

  it('reads a join code the way people type it', () => {
    expect(normalizeCode('7kq2 m9xd')).toBe('7KQ2M9XD');
    expect(normalizeCode('7KQ2-M9XD')).toBe('7KQ2M9XD');
    expect(normalizeCode('OIL0abcd')).toBe('0110ABCD');
    expect(normalizeCode('7KQ2M9X')).toBeNull();
    expect(normalizeCode('7KQ2M9XU')).toBeNull();
    expect(normalizeCode(12345678)).toBeNull();
  });

  it('knows a lecture review by its id', () => {
    expect(REVIEW_ID.test('rvab12cd31')).toBe(true);
    expect(REVIEW_ID.test('rvab12cd35')).toBe(false);
    expect(REVIEW_ID.test('abc1234')).toBe(false);
  });

  it('moves a space revision only when the statement before it changed a row, if asked', async () => {
    const s = await makeSpace();
    const before = await spaceRevision(s.id);
    await env.DB.batch([env.DB.prepare('UPDATE spaces SET updated_at = 3 WHERE id = ? AND 0').bind(s.id), touchSpace(env.DB, s.id, 5, { ifChanged: true })]);
    expect(await spaceRevision(s.id)).toBe(before);
    await env.DB.batch([env.DB.prepare('UPDATE spaces SET updated_at = 3 WHERE id = ?').bind(s.id), touchSpace(env.DB, s.id, 5, { ifChanged: true })]);
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
  });

  it('sums a space up for the person in it, and nothing for anyone else', async () => {
    const a = await createUser('rules-a'), b = await createUser('rules-b');
    const s = await makeSpace({ members: { [a]: 'owner' } });
    expect(await spaceSummary(env.DB, a, s.id)).toEqual({ id: s.id, scope: s.scope, kind: 'class', name: 'Web Services', role: 'owner', members: 1 });
    expect(await spaceSummary(env.DB, b, s.id)).toBeNull();
  });

  it('lets only the owner past assertOwner, and counts live spaces and members', async () => {
    const o = await createUser('rules-o'), e = await createUser('rules-e');
    const s = await makeSpace({ members: { [o]: 'owner', [e]: 'editor' } });
    expect(await assertOwner(env.DB, o, s.id)).toMatchObject({ role: 'owner' });
    await expect(assertOwner(env.DB, e, s.id)).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const mine = ownerGuard(s.id, o), theirs = ownerGuard(s.id, e);
    expect((await env.DB.prepare(`SELECT ${mine.sql} AS ok`).bind(...mine.binds).first()).ok).toBe(1);
    expect((await env.DB.prepare(`SELECT ${theirs.sql} AS ok`).bind(...theirs.binds).first()).ok).toBe(0);
    expect((await env.DB.prepare(`SELECT ${MY_SPACES} AS n`).bind(o).first()).n).toBe(1);
    expect((await env.DB.prepare(`SELECT ${LIVE_MEMBERS('?')} AS n`).bind(s.id).first()).n).toBe(2);
  });
});
