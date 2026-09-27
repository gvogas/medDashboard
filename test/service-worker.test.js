import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let events, cache, respondWith, waits;
beforeEach(async () => {
  vi.resetModules();
  events = {};
  cache = { match: vi.fn(), put: vi.fn(async () => {}), addAll: vi.fn(async () => {}) };
  vi.stubGlobal('self', { addEventListener: (name, fn) => { events[name] = fn; }, clients: { claim: vi.fn() } });
  vi.stubGlobal('location', { origin: 'https://rounds.test' });
  vi.stubGlobal('caches', { open: vi.fn(async () => cache), keys: vi.fn(async () => ['rounds-shell-0123456789abcdef', 'rounds-shell-dev', 'another-app']), delete: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('asset')));
  await import('../public/sw.js');
});
afterEach(() => vi.unstubAllGlobals());

async function request(path, mode = 'cors') {
  waits = [];
  respondWith = vi.fn();
  events.fetch({ request: { url: 'https://rounds.test' + path, method: 'GET', mode },
    respondWith, waitUntil: (promise) => waits.push(promise),
  });
  const response = respondWith.mock.calls[0] ? await respondWith.mock.calls[0][0] : null;
  await Promise.all(waits);
  return response;
}

describe('service worker cache policy', () => {
  it('never intercepts API responses or arbitrary resources', async () => {
    for (const path of ['/api', '/api/me', '/api/spotify/token', '/private-data', '/icon.svg?unique=1']) {
      await request(path);
      expect(respondWith, path).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caches known shell assets only', async () => {
    expect((await request('/icon.svg')).status).toBe(200);
    expect(cache.put).toHaveBeenCalledOnce();
    await request('/other-page', 'navigate');
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it.each(['no-store', 'private, max-age=60'])('respects upstream Cache-Control: %s', async (policy) => {
    fetch.mockResolvedValue(new Response('private', { headers: { 'cache-control': policy } }));
    await request('/index.html', 'navigate');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('uses the current cache during a server outage', async () => {
    fetch.mockResolvedValue(new Response('down', { status: 503 }));
    cache.match.mockResolvedValue(new Response('cached'));
    expect(await (await request('/icon.svg')).text()).toBe('cached');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('returns an explicit response when offline with no cached asset', async () => {
    fetch.mockRejectedValue(new TypeError('offline'));
    expect((await request('/icon.svg')).status).toBe(503);
  });

  it('does not let a failed cache write break a network response', async () => {
    cache.put.mockRejectedValue(new Error('quota'));
    expect((await request('/icon.svg')).status).toBe(200);
  });

  it('only removes obsolete caches belonging to this app', async () => {
    let done;
    events.activate({ waitUntil: (promise) => { done = promise; } });
    await done;
    expect(caches.delete.mock.calls).toEqual([['rounds-shell-0123456789abcdef']]);
  });
});
