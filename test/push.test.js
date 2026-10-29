import { SELF, env, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index.js';
import { b64u, digest, localNow, pushOnce, sendDigests, unb64u, validTz, vapidAuth } from '../worker/push.js';
import { BASE, login, signIn } from './helpers.js';

const FCM = 'https://fcm.googleapis.com/fcm/send/';
const subs = (userId) => env.DB.prepare('SELECT endpoint, tz, failures, last_sent_day, last_ok_at FROM push_subscriptions WHERE user_id = ? ORDER BY endpoint').bind(userId).all().then((r) => r.results);
const idOf = async (api) => (await (await api('/api/me')).json()).id;
const item = (over) => ({ id: 'i', type: 'assignment', title: 'Essay', course_id: null, date: '2026-10-20', start: '', status: 'todo', recur: null, ...over });

describe('the digest', () => {
  const courses = [{ id: 'bio', code: 'BIO' }];

  it('says what is due today and tomorrow, and what is overdue', () => {
    const d = digest({ courses, items: [
      item({ id: 'a', type: 'exam', title: 'Midterm', course_id: 'bio', start: '09:00' }),
      item({ id: 'b', title: 'Lab report' }),
      item({ id: 'c', date: '2026-10-21' }), item({ id: 'd', date: '2026-10-21', title: 'Poster' }),
      item({ id: 'e', date: '2026-10-18', title: 'Reading' }),
    ] }, '2026-10-20');
    expect(d).toEqual({ title: '2 due today', body: 'Today: BIO Midterm 09:00 · Lab report\nTomorrow: Essay · Poster\nOverdue: Reading', today: 2, tomorrow: 2, overdue: 1 });
  });

  it('leaves out what is closed, weekly, an event or long overdue, and shortens a long day', () => {
    const quiet = digest({ courses, items: [
      item({ status: 'done' }), item({ status: 'missed' }), item({ type: 'office', recur: 'weekly' }), item({ type: 'tutoring' }), item({ date: '2026-09-01' }),
    ] }, '2026-10-20');
    expect(quiet).toMatchObject({ title: 'Nothing due today', today: 0, tomorrow: 0, overdue: 0 });
    const busy = digest({ courses, items: [1, 2, 3, 4, 5].map((n) => item({ id: 'x' + n, title: 'T' + n })) }, '2026-10-20');
    expect(busy.body).toBe('Today: T1 · T2 · T3 · +2 more');
    expect(digest({ courses, items: [item({ date: '2026-10-19' }), item({ date: '2026-10-10' })] }, '2026-10-20').body).toBe('2 overdue');
  });

  it('works out the local day and hour, and refuses a zone that is not one', () => {
    const at = Date.UTC(2026, 9, 20, 5, 30);
    expect(localNow('Europe/Athens', at)).toEqual({ day: '2026-10-20', hour: 8 });
    expect(localNow('America/Los_Angeles', at)).toEqual({ day: '2026-10-19', hour: 22 });
    expect(validTz('UTC')).toBe('UTC');
    for (const bad of ['Mars/Olympus', 'Evil\r\nX', 'a'.repeat(70), 7, null]) expect(validTz(bad)).toBeNull();
  });
});

describe('VAPID', () => {
  it('signs an ES256 JWT for the push service that its public key verifies', async () => {
    const at = Date.UTC(2026, 9, 20);
    const header = await vapidAuth(env, FCM + 'abc', at);
    const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(k).toBe(env.VAPID_PUBLIC_KEY);
    const [h, c, s] = t.split('.');
    const read = (part) => JSON.parse(new TextDecoder().decode(unb64u(part)));
    expect(read(h)).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(read(c)).toEqual({ aud: 'https://fcm.googleapis.com', exp: at / 1000 + 12 * 3600, sub: 'mailto:tests@example.com' });
    const pub = await crypto.subtle.importKey('raw', unb64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(unb64u(s)).toHaveLength(64);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(s), new TextEncoder().encode(h + '.' + c))).toBe(true);
    expect(b64u(unb64u('AQID_-8'))).toBe('AQID_-8');
  });

  it('sends an empty push and reads the answer', async () => {
    expect(await pushOnce(env, FCM + 'ok1')).toBe('ok');
    expect(await pushOnce(env, FCM + 'gone1')).toBe('gone');
    expect(await pushOnce(env, FCM + 'broken')).toBe('failed');
  });
});

