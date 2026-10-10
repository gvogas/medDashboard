// Maintenance mode: the admins' switches (GET/PUT /api/admin/maintenance), what /api/me
// tells everyone, and the 503 the Worker answers non-admins on a feature that is switched
// off. Storage is shared within this file, so each test sets the switches it needs.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE, createUser, login, signIn } from './helpers.js';
import { makeSpace } from './spaces.js';

const makeAdmin = (username) => env.DB.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').bind(username).run();

async function signInAdmin(username) {
  await createUser(username);
  await makeAdmin(username);
  const res = await login(username);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = (path, init = {}) => SELF.fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers || {}) },
    body: init.body !== undefined && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body,
  });
  return call;
}

const setFeatures = (features, message = '') => env.DB.prepare(
  "INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = ?1",
).bind(JSON.stringify({ features, message, updatedAt: 1 })).run();

let admin, person;
beforeAll(async () => {
  admin = await signInAdmin('mboss');
  person = await signIn('mperson');
});
beforeEach(() => env.DB.prepare("DELETE FROM app_meta WHERE key = 'maintenance'").run());

describe('the admin routes', () => {
  it('refuse anyone who is not an admin, and anyone signed out', async () => {
    expect((await person('/api/admin/maintenance')).status).toBe(403);
    expect((await person('/api/admin/maintenance', { method: 'PUT', body: { features: [], message: '' } })).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/api/admin/maintenance`)).status).toBe(401);
  });

  it('refuse a change from another site', async () => {
    const res = await admin('/api/admin/maintenance', { method: 'PUT', body: { features: ['week'] }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('start with nothing switched on', async () => {
    expect(await (await admin('/api/admin/maintenance')).json()).toEqual({ maintenance: { features: [], message: '', updatedAt: null, updatedBy: '' } });
  });

  /* admin_log's CHECK lists its actions and changing it needs a migration, so the stored
     value says who switched it last instead */
  it('save the switches and the message, read them back, and say who changed them', async () => {
    const res = await admin('/api/admin/maintenance', { method: 'PUT', body: { features: ['study', 'week', 'week'], message: '  Back by 9 pm.  ' } });
    expect(res.status).toBe(200);
    const saved = (await res.json()).maintenance;
    expect(saved).toMatchObject({ features: ['week', 'study'], message: 'Back by 9 pm.', updatedBy: 'mboss' });
    expect(Number.isSafeInteger(saved.updatedAt)).toBe(true);
    expect((await (await admin('/api/admin/maintenance')).json()).maintenance).toEqual(saved);
  });

  it('turn down unknown features and a bad message', async () => {
    for (const body of [{ features: ['week', 'admin'] }, { features: 'week' }, { features: [1] }, {},
      { features: [], message: 'x'.repeat(281) }, { features: [], message: 5 }]) {
      const res = await admin('/api/admin/maintenance', { method: 'PUT', body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('/api/me', () => {
  it('tells everyone what is in maintenance, and null when nothing is', async () => {
    expect((await (await person('/api/me')).json()).maintenance).toBeNull();
    await admin('/api/admin/maintenance', { method: 'PUT', body: { features: ['spotify', 'import'], message: 'Soon.' } });
    expect((await (await person('/api/me')).json()).maintenance).toMatchObject({ features: ['spotify', 'import'], message: 'Soon.' });
    await admin('/api/admin/maintenance', { method: 'PUT', body: { features: [], message: 'Soon.' } });
    expect((await (await person('/api/me')).json()).maintenance).toBeNull();
  });

  it('shrugs off a stored value it cannot read', async () => {
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', 'not json', 1)").run();
    expect((await (await person('/api/me')).json()).maintenance).toBeNull();
  });
});

describe('the guards', () => {
  const read = (api, path) => api(path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '' });
  const AI = ['/api/outline', '/api/school-calendar', '/api/ai/schedule'];
  let space;
  beforeAll(async () => { space = await makeSpace({ members: { 'u-mperson': 'owner', 'u-mboss': 'editor' } }); });
  const shared = (api) => api(`/api/spaces/${space.id}/courses/web`);

  it('let everything through when nothing is in maintenance', async () => {
    for (const path of AI) expect((await read(person, path)).status, path).toBe(400);   /* the empty body, past the guard */
    expect((await shared(person)).status).toBe(200);
  });

  it('answer non-admins 503 on Import with AI', async () => {
    await setFeatures(['import']);
    for (const path of AI) {
      const res = await read(person, path);
      expect(res.status, path).toBe(503);
      expect(await res.json()).toEqual({ error: 'maintenance', feature: 'import' });
    }
    expect((await person('/api/ai/reads')).status).toBe(503);
    expect((await shared(person)).status).toBe(200);
  });

  it('answer non-admins 503 on shared classes and projects', async () => {
    await setFeatures(['classes']);
    const res = await shared(person);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'maintenance', feature: 'classes' });
    const put = await person(`/api/spaces/${space.id}/items/x1`, { method: 'PUT', headers: { 'if-match': '"0"' }, body: { type: 'assignment', title: 'x', courseId: 'web', date: '2026-10-15', status: 'todo' } });
    expect(put.status).toBe(503);
    expect((await read(person, '/api/outline')).status).toBe(400);
  });

  it('answer non-admins 503 on making, joining and accepting a class while classes are off', async () => {
    await setFeatures(['classes']);
    const course = { code: 'OS', name: 'Operating Systems', color: '#4FBF8B', instructor: '', term: '', meetings: [] };
    for (const [path, body] of [['/api/spaces', { kind: 'class', course }], ['/api/join', { code: '7KQ2M9XD' }], [`/api/invites/${space.id}/accept`, {}]]) {
      const res = await person(path, { method: 'POST', body });
      expect(res.status, path).toBe(503);
      expect(await res.json()).toEqual({ error: 'maintenance', feature: 'classes' });
    }
  });

  it('block both with the whole app switch', async () => {
    await setFeatures(['app']);
    expect(await (await read(person, '/api/outline')).json()).toEqual({ error: 'maintenance', feature: 'app' });
    expect((await shared(person)).status).toBe(503);
  });

  it('let admins through', async () => {
    await setFeatures(['app', 'import', 'classes']);
    for (const path of AI) expect((await read(admin, path)).status, path).toBe(400);
    expect((await shared(admin)).status).toBe(200);
  });

  it('never stop personal data or sync', async () => {
    await setFeatures(['app', 'week', 'month', 'table', 'study', 'spotify', 'import', 'classes']);
    const put = await person('/api/courses/c1', { method: 'PUT', body: { code: 'BIO1', name: 'Biology', color: '#17B3AE' } });
    expect(put.status).toBe(200);
    expect((await person('/api/sync?v=3')).status).toBe(200);
    expect((await person('/api/sync?v=2&cursor=0')).status).toBe(200);
    expect((await person('/api/me')).status).toBe(200);
    expect((await person('/api/calendar')).status).toBe(200);
  });

  it('still answer 401 to someone signed out', async () => {
    await setFeatures(['import', 'classes']);
    const anon = (path, init) => SELF.fetch(`${BASE}${path}`, init);
    expect((await read(anon, '/api/outline')).status).toBe(401);
    expect((await anon(`/api/spaces/${space.id}/courses/web`)).status).toBe(401);
  });
});
