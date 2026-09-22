import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { signSession } from '../worker/auth.js';
import { createUser, login, signIn, PASSWORD } from './helpers.js';

const BASE = 'http://localhost';
const DAY = 24 * 60 * 60 * 1000;

async function cookieFor(username) {
  const res = await login(username);
  return res.headers.get('set-cookie').split(';')[0];
}

describe('GET /api/{kind}/:id', () => {
  it('returns one of my rows, and 404 for anyone else’s or a missing one', async () => {
    const alice = await signIn();
    const bob = await signIn();
    await alice('/api/quotes/q1', { method: 'PUT', body: { text: 'mine', source: '' } });
    const mine = await alice('/api/quotes/q1');
    expect(mine.status).toBe(200);
    expect((await mine.json()).text).toBe('mine');
    expect((await bob('/api/quotes/q1')).status).toBe(404);
    expect((await alice('/api/quotes/nope')).status).toBe(404);
  });
});

describe('session renewal', () => {
  it('re-issues the cookie when it is in its last week', async () => {
    const id = await createUser('renewer');
    const old = await signSession(id, 0, env.SESSION_SECRET, Date.now() - 25 * DAY);   // 5 days left
    const res = await SELF.fetch(`${BASE}/api/me`, { headers: { cookie: `rounds_session=${old}` } });
    expect(res.status).toBe(200);
    const fresh = res.headers.get('set-cookie');
    expect(fresh).toMatch(/^rounds_session=/);
    expect(fresh.split(';')[0]).not.toBe(`rounds_session=${old}`);
  });

  it('leaves a young cookie alone', async () => {
    await createUser('young');
    const cookie = await cookieFor('young');
    const res = await SELF.fetch(`${BASE}/api/me`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('an expired cookie is unauthenticated', async () => {
    const id = await createUser('expired');
    const old = await signSession(id, 0, env.SESSION_SECRET, Date.now() - 31 * DAY);
    const res = await SELF.fetch(`${BASE}/api/me`, { headers: { cookie: `rounds_session=${old}` } });
    expect(res.status).toBe(401);
  });
});

describe('password generation', () => {
  it('a password reset signs every existing session out', async () => {
    await createUser('resetter');
    const cookie = await cookieFor('resetter');
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: { cookie } })).status).toBe(200);
    await env.DB.prepare("UPDATE users SET pw_gen = pw_gen + 1 WHERE username = 'resetter'").run();   // what user:add --reset does
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: { cookie } })).status).toBe(401);
    const again = await login('resetter', PASSWORD);
    expect(again.status).toBe(200);
  });

  it('POST /api/session/revoke-all signs out everywhere, including here', async () => {
    await createUser('everywhere');
    const phone = await cookieFor('everywhere');
    const laptop = await cookieFor('everywhere');
    const res = await SELF.fetch(`${BASE}/api/session/revoke-all`, { method: 'POST', headers: { cookie: laptop } });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: { cookie: phone } })).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: { cookie: laptop } })).status).toBe(401);
  });
});
