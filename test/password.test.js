import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, verifyPassword, normalizeUsername } from '../worker/password.js';
import { createUser, login } from './helpers.js';
import { throttleRowsFor } from '../worker/throttle.js';
import addUserScript from '../scripts/add-user.mjs?raw';

describe('password hashing', () => {
  it('round-trips and rejects the wrong password', { timeout: 20000 }, async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapler', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently twice', { timeout: 20000 }, async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('survives a malformed stored hash', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
});

describe('normalizeUsername', () => {
  it('lower-cases and trims, and refuses anything odd', () => {
    expect(normalizeUsername(' Student1 ')).toBe('student1');
    expect(normalizeUsername('a.b-c_d')).toBe('a.b-c_d');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('has space')).toBeNull();
    expect(normalizeUsername('.leading')).toBeNull();
    expect(normalizeUsername('x'.repeat(33))).toBeNull();
  });
});

describe('POST /api/login', () => {
  beforeAll(async () => {
    await createUser('student1', 'Student One');
  });

  it('signs in with the right password and sets the session cookie', async () => {
    const res = await login('student1');
    expect(res.status).toBe(200);
    const profile = await res.json();
    expect(profile.username).toBe('student1');
    expect(profile.displayName).toBe('Student One');
    expect(res.headers.get('set-cookie')).toMatch(/^rounds_session=.*HttpOnly/);
    const me = await SELF.fetch('http://localhost/api/me', { headers: { cookie: res.headers.get('set-cookie').split(';')[0] } });
    expect((await me.json()).username).toBe('student1');
  });

  it('is case-insensitive on the username', async () => {
    expect((await login('Student1')).status).toBe(200);
  });

  it('rejects the wrong password and an unknown user the same way', async () => {
    const a = await login('student1', 'nope');
    const b = await login('nobody');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual({ error: 'bad_login' });
    expect(await b.json()).toEqual({ error: 'bad_login' });
  });

  it('rejects a missing field', async () => {
    const res = await SELF.fetch('http://localhost/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'student1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('npm run user:add -- --reset / --delete', () => {
  it("clears the name's sign-in throttle, its own row and its trusted devices'", async () => {
    const names = ['a_b', 'a_b#0123456789abcdef01234567', 'axb#0123456789abcdef01234567', 'a_bc', 'a_bc#0123456789abcdef01234567'];
    await env.DB.batch(names.map((n) => env.DB.prepare('INSERT INTO login_throttle (username, fails, locked_until, updated_at) VALUES (?, 5, 0, 0)').bind(n)));
    await env.DB.prepare(`DELETE FROM login_throttle WHERE ${throttleRowsFor('a_b')}`).run();
    const left = await env.DB.prepare('SELECT username FROM login_throttle ORDER BY username').all();
    expect(left.results.map((r) => r.username).filter((n) => names.includes(n))).toEqual(['a_bc', 'a_bc#0123456789abcdef01234567', 'axb#0123456789abcdef01234567']);
  });

  it('is what the script runs on a reset and a delete', () => {
    expect(addUserScript.match(/DELETE FROM login_throttle WHERE \$\{throttleRowsFor\(username\)\}/g)).toHaveLength(2);
  });
});
