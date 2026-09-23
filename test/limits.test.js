import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { API_LIMIT, SPOTIFY_LIMIT, claimLimit, cooldownRemaining, setCooldown, purgeLimits } from '../worker/limits.js';
import { BASE, signIn } from './helpers.js';

describe('shared request limits', () => {
  it('admits only the configured number of simultaneous requests', async () => {
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, () => claimLimit(env.DB, 'test:burst', 5, now)));
    expect(results.filter((wait) => wait === 0)).toHaveLength(5);
    expect(results.filter((wait) => wait === 60)).toHaveLength(15);
    expect(await claimLimit(env.DB, 'test:burst', 5, now + 59999)).toBe(1);
    expect(await claimLimit(env.DB, 'test:burst', 5, now + 60000)).toBe(0);
    expect(await claimLimit(env.DB, 'test:other', 5, now)).toBe(0);
  });

  it('enforces the general API budget and isolates users', async () => {
    const api = await signIn('limit-general');
    await env.DB.prepare('INSERT INTO request_limits VALUES (?, ?, ?)').bind('api:u-limit-general', API_LIMIT, Date.now() + 60000).run();
    const res = await api('/api/me');
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await signIn('limit-other');
    expect((await other('/api/me')).status).toBe(200);
  });

  it('limits Spotify separately while leaving SDK tokens and disconnect available', async () => {
    const api = await signIn('limit-spotify');
    await env.DB.prepare('INSERT INTO request_limits VALUES (?, ?, ?)').bind('spotify:u-limit-spotify', SPOTIFY_LIMIT, Date.now() + 60000).run();
    expect((await api('/api/spotify/player')).status).toBe(429);
    expect(await (await api('/api/spotify/status')).json()).toEqual({ connected: false });
    expect((await api('/api/spotify/connect', { redirect: 'manual' })).status).toBe(302);
    expect((await api('/api/spotify/token')).status).toBe(409);
    expect((await api('/api/spotify', { method: 'DELETE' })).status).toBe(204);
    expect((await api('/api/me')).status).toBe(200);
  });

  it('bounds username spraying by the edge IP, ignoring spoofed forwarding headers', async () => {
    const call = (ip, name) => SELF.fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': name },
      body: JSON.stringify({ username: '!', password: 'bad' }),
    });
    for (let i = 0; i < 30; i++) expect((await call('192.0.2.12', String(i))).status).toBe(401);
    expect((await call('192.0.2.12', 'new')).status).toBe(429);
    expect((await call('192.0.2.13', 'new')).status).toBe(401);
  });

  it('cannot shorten a shared cooldown and removes expired windows', async () => {
    const now = Date.now();
    await setCooldown(env.DB, 'test:cooldown', 120, now);
    await setCooldown(env.DB, 'test:cooldown', 5, now);
    expect(await cooldownRemaining(env.DB, 'test:cooldown', now)).toBe(120);
    await purgeLimits(env.DB, now + 120000);
    expect(await cooldownRemaining(env.DB, 'test:cooldown', now)).toBe(0);
  });
});
