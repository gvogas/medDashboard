import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { API_LIMIT, SPOTIFY_LIMIT, OUTLINE_DAILY_LIMIT, claimLimit, cooldownRemaining, setCooldown, purgeLimits, readsLeft } from '../worker/limits.js';
import { handleApi } from '../worker/api.js';
import { BASE, signIn } from './helpers.js';

/** A rate-limiting binding that refuses the keys in `full`. */
const limiter = (full = []) => ({ limit: async ({ key }) => ({ success: !full.includes(key) }) });
const call = (api, e, path, init = {}) => handleApi(new Request(BASE + path, { ...init, headers: { cookie: api.cookie } }), e, new URL(BASE + path));

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
    const e = { ...env, API_LIMITER: limiter(['u-limit-general']) };
    const res = await call(api, e, '/api/me');
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await signIn('limit-other');
    expect((await call(other, e, '/api/me')).status).toBe(200);
  });

  it('limits Spotify separately while leaving the player poll, SDK tokens and disconnect available', async () => {
    const api = await signIn('limit-spotify');
    const e = { ...env, SPOTIFY_LIMITER: limiter(['u-limit-spotify']) };
    expect((await call(api, e, '/api/spotify/devices')).status).toBe(429);
    expect((await call(api, e, '/api/spotify/player/pause', { method: 'POST' })).status).toBe(429);
    // The background player poll is bounded by the API limit only.
    expect(await (await call(api, e, '/api/spotify/player')).json()).toEqual({ connected: false });
    expect(await (await call(api, e, '/api/spotify/status')).json()).toEqual({ connected: false });
    expect((await call(api, e, '/api/spotify/connect', { redirect: 'manual' })).status).toBe(302);
    expect((await call(api, e, '/api/spotify/token')).status).toBe(409);
    expect((await call(api, e, '/api/spotify', { method: 'DELETE' })).status).toBe(204);
    expect((await call(api, e, '/api/me')).status).toBe(200);
  });

  it('has the bindings from wrangler.jsonc, at the limits limits.js names', async () => {
    expect(typeof env.API_LIMITER?.limit).toBe('function');
    expect(typeof env.SPOTIFY_LIMITER?.limit).toBe('function');
    expect([API_LIMIT, SPOTIFY_LIMIT]).toEqual([600, 60]);
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

describe('AI reads left', () => {
  it('counts the reads of the window down, and comes back when it ends', async () => {
    const api = await signIn('reads-left');
    expect(await (await api('/api/ai/reads')).json()).toEqual({ left: OUTLINE_DAILY_LIMIT, limit: OUTLINE_DAILY_LIMIT });
    await env.DB.prepare('INSERT INTO request_limits VALUES (?, ?, ?)').bind('outline:u-reads-left', 3, Date.now() + 60000).run();
    expect(await (await api('/api/ai/reads')).json()).toEqual({ left: OUTLINE_DAILY_LIMIT - 3, limit: OUTLINE_DAILY_LIMIT });
    expect(await readsLeft(env.DB, 'u-reads-left', Date.now() + 61000)).toEqual({ left: OUTLINE_DAILY_LIMIT, limit: OUTLINE_DAILY_LIMIT });
  });
});

describe('the error log on the response path', () => {
  it('is written after the answer, through ctx.waitUntil', async () => {
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    const path = '/api/no-such-route-waituntil';
    const res = await handleApi(new Request(BASE + path), env, new URL(BASE + path), ctx);
    expect(res.status).toBe(404);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM error_log WHERE route = ?').bind(path).first()).toEqual({ n: 1 });
  });
});
