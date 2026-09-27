import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF } from 'cloudflare:test';
import { BASE, signIn } from './helpers.js';

let client;
const row = { id: 'i1', title: 'Study', revision: 2 };
const respond = (body, status = 200) => vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(status === 204 ? null : JSON.stringify(body), { status })));

beforeEach(async () => {
  vi.resetModules();
  client = await import('../src/legacy/js/api.js');
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
