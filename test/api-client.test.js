import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF } from 'cloudflare:test';
import { BASE, signIn } from './helpers.js';
import { makeSpace } from './spaces.js';

let client;
const row = { id: 'i1', title: 'Study', revision: 2 };
const respond = (body, status = 200) => vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(status === 204 ? null : JSON.stringify(body), { status })));

beforeEach(async () => {
  vi.resetModules();
  client = await import('../src/core/api.ts');
});
afterEach(() => { client.resetRequests(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('browser API response contracts', () => {
  it.each(['<html>Unavailable</html>', '', 'null', 'true'])('rejects an unusable successful response: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(client.api.put('items', row.id, { ...row, revision: 1 })).rejects.toMatchObject({ status: 502 });
  });

  it.each([{}, null, { ...row, id: 'another-item' }, { ...row, revision: 1 }, { ...row, revision: '2' }])(
    'requires acknowledgement of the requested row with a newer revision: %j', async (body) => {
      respond(body);
      await expect(client.api.put('items', row.id, { ...row, revision: 1 })).rejects.toMatchObject({ status: 502 });
    },
  );

  it('rejects an empty write response and accepts a valid acknowledgement', async () => {
    respond(null, 204);
    await expect(client.api.put('items', row.id, row)).rejects.toMatchObject({ status: 502 });
    respond(row);
    expect(await client.api.put('items', row.id, { ...row, revision: 1 })).toEqual(row);
  });

  it('requires an empty successful response to acknowledge a deletion', async () => {
    respond({});
    await expect(client.api.del('items', row.id, 1)).rejects.toMatchObject({ status: 502 });
    respond(null, 204);
    expect(await client.api.del('items', row.id, 1)).toBeNull();
  });

  it('does not open an invalid profile or accept another account', async () => {
    respond({});
    await expect(client.api.me()).rejects.toMatchObject({ status: 502 });
    client.bindAccount('u1');
    respond({ id: 'u2', revision: 1 });
    await expect(client.api.me()).rejects.toMatchObject({ status: 502 });
  });

  const page = { reset: false, cursor: 2, more: false, changes: [{ kind: 'items', row }] };
  it.each([
    {}, { ...page, cursor: -1 }, { ...page, cursor: 0 }, { ...page, more: true, cursor: 1 },
    { ...page, changes: null }, { ...page, changes: [{ kind: 'meta', row }] },
    { ...page, changes: [{ kind: 'items', row: {} }] },
    { reset: true, cursor: 0, more: false, changes: [{ kind: 'items', row }] },
  ])('rejects an invalid change page before reconciliation: %j', async (body) => {
    respond(body);
    await expect(client.api.sync(1)).rejects.toMatchObject({ status: 502 });
  });

  it('accepts valid pages and rejects a reset loop', async () => {
    respond(page);
    expect(await client.api.sync(1)).toEqual(page);
    const reset = { reset: true, cursor: 0, more: false, changes: [] };
    respond(reset);
    expect(await client.api.sync(1)).toEqual(reset);
    await expect(client.api.sync(0)).rejects.toMatchObject({ status: 502 });
  });

  it('preserves HTTP errors even if their bodies are not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable', {
      status: 503, headers: { 'retry-after': '90' },
    })));
    await expect(client.api.me()).rejects.toMatchObject({ status: 503, retryAfter: 90 });
  });

  it('accepts the real Worker profile, write, change-feed, and deletion responses', async () => {
    const session = await signIn();
    // Workers fetch has no browser-style redirect:error mode. These API routes
    // never redirect; expose any unexpected redirect instead of following it.
    vi.stubGlobal('fetch', (path, options) => SELF.fetch(BASE + path, {
      ...options, redirect: 'manual', headers: { ...options.headers, cookie: session.cookie },
    }));
    const profile = await client.api.me();
    client.bindAccount(profile.id);
    const updated = await client.api.saveMe({ ...profile, displayName: 'Student' });
    expect(updated.revision).toBeGreaterThan(profile.revision);
    const saved = await client.api.put('quotes', 'contract-check', { text: 'Keep studying', source: '', revision: 0 });
    expect(await client.api.get('quotes', saved.id)).toEqual(saved);
    const page = await client.api.sync(0);
    expect(page.changes).toContainEqual({ kind: 'quotes', row: saved });
    await client.api.del('quotes', saved.id, saved.revision);
    const deleted = await client.api.sync(page.cursor);
    expect(deleted.changes[0].row.deletedAt).toBeTypeOf('number');
    await expect(client.api.get('quotes', saved.id)).rejects.toMatchObject({ status: 404 });
    expect(await client.api.signOut()).toBeNull();
  });

  it('accepts the real Worker v3 page and shared writes, and refuses a v3 cursor that moves back', async () => {
    const session = await signIn();
    vi.stubGlobal('fetch', (path, options) => SELF.fetch(BASE + path, {
      ...options, redirect: 'manual', headers: { ...options.headers, cookie: session.cookie },
    }));
    const profile = await client.api.me();
    client.bindAccount(profile.id);
    const web = await makeSpace({ members: { [profile.id]: 'owner' } });
    const own = 'u:' + profile.id;
    const first = await client.api.syncV3({ [own]: 0 }, 0);
    expect(first.scopes).toMatchObject([{ id: web.id, scope: web.scope, role: 'owner', members: [{ userId: profile.id }] }]);
    expect(first.changes).toContainEqual(expect.objectContaining({ scope: web.scope, kind: 'courses' }));
    const saved = await client.api.shared.put(web.scope, 'items', 'a1',
      { type: 'assignment', title: 'Lab report', courseId: 'web', date: '2026-10-15', status: 'todo', revision: 0 }, { title: null });
    expect(saved).toMatchObject({ id: 'a1', scope: web.scope, updatedBy: profile.id });
    expect(await client.api.shared.get(web.scope, 'items', 'a1')).toEqual(saved);
    const next = await client.api.syncV3(first.cursors, first.scopes[0].revision);
    expect(next.changes).toEqual([{ scope: web.scope, kind: 'items', row: saved }]);
    expect(next.scopes[0]).not.toHaveProperty('members');
    expect(await client.api.shared.del(web.scope, 'items', 'a1', saved.revision)).toBeNull();
    respond({ ...next, cursors: { [own]: 0 } });
    await expect(client.api.syncV3({ [own]: 5 }, 0)).rejects.toMatchObject({ status: 502 });
    respond({ ...next, changes: [{ scope: own, kind: 'marks', row: saved }] });
    await expect(client.api.syncV3({}, 0)).rejects.toMatchObject({ status: 502 });
  });

  it('stops an AI read when its own signal is aborted, and sends a picture as it is', async () => {
    let seen;
    vi.stubGlobal('fetch', vi.fn((path, init) => {
      seen = { path, init };
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    }));
    const stop = new AbortController();
    const read = client.api.readSchedule(new Blob(['x'], { type: 'image/jpeg' }), { name: 't.png', today: '2026-10-01' }, stop.signal);
    stop.abort(new DOMException('Stopped', 'AbortError'));
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen.path).toBe('/api/ai/schedule?name=t.png&today=2026-10-01');
    expect(seen.init.headers['content-type']).toBe('image/jpeg');
  });

  it('sends what the app knows with an AI read', async () => {
    respond({});
    await client.api.readOutline(new Blob(['x'], { type: 'text/plain' }), { name: 'o.pdf', today: '2026-10-01', termStart: '', terms: 'Fall 2026|Winter 2027', codes: 'CHEM271' });
    expect(fetch.mock.calls[0][0]).toBe('/api/outline?name=o.pdf&today=2026-10-01&terms=Fall+2026%7CWinter+2027&codes=CHEM271');
  });

  it('asks how many AI reads are left', async () => {
    respond({ left: 7, limit: 10 });
    expect(await client.api.aiReads()).toEqual({ left: 7, limit: 10 });
    expect(fetch.mock.calls[0][0]).toBe('/api/ai/reads');
  });
});

describe('browser API cancellation', () => {
  it('bounds a stalled request and allows the next request to succeed', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((path, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })));
    const result = client.api.me().catch((error) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    respond({ id: 'u1', revision: 1 });
    expect(await client.api.me()).toMatchObject({ id: 'u1' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active while reading the response body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (path, { signal }) => ({
      status: 200, ok: true,
      json: () => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    })));
    const result = client.api.me().catch((error) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
  });

  it('rejects a delayed response from an old account even if fetch ignores abort', async () => {
    let finish;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    client.bindAccount('u1');
    const result = client.api.me().catch((error) => error);
    client.bindAccount('u2');
    finish(new Response(JSON.stringify({ id: 'u1', revision: 1 })));
    expect(await result).toMatchObject({ name: 'AbortError' });
  });
});
