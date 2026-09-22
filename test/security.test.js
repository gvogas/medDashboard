import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUser, login, signIn, PASSWORD } from './helpers.js';

const BASE = 'http://localhost';

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

  it('does not lock other usernames', { timeout: 20000 }, async () => {
    await createUser('bystander');
    for (let i = 0; i < 6; i++) await login('someone-else', 'wrong');
    expect((await login('bystander', PASSWORD)).status).toBe(200);
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
