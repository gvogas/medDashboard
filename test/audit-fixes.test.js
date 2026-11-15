// Regression tests for the November 2026 audit: each case is a defect the audit reproduced,
// written as the behaviour that is now right.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, createUser, login, signIn } from './helpers.js';
import { makeSpace, post, sharedItem, signInAdmin } from './spaces.js';
import { generateCards, studyAiAdmin, studyAiStatus, neuronsOf } from '../worker/study-ai.js';
import { claimLimit } from '../worker/limits.js';
import { buildCalendar } from '../worker/calendar.js';
import { createRoom, purgeRooms, roomClock, sendMessage } from '../worker/rooms.js';

describe('a project needs a real date', () => {
  it('refuses a day that does not exist, as the item route does', async () => {
    const owner = await signIn('af-proj-owner');
    for (const date of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      const made = await post(owner, '/api/spaces', { kind: 'project', title: 'Team', date });
      expect([date, made.status]).toEqual([date, 400]);
      expect(await made.json()).toMatchObject({ error: 'invalid', field: 'date' });
    }
    expect((await post(owner, '/api/spaces', { kind: 'project', title: 'Team', date: '2026-12-01' })).status).toBe(201);
  });

  it('a row with an impossible date already stored does not take the calendar feed down', async () => {
    const good = { id: 'a1', type: 'task', title: 'Real', date: '2026-12-01', start: '', end: '', status: 'todo', notes: '', location: '' };
    const ics = buildCalendar({ courses: [], items: [{ ...good, id: 'bad', title: 'Broken', date: '2026-13-45' }, good], now: Date.UTC(2026, 10, 14) });
    expect(ics).toContain('SUMMARY:Real');
    expect(ics).not.toContain('SUMMARY:Broken');
  });

  it("a member's feed still answers after a project item's date is corrupted", async () => {
    const owner = await signIn('af-feed-owner');
    const { space } = await (await post(owner, '/api/spaces', { kind: 'project', title: 'Team', date: '2026-12-01' })).json();
    const feed = (await (await post(owner, '/api/calendar')).json()).url;
    await env.DB.prepare("UPDATE items SET date = '2026-13-45' WHERE scope = ? AND id = 'project'").bind(space.scope).run();
    expect((await SELF.fetch(feed)).status).toBe(200);
  });
});

