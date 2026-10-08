import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { signSession } from '../worker/auth.js';
import { parseVersion, assertAppVersion } from '../worker/app.js';
import { createUser, login, PASSWORD } from './helpers.js';

const BASE = 'http://localhost';
const APP = 'capacitor://localhost';
const DAY = 24 * 60 * 60 * 1000;

function appLogin(username, extra = {}) {
  return SELF.fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ username, password: PASSWORD, client: 'app', ...extra }),
  });
}

const appFetch = (path, token, init = {}) => SELF.fetch(`${BASE}${path}`, {
  ...init,
  headers: { origin: APP, 'sec-fetch-site': 'cross-site', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
});

describe('app sign-in', () => {
  it('answers with a token and a device mark, and sets no cookie', async () => {
    await createUser('appuser');
    const res = await appLogin('appuser');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    const body = await res.json();
    expect(body.username).toBe('appuser');
    expect(body.token).toMatch(/^u-appuser\.0\.\d+\.[0-9a-f]{64}$/);
    expect(body.device).toMatch(/^[0-9a-f]{24}\.[0-9a-f]{64}$/);
    // a trusted device is not given a new mark
    const again = await (await appLogin('appuser', { device: body.device })).json();
    expect(again.device).toBeUndefined();
  });

  it('the token works as a bearer and the browser cookie does not, from the app', async () => {
    await createUser('bearer');
    const { token } = await (await appLogin('bearer')).json();
    const me = await appFetch('/api/me', token);
    expect(me.status).toBe(200);
    expect((await me.json()).username).toBe('bearer');
    const cookie = (await login('bearer')).headers.get('set-cookie').split(';')[0];
    expect((await appFetch('/api/me', null, { headers: { cookie } })).status).toBe(401);
  });

  it('can write with the token from the app origin', async () => {
    await createUser('writer');
    const { token } = await (await appLogin('writer')).json();
    const res = await appFetch('/api/quotes/q1', token, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"0"' }, body: JSON.stringify({ text: 'hi', source: '' }),
    });
    expect(res.status).toBe(200);
  });

  it('refuses an unknown client and another site still', async () => {
    await createUser('clientx');
    const bad = await SELF.fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'clientx', password: PASSWORD, client: 'tv' }) });
    expect(bad.status).toBe(400);
    const evil = await SELF.fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ username: 'clientx', password: PASSWORD }) });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a renewed session comes back as a token, not a cookie', async () => {
    const id = await createUser('renewapp');
    const old = await signSession(id, 0, env.SESSION_SECRET, Date.now() - 25 * DAY);
    const res = await appFetch('/api/me', old);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    const { token } = await res.json();
    expect(token).toBeTruthy();
    expect(token).not.toBe(old);
  });

  it('sign out everywhere ends the app token too', async () => {
    await createUser('revoker');
    const { token } = await (await appLogin('revoker')).json();
    expect((await appFetch('/api/session/revoke-all', token, { method: 'POST' })).status).toBe(204);
    expect((await appFetch('/api/me', token)).status).toBe(401);
  });
});

describe('CORS preflight', () => {
  it('answers the app origin and refuses others', async () => {
    const ok = await SELF.fetch(`${BASE}/api/me`, { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'PUT' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(APP);
    expect(ok.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const no = await SELF.fetch(`${BASE}/api/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(no.status).toBe(403);
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('app version', () => {
  it('parses plain versions only', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('2.0')).toEqual([2, 0, 0]);
    expect(parseVersion('1.2.3-beta')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('asks a build older than MIN_APP_VERSION to update', () => {
    const req = (v) => new Request(BASE, { headers: { 'x-rounds-app': v } });
    const min = { MIN_APP_VERSION: '1.3.0' };
    expect(() => assertAppVersion(req('1.2.9'), min)).toThrow(expect.objectContaining({ status: 426 }));
    expect(() => assertAppVersion(req('1.3.0'), min)).not.toThrow();
    expect(() => assertAppVersion(req('2.0'), min)).not.toThrow();
    expect(() => assertAppVersion(req('0.1'), {})).not.toThrow();
  });

  it('refuses a malformed version and lets the browser through without one', async () => {
    await createUser('versioned');
    const { token } = await (await appLogin('versioned')).json();
    expect((await appFetch('/api/me', token, { headers: { 'x-rounds-app': 'banana' } })).status).toBe(400);
    expect((await appFetch('/api/me', token, { headers: { 'x-rounds-app': '1.0.0' } })).status).toBe(200);
  });
});

describe('the paywall follows the client', () => {
  it('the app is told whether the paywall applies, and the website never is', async () => {
    const { fromApp } = await import('../worker/app.js');
    expect(fromApp(new Request(BASE, { headers: { origin: APP } }))).toBe(true);
    expect(fromApp(new Request(BASE, { headers: { 'x-rounds-app': '1.0.0' } }))).toBe(true);
    expect(fromApp(new Request(BASE, { headers: { origin: BASE } }))).toBe(false);
    await createUser('planclient');
    const { token } = await (await appLogin('planclient')).json();
    // PAYWALL is off in the tests, so neither sees it; the unit tests in plans.test.js turn it on
    expect((await (await appFetch('/api/plan', token)).json()).paywall).toBe(false);
  });
});
