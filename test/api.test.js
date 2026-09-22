import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, signIn } from './helpers.js';

describe('auth', () => {
  it('rejects a request with no session', async () => {
    const res = await SELF.fetch(`${BASE}/api/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('dev login sets an HttpOnly session cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/dev-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'George@Example.com' }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/^rounds_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('dev login is refused off localhost', async () => {
    const res = await SELF.fetch('http://rounds.example.workers.dev/api/dev-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'george@example.com' }),
    });
    expect(res.status).toBe(404);
  });

  it('a tampered cookie is unauthenticated', async () => {
    const res = await SELF.fetch(`${BASE}/api/me`, {
      headers: { cookie: 'rounds_session=abc.9999999999999.deadbeef' },
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/session clears the cookie', async () => {
    const api = await signIn();
    const res = await api('/api/session', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/rounds_session=;.*Max-Age=0/);
  });
});

describe('profile', () => {
  it('is created on first sign-in with defaults and a lower-cased email', async () => {
    const api = await signIn('George@Example.com');
    const res = await api('/api/me');
    expect(res.status).toBe(200);
    const profile = await res.json();
    expect(profile).toMatchObject({
      email: 'george@example.com',
      displayName: '',
      coat: { name: '', role: '', color: '#17B3AE' },
      theme: 'system',
      termStart: null,
      importedAt: null,
    });
    expect(typeof profile.id).toBe('string');
    expect(profile.id).not.toContain('@');
  });

  it('signing in twice returns the same user', async () => {
    const a = await signIn('same@example.com');
    const b = await signIn('same@example.com');
    const [pa, pb] = await Promise.all([a('/api/me').then(r => r.json()), b('/api/me').then(r => r.json())]);
    expect(pa.id).toBe(pb.id);
  });

  it('PUT /api/me updates coat, theme and term start', async () => {
    const api = await signIn();
    const res = await api('/api/me', {
      method: 'PUT',
      body: { coat: { name: 'G. Vogas', role: 'MS II', color: '#E4749B' }, theme: 'dark', termStart: '2026-09-01', displayName: 'George' },
    });
    expect(res.status).toBe(200);
    const profile = await res.json();
    expect(profile.coat).toEqual({ name: 'G. Vogas', role: 'MS II', color: '#E4749B' });
    expect(profile.theme).toBe('dark');
    expect(profile.termStart).toBe('2026-09-01');
    expect(profile.displayName).toBe('George');
    expect(profile.updatedAt).toBeGreaterThan(0);
  });

  it('PUT /api/me rejects a bad coat colour and names the field', async () => {
    const api = await signIn();
    const res = await api('/api/me', {
      method: 'PUT',
      body: { coat: { name: '', role: '', color: '#000000' }, theme: 'dark', termStart: null, displayName: '' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'coat.color' });
  });
});
