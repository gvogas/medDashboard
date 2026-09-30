import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, signIn } from './helpers.js';

describe('auth', () => {
  it('rejects a request with no session', async () => {
    const res = await SELF.fetch(`${BASE}/api/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
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
  it('comes back with defaults and the username, never the password hash', async () => {
    const api = await signIn('george');
    const res = await api('/api/me');
    expect(res.status).toBe(200);
    const profile = await res.json();
    expect(profile).toMatchObject({
      username: 'george',
      displayName: '',
      coat: { name: '', role: '', color: '#17B3AE' },
      theme: 'system',
      bg: 'med',
      termStart: null,
    });
    expect(profile).not.toHaveProperty('passwordHash');
    expect(profile).not.toHaveProperty('password_hash');
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

  it('PUT /api/me saves the background, and keeps it when an older client leaves it out', async () => {
    const api = await signIn();
    const body = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };
    let res = await api('/api/me', { method: 'PUT', body: { ...body, bg: 'law' } });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.bg).toBe('law');
    res = await api('/api/me', { method: 'PUT', body: { ...body, bg: 'nope' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'bg' });
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
