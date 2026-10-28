import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUser, login, signIn, PASSWORD } from './helpers.js';

const BASE = 'http://localhost';

function loginWith(username, password, cookie) {
  return SELF.fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ username, password }),
  });
}

describe('login throttling', () => {
  it('locks a username after repeated failures, even for the right password, then tells you how long', { timeout: 20000 }, async () => {
    await createUser('victim');
    for (let i = 0; i < 5; i++) expect((await login('victim', 'wrong')).status).toBe(401);
    const res = await login('victim', PASSWORD);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('too_many_attempts');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(Number(res.headers.get('retry-after'))).toBe(body.retryAfter);
  });

  it('a success clears the count', { timeout: 20000 }, async () => {
    await createUser('steady');
    for (let i = 0; i < 4; i++) await login('steady', 'wrong');
    expect((await login('steady', PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) await login('steady', 'wrong');
    expect((await login('steady', PASSWORD)).status).toBe(200);
  });

  it('parallel guesses cannot outrun the lock', { timeout: 30000 }, async () => {
    await createUser('burst');
    const results = await Promise.all(Array.from({ length: 12 }, () => login('burst', 'wrong')));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBe(5);
    expect(statuses.filter((s) => s === 429).length).toBe(7);
  });

  // The CAPTCHA only lets one attempt through a lock; that attempt is still counted.
  function attempt(username, password, captcha) {
    return SELF.fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, ...(captcha !== undefined && { captcha }) }),
    });
  }

  it('a passed CAPTCHA lets the right password through a lock', { timeout: 20000 }, async () => {
    await createUser('bolted');
    for (let i = 0; i < 5; i++) await login('bolted', 'wrong');
    expect((await attempt('bolted', PASSWORD)).status).toBe(429);
    expect((await attempt('bolted', PASSWORD, 'pass')).status).toBe(200);
  });

  it('a CAPTCHA-passed attempt that fails re-locks the name', { timeout: 20000 }, async () => {
    await createUser('relock');
    for (let i = 0; i < 5; i++) await login('relock', 'wrong');
    expect((await attempt('relock', 'wrong', 'pass')).status).toBe(401);
    expect((await attempt('relock', PASSWORD)).status).toBe(429);
  });

  it('an unverified CAPTCHA keeps the lock and offers the widget', { timeout: 20000 }, async () => {
    await createUser('guarded');
    for (let i = 0; i < 5; i++) await login('guarded', 'wrong');
    const res = await attempt('guarded', PASSWORD, 'nope');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'too_many_attempts', captchaSiteKey: 'test-turnstile-site-key' });
  });

  it('a stranger cannot lock you out of a browser you have signed in from', { timeout: 30000 }, async () => {
    await createUser('trusted');
    const first = await login('trusted');
    const device = first.headers.getSetCookie().find((c) => c.startsWith('rounds_device='))?.split(';')[0];
    expect(device).toBeTruthy();
    for (let i = 0; i < 8; i++) await login('trusted', 'wrong');
    expect((await login('trusted')).status).toBe(429);
    expect((await loginWith('trusted', PASSWORD, device)).status).toBe(200);
  });

  it('a trusted browser still gets locked by its own failures', { timeout: 30000 }, async () => {
    await createUser('forgetful');
    const device = (await login('forgetful')).headers.getSetCookie().find((c) => c.startsWith('rounds_device=')).split(';')[0];
    for (let i = 0; i < 5; i++) expect((await loginWith('forgetful', 'wrong', device)).status).toBe(401);
    expect((await loginWith('forgetful', PASSWORD, device)).status).toBe(429);
  });

  it('a device cookie for another name or with a bad signature does not get past the lock', { timeout: 30000 }, async () => {
    await createUser('owner');
    await createUser('target');
    const other = (await login('owner')).headers.getSetCookie().find((c) => c.startsWith('rounds_device=')).split(';')[0];
    for (let i = 0; i < 6; i++) await login('target', 'wrong');
    expect((await loginWith('target', PASSWORD, other)).status).toBe(429);
    expect((await loginWith('target', PASSWORD, other.replace('owner', 'target'))).status).toBe(429);
  });

  it('does not lock other usernames', { timeout: 20000 }, async () => {
    await createUser('bystander');
    for (let i = 0; i < 6; i++) await login('someone-else', 'wrong');
    expect((await login('bystander', PASSWORD)).status).toBe(200);
  });
});

describe('request bodies', () => {
  it('a JSON body that is not an object is a 400, not a 500', async () => {
    const api = await signIn();
    for (const [method, path] of [['POST', '/api/login'], ['PUT', '/api/me'], ['PUT', '/api/quotes/q9'], ['POST', '/api/spotify/queue']]) {
      const res = await api(path, { method, body: 'null' });
      expect(res.status, `${method} ${path}`).toBe(400);
    }
  });
});

describe('cross-site requests', () => {
  it('refuses a login posted from another site', async () => {
    const res = await SELF.fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'cross_site' });
  });

  it('refuses a write whose Origin is another site, even with a valid cookie', async () => {
    const api = await signIn();
    const res = await api('/api/quotes/q1', { method: 'PUT', body: { text: 'hi', source: '' }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('accepts same-origin and non-browser writes', async () => {
    const api = await signIn();
    expect((await api('/api/quotes/q2', { method: 'PUT', body: { text: 'hi', source: '' }, headers: { origin: BASE, 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    expect((await api('/api/quotes/q3', { method: 'PUT', body: { text: 'hi', source: '' } })).status).toBe(200);
  });
});

describe('response headers', () => {
  it('API responses are never cached or sniffed', async () => {
    const res = await SELF.fetch(`${BASE}/api/me`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