describe('the push routes', () => {
  it('give the key, save a device with its zone, and remove it', async () => {
    const api = await signIn(), me = await idOf(api);
    expect(await (await api('/api/push/key')).json()).toEqual({ enabled: true, key: env.VAPID_PUBLIC_KEY });
    expect((await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-a', tz: 'Europe/Athens' } })).status).toBe(204);
    expect((await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-a', tz: 'Europe/London' } })).status).toBe(204);
    expect(await subs(me)).toMatchObject([{ endpoint: FCM + 'ok-a', tz: 'Europe/London', failures: 0 }]);
    expect((await api('/api/push', { method: 'DELETE', body: { endpoint: FCM + 'ok-a' } })).status).toBe(204);
    expect(await subs(me)).toEqual([]);
  });

  it('refuse an address that is not a push service, a bad zone, and anyone signed out', async () => {
    const api = await signIn();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm', 'https://fcm.googleapis.com.evil.example/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'nope', 42]) {
      const res = await api('/api/push', { method: 'POST', body: { endpoint, tz: 'UTC' } });
      expect(await res.json(), String(endpoint)).toEqual({ error: 'invalid', field: 'endpoint' });
    }
    expect(await (await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok', tz: 'Nowhere/Land' } })).json()).toEqual({ error: 'invalid', field: 'tz' });
    for (const [method, path] of [['GET', '/api/push/key'], ['POST', '/api/push'], ['DELETE', '/api/push'], ['GET', '/api/digest']]) {
      expect((await SELF.fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })).status, path).toBe(401);
    }
  });

  it('go with the account', async () => {
    const api = await signIn(), me = await idOf(api);
    await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-gone-with', tz: 'UTC' } });
    await env.DB.batch([env.DB.prepare('PRAGMA foreign_keys = ON'), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me)]);
    expect(await subs(me)).toEqual([]);
  });

  it('keep the newest five devices, hold a device while its owner is signed in, and move it once they sign out', async () => {
    const api = await signIn(), other = await signIn(), me = await idOf(api), them = await idOf(other);
    for (const n of [1, 2, 3, 4, 5, 6]) await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-five-' + n, tz: 'UTC' } });
    expect((await subs(me)).map((s) => s.endpoint.slice(-1))).toEqual(['2', '3', '4', '5', '6']);
    await other('/api/push', { method: 'DELETE', body: { endpoint: FCM + 'ok-five-6' } });
    expect(await subs(me)).toHaveLength(5);
    expect((await other('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-five-6', tz: 'UTC' } })).status).toBe(409);
    expect(await subs(me)).toHaveLength(5);
    await api('/api/session', { method: 'DELETE' });
    await other('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-five-6', tz: 'UTC' } });
    expect(await subs(me)).toHaveLength(4);
    expect((await subs(them)).map((s) => s.endpoint)).toEqual([FCM + 'ok-five-6']);
  });

  it('send a test push to your own device only, and drop one the service says is gone', async () => {
    const api = await signIn(), other = await signIn(), me = await idOf(api);
    await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-test', tz: 'UTC' } });
    await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'gone-test', tz: 'UTC' } });
    expect((await other('/api/push/test', { method: 'POST', body: { endpoint: FCM + 'ok-test' } })).status).toBe(404);
    expect(await (await api('/api/push/test', { method: 'POST', body: { endpoint: FCM + 'ok-test' } })).json()).toEqual({ result: 'ok' });
    expect(await (await api('/api/push/test', { method: 'POST', body: { endpoint: FCM + 'gone-test' } })).json()).toEqual({ result: 'gone' });
    const left = await subs(me);
    expect(left.map((s) => s.endpoint)).toEqual([FCM + 'ok-test']);
    expect(left[0].last_ok_at).toBeGreaterThan(0);
  });

  it('holds a device to the session that subscribed it: signing out there frees it while the same person stays signed in elsewhere', async () => {
    const phone = await signIn('device-owner'), other = await signIn();
    const laptop = (await login('device-owner')).headers.get('set-cookie').split(';')[0];
    const device = FCM + 'held-by-session';
    await phone('/api/push', { method: 'POST', body: { endpoint: device, tz: 'UTC' } });
    expect((await other('/api/push', { method: 'POST', body: { endpoint: device, tz: 'UTC' } })).status).toBe(409);
    await phone('/api/session', { method: 'DELETE' });
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: { cookie: laptop } })).status).toBe(200);
    expect((await other('/api/push', { method: 'POST', body: { endpoint: device, tz: 'UTC' } })).status).toBe(204);
  });

  it('give the digest in the device\'s zone, from your own items', async () => {
    const api = await signIn();
    const today = localNow('Pacific/Kiritimati').day;
    await api('/api/items/d1', { method: 'PUT', body: { type: 'assignment', title: 'Problem set', date: today, status: 'todo' } });
    const d = await (await api('/api/digest?tz=Pacific/Kiritimati')).json();
    expect(d).toMatchObject({ title: '1 due today', today: 1 });
    expect(d.body).toContain('Problem set');
  });
});