/* a Workers AI binding that answers `cards` and reports 5,000 tokens a run */
const usage = { prompt_tokens: 3000, completion_tokens: 2000 };
const ai = (cards) => ({ calls: 0, async run() { this.calls++; return { choices: [{ message: { content: JSON.stringify({ cards }) } }], usage }; } });
const body = { sources: { topic: 'Beta blockers' }, count: 2, level: 'exam' };
const clearMeta = () => env.DB.prepare("DELETE FROM app_meta WHERE key GLOB 'studyai_*'").run();
const setCaps = (c) => env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('studyai_caps', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = ?1").bind(JSON.stringify(c)).run();

describe('Generate here counts what the model cost, whatever came back', () => {
  it('an answer with no usable cards gives the use back but its neurons count toward the day', async () => {
    await clearMeta();
    await signIn('af-ai-empty');
    const e = { DB: env.DB, AI: ai([]) };
    for (let i = 0; i < 2; i++) await expect(generateCards(e, 'u-af-ai-empty', body)).rejects.toMatchObject({ status: 502, body: { error: 'outline_unreadable' } });
    expect((await studyAiStatus(e, 'u-af-ai-empty')).left).toBe(3);                 /* the person's uses are untouched, as before */
    const today = (await studyAiAdmin(env.DB)).today;
    /* each failed call is two model runs: askJson asks once more when the first answer has nothing usable */
    expect(today.neurons).toBe(neuronsOf(usage) * e.AI.calls);
    expect(today.generations).toBe(0);                                               /* a generation is one that made cards */
    await clearMeta();
  });

  it('so the ceiling closes for the day after enough of them', async () => {
    await clearMeta();
    await setCaps({ perUser: 3, extraMax: 2, ceiling: 100 });
    try {
      await signIn('af-ai-ceiling');
      const e = { DB: env.DB, AI: ai([]) };
      await expect(generateCards(e, 'u-af-ai-ceiling', body)).rejects.toMatchObject({ status: 502 });
      const calls = e.AI.calls;
      await expect(generateCards(e, 'u-af-ai-ceiling', body)).rejects.toMatchObject({ status: 429, body: { error: 'study_ai_busy' } });
      expect(e.AI.calls).toBe(calls);                                                /* the model was not asked again */
    } finally { await clearMeta(); }
  });

  it('a cap of 0 means no free generations at all', async () => {
    expect(await claimLimit(env.DB, 'af:zero', 0, Date.now(), 60_000)).toBeGreaterThan(0);
    expect(await env.DB.prepare("SELECT 1 FROM request_limits WHERE key = 'af:zero'").first()).toBeNull();
    await clearMeta();
    await setCaps({ perUser: 0, extraMax: 0, ceiling: 4000 });
    try {
      await signIn('af-ai-zero');
      const e = { DB: env.DB, AI: ai([{ front: 'Q1', back: 'A1' }]) };
      expect(await studyAiStatus(e, 'u-af-ai-zero')).toMatchObject({ left: 0 });
      await expect(generateCards(e, 'u-af-ai-zero', body)).rejects.toMatchObject({ status: 429, body: { error: 'study_ai_cap', paste: true } });
      expect(e.AI.calls).toBe(0);
    } finally { await clearMeta(); }
  });
});

describe('a trusted-device cookie ends with the password it was made under', () => {
  const loginWith = (username, password, cookie) => SELF.fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ username, password }),
  });
  const deviceOf = (res) => res.headers.getSetCookie().find((c) => c.startsWith('rounds_device='))?.split(';')[0];

  it('after an admin sets a new password, an old device cookie is one more stranger', { timeout: 120000 }, async () => {
    await createUser('af-device');
    const old = deviceOf(await login('af-device'));
    expect(old).toBeTruthy();
    const admin = await signInAdmin('af-device-admin');
    const NEW = 'a brand new password';
    expect((await post(admin, '/api/admin/accounts/u-af-device/password', { password: NEW })).status).toBe(204);
    /* strangers lock the name */
    for (let i = 0; i < 6; i++) await login('af-device', 'guess' + i);
    expect((await login('af-device', NEW)).status).toBe(429);
    /* the cookie from before the reset no longer has a bucket of its own: it is locked with everyone else */
    expect((await loginWith('af-device', NEW, old)).status).toBe(429);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM login_throttle WHERE username LIKE 'af-device#%'").first()).toEqual({ n: 0 });
  });

  it('a cookie made under the current password still keeps its owner from being locked out', { timeout: 120000 }, async () => {
    await createUser('af-device2');
    const admin = await signInAdmin('af-device2-admin');
    const NEW = 'another new password';
    expect((await post(admin, '/api/admin/accounts/u-af-device2/password', { password: NEW })).status).toBe(204);
    const fresh = deviceOf(await login('af-device2', NEW));
    expect(fresh).toBeTruthy();
    for (let i = 0; i < 6; i++) await login('af-device2', 'guess' + i);
    expect((await login('af-device2', NEW)).status).toBe(429);
    expect((await loginWith('af-device2', NEW, fresh)).status).toBe(200);
  });
});

