import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, setMember, spaceRevision } from './spaces.js';
import { assertAllowed, editorGuard, memberGuard, parseScope, roleOf, scopeOf, writerGuard } from '../worker/access.js';
import { touchSpace } from '../worker/spaces.js';
import { upsertRow } from '../worker/db.js';

const check = async (g) => (await env.DB.prepare(`SELECT ${g.sql} AS ok`).bind(...g.binds).first()).ok;
/* [read, write as a member, write as an editor] */
const row = async (space, user) => [await check(memberGuard(space.id, user)), await check(writerGuard(space.id, user)), await check(editorGuard(space.id, user))];

describe('scopes', () => {
  it('parse the three kinds and refuse anything else', () => {
    expect(parseScope('u:u-ana')).toEqual({ kind: 'user', userId: 'u-ana' });
    expect(parseScope('c:abcdefghij12')).toEqual({ kind: 'class', spaceId: 'abcdefghij12' });
    expect(parseScope('p:abcdefghij12')).toEqual({ kind: 'project', spaceId: 'abcdefghij12' });
    for (const bad of ['', 'u:', 'c:short', 'c:ABCDEFGHIJ12', 'x:abcdefghij12', 'c:abcdefghij123', 'u:a,b', 'u:' + 'x'.repeat(39), 42, null]) {
      expect(parseScope(bad)).toBeNull();
    }
    expect(scopeOf('class', 'abcdefghij12')).toBe('c:abcdefghij12');
    expect(scopeOf('project', 'abcdefghij12')).toBe('p:abcdefghij12');
  });
});

describe('the guards', () => {
  it('let each role do what spec §5 allows, in a live space and an archived one', async () => {
    const ids = {};
    for (const name of ['owner', 'editor', 'member', 'left', 'outsider']) ids[name] = await createUser('ac-' + name);
    const live = await makeSpace({ members: { [ids.owner]: 'owner', [ids.editor]: 'editor', [ids.member]: 'member', [ids.left]: 'member' } });
    await setMember(live.id, ids.left, null);
    const archived = await makeSpace({ archived: 1, members: { [ids.owner]: 'owner', [ids.member]: 'member' } });
    expect(await row(live, ids.owner)).toEqual([1, 1, 1]);
    expect(await row(live, ids.editor)).toEqual([1, 1, 1]);
    expect(await row(live, ids.member)).toEqual([1, 1, 0]);
    expect(await row(live, ids.left)).toEqual([0, 0, 0]);
    expect(await row(live, ids.outsider)).toEqual([0, 0, 0]);
    expect(await row(archived, ids.owner)).toEqual([1, 0, 0]);
    expect(await row(archived, ids.member)).toEqual([1, 0, 0]);
  });

  it('see nothing of a deleted space', async () => {
    const owner = await createUser('ac-deleted');
    const s = await makeSpace({ members: { [owner]: 'owner' } });
    await env.DB.prepare('UPDATE spaces SET deleted_at = 5 WHERE id = ?').bind(s.id).run();
    expect(await row(s, owner)).toEqual([0, 0, 0]);
    expect(await roleOf(env.DB, owner, s.id)).toBeNull();
  });

  it('explain a refusal: 404 outside the space, 403 archived, 403 forbidden', async () => {
    const owner = await createUser('ac-why-owner'), member = await createUser('ac-why-member'), outsider = await createUser('ac-why-out');
    const s = await makeSpace({ kind: 'project', members: { [owner]: 'owner', [member]: 'member' } });
    expect(await roleOf(env.DB, member, s.id)).toEqual({ kind: 'project', role: 'member', archived: false });
    await expect(assertAllowed(env.DB, outsider, s.id, 'read')).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await expect(assertAllowed(env.DB, member, s.id, 'editor')).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect(await assertAllowed(env.DB, member, s.id, 'write')).toMatchObject({ role: 'member' });
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(s.id).run();
    expect(await assertAllowed(env.DB, member, s.id, 'read')).toMatchObject({ archived: true });
    await expect(assertAllowed(env.DB, owner, s.id, 'editor')).rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });
});

describe('space revisions', () => {
  it('move above every other space and the change feed, even when no row changed', async () => {
    const owner = await createUser('ac-revision');
    const a = await makeSpace({ members: { [owner]: 'owner' } }), b = await makeSpace({ members: { [owner]: 'owner' } });
    expect(await spaceRevision(b.id)).toBeGreaterThan(await spaceRevision(a.id));
    await touchSpace(env.DB, a.id).run();
    expect(await spaceRevision(a.id)).toBeGreaterThan(await spaceRevision(b.id));
    const saved = await upsertRow(env.DB, 'quotes', owner, 'q', { text: 'Go', source: '' });
    await touchSpace(env.DB, b.id).run();
    expect(await spaceRevision(b.id)).toBeGreaterThan(saved.revision);
  });
});
