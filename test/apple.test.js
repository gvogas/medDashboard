import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { appleRoutes, makeNonce, verifyIdentityToken } from '../worker/apple.js';
import { createUser, signIn, login, PASSWORD } from './helpers.js';

const BASE = 'http://localhost';
const APP = 'capacitor://localhost';
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const part = (o) => b64url(enc.encode(JSON.stringify(o)));

/** An identity token as Apple would sign it, with the test key vitest.config.js made. */
async function appleToken(claims = {}, { kid = 'test-kid', key = env.APPLE_TEST_SIGNING_KEY } = {}) {
  const jwk = JSON.parse(key);
  const signer = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: 'RS256', kid })}.${part({ iss: 'https://appleid.apple.com', aud: 'net.vogas.term', sub: 'apple-sub-1', iat: now, exp: now + 600, email: 'x@privaterelay.appleid.com', ...claims })}`;
  return `${body}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, enc.encode(body)))}`;
}

const nonce = async () => (await (await SELF.fetch(`${BASE}/api/login/apple/nonce`)).json()).nonce;
const appleLogin = (body, headers = {}) => SELF.fetch(`${BASE}/api/login/apple`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function signedBody(sub, extra = {}) {
  const n = await nonce();
  return { idToken: await appleToken({ sub, nonce: n }), nonce: n, ...extra };
}

describe('identity tokens', () => {
  const keys = async () => (await (await fetch('https://appleid.apple.com/auth/keys')).json()).keys;

  it('accepts Apple’s signature, our audience and our nonce, and nothing else', async () => {
    const n = await makeNonce(env.SESSION_SECRET);
    const opts = { keys: await keys(), audiences: ['net.vogas.term'], nonce: n };
    expect(await verifyIdentityToken(await appleToken({ nonce: n }), opts)).toMatchObject({ sub: 'apple-sub-1', aud: 'net.vogas.term' });
    for (const claims of [{ nonce: 'other' }, { nonce: n, aud: 'com.someone.else' }, { nonce: n, iss: 'https://evil.example' }, { nonce: n, exp: 1 }]) {
      await expect(verifyIdentityToken(await appleToken(claims), opts)).rejects.toMatchObject({ status: 401 });
    }
    await expect(verifyIdentityToken(await appleToken({ nonce: n }, { kid: 'unknown' }), opts)).rejects.toMatchObject({ status: 401 });
    // a token signed by any other key
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
    const forged = JSON.stringify(await crypto.subtle.exportKey('jwk', other.privateKey));
    await expect(verifyIdentityToken(await appleToken({ nonce: n }, { key: forged }), opts)).rejects.toMatchObject({ status: 401 });
    await expect(verifyIdentityToken('not.a.token', opts)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a nonce this Worker did not make, or an old one', async () => {
    const forged = `${Date.now()}.${'a'.repeat(24)}.${'b'.repeat(64)}`;
    expect((await appleLogin({ idToken: await appleToken({ nonce: forged }), nonce: forged })).status).toBe(401);
    const old = await makeNonce(env.SESSION_SECRET, Date.now() - 11 * 60 * 1000);
    expect((await appleLogin({ idToken: await appleToken({ nonce: old }), nonce: old })).status).toBe(401);
  });
});

describe('Sign in with Apple', () => {
  it('an unknown Apple ID gets no account while sign-up is closed', async () => {
    const res = await appleLogin(await signedBody('apple-nobody'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('no_account');
  });

  it('links to the signed-in account, then signs in to it on the web and in the app', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    expect(await (await api('/api/apple')).json()).toEqual({ available: true, linked: false, email: '' });
    const link = await api('/api/login/apple', { method: 'POST', body: { ...(await signedBody('apple-ana')), link: true, authorizationCode: 'c1' } });
    expect(link.status).toBe(200);
    expect(await (await api('/api/apple')).json()).toMatchObject({ linked: true, email: 'x@privaterelay.appleid.com' });
    const row = await env.DB.prepare('SELECT refresh_token FROM apple_accounts WHERE sub = ?').bind('apple-ana').first();
    expect(row.refresh_token).toBeTruthy();
    expect(row.refresh_token).not.toContain('apple-refresh');     /* stored sealed */

    const web = await appleLogin(await signedBody('apple-ana'));
    expect(web.status).toBe(200);
    expect(web.headers.get('set-cookie')).toMatch(/^rounds_session=/);
    expect((await web.json()).id).toBe(me.id);

    const app = await appleLogin(await signedBody('apple-ana', { client: 'app' }), { origin: APP, 'sec-fetch-site': 'cross-site' });
    const body = await app.json();
    expect(body.id).toBe(me.id);
    expect(body.token).toMatch(new RegExp(`^${me.id}\\.`));
    expect(app.headers.get('set-cookie')).toBeNull();
  });

  it('one Apple ID per account, and an Apple ID on one account only', async () => {
    const a = await signIn();
    const b = await signIn();
    await a('/api/login/apple', { method: 'POST', body: { ...(await signedBody('apple-shared')), link: true } });
    expect((await b('/api/login/apple', { method: 'POST', body: { ...(await signedBody('apple-shared')), link: true } })).status).toBe(409);
    expect((await a('/api/login/apple', { method: 'POST', body: { ...(await signedBody('apple-second')), link: true } })).status).toBe(409);
  });

  it('linking needs a session', async () => {
    expect((await appleLogin({ ...(await signedBody('apple-anon')), link: true })).status).toBe(401);
  });

  it('with sign-up open, a new Apple ID gets an account with no password, deletable with Apple', async () => {
    const [, , handler] = appleRoutes.find(([m, re]) => m === 'POST' && re.test('/api/login/apple'));
    const request = new Request(`${BASE}/api/login/apple`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(await signedBody('apple-new')), givenName: 'Zoë', familyName: 'Ng' }) });
    const res = await handler({ request, env: { ...env, SIGNUPS: 'open' }, url: new URL(request.url) });
    expect(res.status).toBe(200);
    const profile = await res.json();
    expect(profile.username).toMatch(/^zoe\d{4}$/);
    expect(profile.displayName).toBe('Zoë Ng');
    expect((await login(profile.username, '')).status).toBe(401);      /* no password signs in */
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const del = (body) => SELF.fetch(`${BASE}/api/me`, { method: 'DELETE', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    expect((await del({ confirm: profile.username, ...(await signedBody('apple-someone-else')) })).status).toBe(403);
    expect((await del({ confirm: profile.username, ...(await signedBody('apple-new')) })).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 FROM apple_accounts WHERE sub = 'apple-new'").first()).toBeNull();
  });

  it('a password account still deletes with its password, and its Apple link goes with it', async () => {
    await createUser('appledel');
    const cookie = (await login('appledel')).headers.get('set-cookie').split(';')[0];
    const call = (path, body, method = 'POST') => SELF.fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    await call('/api/login/apple', { ...(await signedBody('apple-del')), link: true, authorizationCode: 'c2' });
    expect((await call('/api/me', { confirm: 'appledel', password: PASSWORD }, 'DELETE')).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 FROM apple_accounts WHERE sub = 'apple-del'").first()).toBeNull();
  });
});
