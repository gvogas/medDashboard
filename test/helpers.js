import { SELF } from 'cloudflare:test';

export const BASE = 'http://localhost';

/** Sign in through the dev-only route and return a fetch bound to that session. */
export async function signIn(email = 'george@example.com') {
  const res = await SELF.fetch(`${BASE}/api/dev-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (res.status !== 200) throw new Error(`dev-session failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (path, init = {}) =>
    SELF.fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers || {}) },
      body: init.body !== undefined && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body,
    });
}