describe('the hourly cron', () => {
  /* 05:00 UTC is 07:00 in Athens (summer time ends 25 Oct 2026) and 22:00 the day before in Los Angeles */
  const at = Date.UTC(2026, 9, 20, 5, 0);

  async function setUp() {
    const api = await signIn(), me = await idOf(api);
    await api('/api/items/due', { method: 'PUT', body: { type: 'exam', title: 'Final', date: '2026-10-20', status: 'todo' } });
    return { api, me };
  }

  it('sends each morning device its digest once a day, drops gone ones and counts failures', async () => {
    const { api, me } = await setUp();
    for (const [id, tz] of [['ok-cron', 'Europe/Athens'], ['gone-cron', 'Europe/Athens'], ['bad-cron', 'Europe/Athens'], ['ok-night', 'America/Los_Angeles']]) {
      await api('/api/push', { method: 'POST', body: { endpoint: FCM + id + '-' + me, tz } });
    }
    const first = await sendDigests(env, at);
    expect(first.sent).toBeGreaterThanOrEqual(3);
    const rows = Object.fromEntries((await subs(me)).map((s) => [s.endpoint.slice(FCM.length).split('-u-')[0], s]));
    expect(Object.keys(rows).sort()).toEqual(['bad-cron', 'ok-cron', 'ok-night']);
    expect(rows['ok-cron']).toMatchObject({ last_sent_day: '2026-10-20', failures: 0 });
    expect(rows['bad-cron']).toMatchObject({ last_sent_day: '2026-10-20', failures: 1 });
    expect(rows['ok-night']).toMatchObject({ last_sent_day: null });
    const seen = [];
    await sendDigests(env, at + 3600_000, async (_e, endpoint) => { seen.push(endpoint); return 'ok'; });
    expect(seen.filter((e) => e.endsWith(me))).toEqual([]);
  });

  it('sends nothing on a quiet morning, but marks it read', async () => {
    const api = await signIn(), me = await idOf(api);
    await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-quiet-' + me, tz: 'Europe/Athens' } });
    const seen = [];
    await sendDigests(env, at, async (_e, endpoint) => { seen.push(endpoint); return 'ok'; });
    expect(seen.filter((e) => e.endsWith(me))).toEqual([]);
    expect((await subs(me))[0].last_sent_day).toBe('2026-10-20');
  });

  it('drops a device after five failures in a row', async () => {
    const { api, me } = await setUp();
    await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'bad-five-' + me, tz: 'Europe/Athens' } });
    for (let day = 0; day < 5; day++) await sendDigests(env, at + day * 864e5, async () => 'failed');
    expect(await subs(me)).toEqual([]);
  });

  it('runs on the hourly schedule only, and does nothing without the VAPID keys', async () => {
    const { api, me } = await setUp();
    await api('/api/push', { method: 'POST', body: { endpoint: FCM + 'ok-sched-' + me, tz: 'Europe/Athens' } });
    expect(await sendDigests({ ...env, VAPID_PRIVATE_KEY: '' }, at)).toEqual({ sent: 0 });
    expect((await subs(me))[0].last_sent_day).toBeNull();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 * * * *', scheduledTime: at }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect((await subs(me))[0].last_sent_day).toBe('2026-10-20');
  });
});