describe("a merge write's `changed` values are bounded", () => {
  const deep = (n) => '['.repeat(n) + ']'.repeat(n);
  it('a deeply nested value is a 400, not a stack overflow, on a mark and on a class item', async () => {
    const member = await signIn('af-deep-member'), editor = await signIn('af-deep-editor');
    const cls = await makeSpace({ members: { 'u-af-deep-member': 'member', 'u-af-deep-editor': 'editor' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web' });
    expect((await member(`/api/marks/${cls.id}/a1`, { method: 'PUT', headers: { 'if-match': '"0"' }, body: { notes: 'mine' } })).status).toBe(200);
    const onMark = await member(`/api/marks/${cls.id}/a1`, { method: 'PUT', headers: { 'if-match': '"999999"' }, body: `{"notes":"other","changed":{"notes":${deep(20000)}}}` });
    expect(onMark.status).toBe(400);
    expect(await onMark.json()).toMatchObject({ error: 'invalid', field: 'changed' });
    const onItem = await editor(`/api/spaces/${cls.id}/items/a1`, { method: 'PUT', headers: { 'if-match': '"999999"' },
      body: `{"type":"assignment","title":"a1","courseId":"web","date":"2026-10-15","status":"todo","changed":{"title":${deep(20000)}}}` });
    expect(onItem.status).toBe(400);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM error_log WHERE status = 500 AND message LIKE '%call stack%'").first()).toEqual({ n: 0 });
  });

  it('an ordinary changed value still merges', async () => {
    const member = await signIn('af-merge-member');
    const cls = await makeSpace({ members: { 'u-af-merge-member': 'member' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web' });
    const put = (body, revision) => member(`/api/marks/${cls.id}/a1`, { method: 'PUT', headers: { 'if-match': `"${revision}"` }, body });
    const steps = (done) => [{ id: 's1', text: 'One', done }];
    const v1 = await (await put({ notes: 'mine', checklist: steps(false) }, 0)).json();
    const v2 = await (await put({ ...v1, weight: 30 }, v1.revision)).json();
    /* a stale device ticks the step: its `changed` names the list as it was, a list of objects two levels deep */
    const merged = await put({ ...v1, checklist: steps(true), changed: { checklist: steps(false) } }, v1.revision);
    expect(merged.status).toBe(200);
    expect(await merged.json()).toMatchObject({ checklist: steps(true), weight: 30, revision: v2.revision + 1 });
  });
});

describe('a date a clock cannot hold is refused', () => {
  it('a study session or a card review dated past the end of time is a 400, and the Buddy page still reads', async () => {
    const api = await signIn('af-far');
    expect((await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC' } })).status).toBe(200);
    const far = await api('/api/study_sessions/far', { method: 'PUT', body: { startedAt: 9_000_000_000_000_000, studyMinutes: 25 } });
    expect(far.status).toBe(400);
    expect(await far.json()).toMatchObject({ error: 'invalid', field: 'startedAt' });
    const review = await api('/api/card_reviews/far', { method: 'PUT', body: { cardRef: 'k1', deckRef: 'd1', day: '2026-11-14', grade: 'good', at: 9_000_000_000_000_000 } });
    expect(review.status).toBe(400);
    expect((await api('/api/buddy')).status).toBe(200);
    /* the last moment a date can name is still taken */
    expect((await api('/api/study_sessions/edge', { method: 'PUT', body: { startedAt: 8_640_000_000_000_000, studyMinutes: 25 } })).status).toBe(200);
  });
});

describe("the copy a class leaves behind takes the class's category on a revived item", () => {
  it('q1 and q2, converted then changed in the class, come back with the categories the class gave them', async () => {
    const api = await signIn('af-copy-owner');
    const cats = [{ id: 'cat1', name: 'Quizzes', weight: 20, drop: 0 }, { id: 'cat2', name: 'Labs', weight: 30, drop: 0 }];
    expect((await api('/api/courses/c1', { method: 'PUT', body: { code: 'BIO', name: 'Biology', color: '#17B3AE', gradeCategories: cats } })).status).toBe(200);
    const mine = (id, more) => api(`/api/items/${id}`, { method: 'PUT', body: { type: 'quiz', title: id, courseId: 'c1', date: '2026-12-01', status: 'todo', ...more } });
    expect((await mine('q1', { category: 'cat1' })).status).toBe(200);
    expect((await mine('q2', {})).status).toBe(200);
    const made = await api('/api/spaces', { method: 'POST', body: { kind: 'class', convertCourseId: 'c1', items: ['q1', 'q2'] } });
    expect(made.status).toBe(201);
    const sid = (await made.json()).space.id;
    for (const [id, category] of [['q1', 'cat2'], ['q2', 'cat1']]) {
      const row = await (await api(`/api/spaces/${sid}/items/${id}`)).json();
      expect((await api(`/api/spaces/${sid}/items/${id}`, { method: 'PUT', headers: { 'if-match': `"${row.revision}"` }, body: { ...row, category } })).status).toBe(200);
    }
    expect((await api(`/api/spaces/${sid}`, { method: 'DELETE', body: { keepCopy: true } })).status).toBe(204);
    const { results } = await env.DB.prepare("SELECT id, category FROM items WHERE scope = 'u:u-af-copy-owner' AND deleted_at IS NULL ORDER BY id").all();
    expect(results).toEqual([{ id: 'q1', category: 'cat2' }, { id: 'q2', category: 'cat1' }]);
  });
});

describe('an expired invite is no longer in the way', () => {
  it('another editor can invite the person again, and can withdraw the dead invite', async () => {
    const owner = await createUser('af-inv-owner');
    const e1 = await signIn('af-inv-ed1'), e2 = await signIn('af-inv-ed2'), guest = await signIn('af-inv-guest');
    const s = await makeSpace({ members: { [owner]: 'owner', 'u-af-inv-ed1': 'editor', 'u-af-inv-ed2': 'editor' } });
    expect((await post(e1, `/api/spaces/${s.id}/invites`, { username: 'af-inv-guest' })).status).toBe(201);
    /* while it is live, it is the sender's: another editor may not overwrite it (as before) */
    expect((await post(e2, `/api/spaces/${s.id}/invites`, { username: 'af-inv-guest' })).status).toBe(403);
    /* 31 days pass */
    await env.DB.prepare('UPDATE invites SET created_at = created_at - ?1, expires_at = expires_at - ?1 WHERE space_id = ?2').bind(31 * 86_400_000, s.id).run();
    expect((await post(guest, `/api/invites/${s.id}/accept`)).status).toBe(410);
    expect((await e2(`/api/spaces/${s.id}/invites/u-af-inv-guest`, { method: 'DELETE' })).status).toBe(204);
    expect((await post(e1, `/api/spaces/${s.id}/invites`, { username: 'af-inv-guest' })).status).toBe(201);
    await env.DB.prepare('UPDATE invites SET created_at = created_at - ?1, expires_at = expires_at - ?1 WHERE space_id = ?2').bind(31 * 86_400_000, s.id).run();
    expect((await post(e2, `/api/spaces/${s.id}/invites`, { username: 'af-inv-guest' })).status).toBe(201);
    expect((await post(guest, `/api/invites/${s.id}/accept`)).status).toBe(200);
  });
});

describe("a room's chat goes 90 days after the room ends, logged or not", () => {
  it('the purge deletes the messages of a room it keeps for a session', async () => {
    const host = await createUser('af-room-host');
    const now = Date.now(), T0 = now - 120 * 86_400_000;
    const flow = { steps: [['study', 25]], rounds: 1 };
    const id = (await createRoom(env.DB, host, { flow }, T0)).room.id;
    await sendMessage(env.DB, host, id, { body: 'see you at the library' }, T0 + 60_000);
    await roomClock(env.DB, host, id, { action: 'end' }, T0 + 600_000);
    await env.DB.prepare('INSERT INTO study_sessions (user_id, id, started_at, study_minutes, room_id, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?, ?)')
      .bind(host, 'r-' + id, T0, id, T0, T0).run();
    /* a room still inside its 90 days keeps its chat */
    const recent = (await createRoom(env.DB, host, { flow }, now - 3_600_000)).room.id;
    await sendMessage(env.DB, host, recent, { body: 'still here' }, now - 3_000_000);
    await roomClock(env.DB, host, recent, { action: 'end' }, now - 2_400_000);
    await purgeRooms(env.DB, now);
    expect((await env.DB.prepare('SELECT room_id, body FROM room_messages ORDER BY id').all()).results).toEqual([{ room_id: recent, body: 'still here' }]);
    expect(await env.DB.prepare('SELECT 1 AS kept FROM rooms WHERE id = ?').bind(id).first()).toEqual({ kept: 1 });   /* the room stays for its session */
  });
});

describe('friend search finds a name by the letters it is written in', () => {
  it('a capital accented letter matches itself; ASCII still matches in either case', async () => {
    await createUser('af-emilie', 'Émilie Roy');
    const api = await signIn('af-seeker');
    const find = async (q) => (await (await api('/api/friends/search?q=' + encodeURIComponent(q))).json()).people.map((p) => p.name);
    expect(await find('Émilie')).toEqual(['Émilie Roy']);
    expect(await find('Émilie Roy')).toEqual(['Émilie Roy']);
    expect(await find('milie')).toEqual(['Émilie Roy']);
    expect(await find('roy')).toEqual(['Émilie Roy']);
    expect(await find('AF-EMILIE')).toEqual(['Émilie Roy']);   /* the username, exactly, in any case */
  });
});
