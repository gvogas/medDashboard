import { SELF, env } from 'cloudflare:test';
import { hashPassword } from '../worker/password.js';

export const BASE = 'http://localhost';
export const PASSWORD = 'open sesame';

// Storage is shared within a test file, so every sign-in gets its own user by default.
let n = 0;
let hashPromise = null;

/** Create a user row directly, the way scripts/add-user.mjs does, and return its id. */
export async function createUser(username, displayName = '') {
  hashPromise ||= hashPassword(PASSWORD);
  const id = 'u-' + username;
  await env.DB
    .prepare('INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, username, await hashPromise, displayName, Date.now(), Date.now())
    .run();
  return id;
}

export function login(username, password = PASSWORD) {
  return SELF.fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** Create a user, sign in, and return a fetch bound to that session. */
export async function signIn(username = `user${++n}`) {
  await createUser(username);
  const res = await login(username);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const revisions = new Map([['/api/me', (await res.clone().json()).revision]]);
  const call = async (path, init = {}) => {
    const conditional = ['PUT', 'DELETE'].includes(init.method) && (/^\/api\/(courses|items|quotes|study_sessions)\//.test(path) || path === '/api/me');
    const response = await SELF.fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie,
        ...(conditional ? { 'if-match': `"${revisions.get(path) || 0}"` } : {}), ...(init.headers || {}) },
      body: init.body !== undefined && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body,
    });
    if (response.ok && response.status !== 204) {
      const body = await response.clone().json();
      if (body.revision) revisions.set(path, body.revision);
    }
    if (response.status === 204 && conditional && init.method === 'DELETE') revisions.set(path, (revisions.get(path) || 0) + 1);
    return response;
  };
  call.cookie = cookie;   // for a test that has to send a second cookie alongside
  return call;
}
