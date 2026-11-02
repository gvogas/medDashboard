// Study Buddy, Stage 1: settings, the ledger, the Buddy read, claim, look, admin grant.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, mark, sharedItem, signInAdmin } from './spaces.js';

describe('the buddy tables', () => {
  it('keeps one settings row per person, gone with the account', async () => {
    const id = await createUser('bd-a');
    await env.DB.prepare('INSERT INTO buddy_settings (user_id, enabled, since, on_at, reconciled_at) VALUES (?, 1, 1, 1, 1)').bind(id).run();
    await expect(env.DB.prepare('INSERT INTO buddy_settings (user_id) VALUES (?)').bind(id).run()).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(env.DB.prepare('UPDATE buddy_settings SET enabled = 2 WHERE user_id = ?').bind(id).run()).rejects.toThrow(/CHECK/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    expect(await env.DB.prepare('SELECT 1 FROM buddy_settings WHERE user_id = ?').bind(id).first()).toBeNull();
  });

  it('pays each source once; earn rows are never negative, spend rows always are', async () => {
    const id = await createUser('bd-b');
    const ins = (source, kind, amount) => env.DB.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, ?, ?, '2026-11-02', 1)").bind(id, source, kind, amount).run();
    await ins('session:s1', 'earn', 3);
    await expect(ins('session:s1', 'earn', 3)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await ins('item:u:t6', 'earn', 0);                                 /* over the day's limit: counted, pays nothing */
    await expect(ins('x:1', 'earn', -1)).rejects.toThrow(/CHECK/);
    await expect(ins('buy:x:1', 'spend', 5)).rejects.toThrow(/CHECK/);
    await expect(ins('a'.repeat(65), 'earn', 1)).rejects.toThrow(/CHECK/);
  });

  it('lets admin_log record a grant', async () => {
    await env.DB.prepare("INSERT INTO admin_log (at, admin, action, target) VALUES (1, 'root', 'grant', 'bd-b')").run();
    await expect(env.DB.prepare("INSERT INTO admin_log (at, admin, action, target) VALUES (1, 'root', 'steal', 'bd-b')").run()).rejects.toThrow(/CHECK/);
  });
});

const MIN = 60_000, DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
async function player(name, tz = 'UTC') {
  const api = await signIn(name);
  api.id = 'u-' + name;
  expect((await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz } })).status).toBe(200);
  return api;
}
/* as if gameplay had been on since `ms`: nothing before turning it on counts, so tests that log earlier study move the start back */
const backdate = (api, ms) => env.DB.prepare('UPDATE buddy_settings SET since = ?1, on_at = ?1, reconciled_at = ?1 WHERE user_id = ?2').bind(ms, api.id).run();
const buddy = async (api) => (await api('/api/buddy')).json();
const session = (api, id, startedAt, minutes, manual = false) =>
  api(`/api/study_sessions/${id}`, { method: 'PUT', body: { startedAt, studyMinutes: minutes, manual } });
const task = (api, id, status, more = {}) =>
  api(`/api/items/${id}`, { method: 'PUT', body: { type: 'task', title: id, date: isoDay(Date.now()), status, notes: '', checklist: [], links: [], ...more } });
/* both sessions on one UTC day that began at least 6 h ago, whatever the clock says */
const dayBase = () => { const d0 = Math.floor(Date.now() / DAY) * DAY; return Date.now() - d0 > 6 * 60 * MIN ? d0 : d0 - DAY; };

describe('GET /api/buddy', () => {
  it('answers {enabled: false} and writes nothing while gameplay is off', async () => {
    const api = await signIn('bd-off');
    expect(await buddy(api)).toEqual({ enabled: false });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = 'u-bd-off'").first()).n).toBe(0);
  });

  it('pays a timed session once; a manual log pays nothing; the 240-minute day holds', async () => {
    const api = await player('bd-sess');
    const base = dayBase();
    await backdate(api, base - MIN);
    expect((await session(api, 's1', base, 200)).status).toBe(200);
    await session(api, 's2', base + 210 * MIN, 100);
    await session(api, 'm1', base + 60 * MIN, 60, true);
    const g = await buddy(api);
    expect(g.coins).toBe(40 + 8 + 2);                   /* 200 → 40; 40 of 100 count → 8; a streak day → 2 */
    expect(g.xp).toBe(240);
    expect(g.streak).toBe(1);
    expect((await buddy(api)).coins).toBe(50);           /* a second read pays nothing more */
  });

  it('pays a finish once even after todo → done → todo → done, and stops at 5 personal a day', async () => {
    const api = await player('bd-fin');
    await task(api, 't1', 'done'); await buddy(api);
    await task(api, 't1', 'todo'); await task(api, 't1', 'done');
    for (const id of ['t2', 't3', 't4', 't5', 't6']) await task(api, id, 'done');
    const g = await buddy(api);
    expect(g.coins).toBe(25);
    expect(g.xp).toBe(50);
    /* turning one back to todo takes its XP away, not its coins */
    await task(api, 't2', 'todo');
    expect(await buddy(api)).toMatchObject({ coins: 25, xp: 40 });
  });

  it('a personal exam shares the 5 and pays 5; a class exam has no limit and pays 15', async () => {
    const api = await player('bd-exam');
    const s = await makeSpace({ members: { [api.id]: 'member' } });
    await sharedItem(s.scope, 'x1', { type: 'exam', course_id: s.course });
    await mark(api.id, s.id, 'x1', { status: 'graded', completed_at: Date.now() });
    await task(api, 'e1', 'graded', { type: 'exam' });
    expect((await buddy(api)).coins).toBe(15 + 5);
  });

  it('does not hurt health for a cancelled tutorial, does for a missed lab', async () => {
    const api = await player('bd-health');
    await backdate(api, Date.now() - 2 * DAY);
    const y = isoDay(Date.now() - DAY);
    await task(api, 'tut', 'missed', { type: 'tutoring', date: y });
    expect((await buddy(api)).health).toBe(100);   /* three days without study is still inside the idle rule (the 4th costs 5) */
    await task(api, 'lab', 'missed', { type: 'lab', date: y });
    const g = await buddy(api);
    expect(g.health).toBe(90);
    expect(g.mood).toBe('happy');
  });

  it('counts nothing finished before gameplay was turned on, and turning it off and on never takes XP away', async () => {
    const api = await signIn('bd-late');
    api.id = 'u-bd-late';
    await task(api, 'old', 'done', { completedAt: Date.now() - 3 * DAY });
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC' } });
    expect(await buddy(api)).toMatchObject({ coins: 0, xp: 0 });
    await backdate(api, dayBase() - MIN);
    await session(api, 's1', dayBase(), 30);
    expect((await buddy(api)).xp).toBe(30);
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: false } });
    expect(await buddy(api)).toEqual({ enabled: false });
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true } });
    expect((await buddy(api)).xp).toBe(30);
  });

  it('claims a reached tier once; a tier above the XP is tier_not_reached', async () => {
    const api = await player('bd-claim');
    const claim = (tier) => api('/api/buddy/claim', { method: 'POST', body: { tier } });
    expect((await claim('egg')).status).toBe(200);
    expect((await (await claim('egg')).json()).coins).toBe(5);
    expect(await (await claim('r3')).json()).toEqual({ error: 'tier_not_reached' });
    expect((await claim('dragon')).status).toBe(400);
    const g = await buddy(api);
    expect(g.tiers[0]).toMatchObject({ id: 'egg', reached: true, claimed: true });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = 'u-bd-claim' AND source = 'claim:egg'").first()).n).toBe(1);
  });

  it("picks any theme's buddy; custom needs a saved one", async () => {
    const api = await player('bd-look');
    const look = (body) => api('/api/buddy/look', { method: 'PUT', body });
    expect((await (await look({ buddy: 'law' })).json()).look).toEqual({ buddy: 'law', bg: 'none', name: '' });
    expect(await (await look({ buddy: 'custom' })).json()).toMatchObject({ error: 'not_owned' });
    expect((await look({ buddy: 'dragon' })).status).toBe(400);
  });

  it('two reads at once write each award once', async () => {
    const api = await player('bd-race');
    await backdate(api, dayBase() - MIN);
    await session(api, 's1', dayBase(), 30);
    await Promise.all([buddy(api), buddy(api)]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = 'u-bd-race' AND source = 'session:s1'").first()).n).toBe(1);
  });

  it('raises a room session written again with more minutes, and never lowers one', async () => {
    const api = await player('bd-room');
    await backdate(api, dayBase() - MIN);
    await session(api, 'r1', dayBase(), 20);
    expect((await buddy(api)).coins).toBe(4 + 2);
    await session(api, 'r1', dayBase(), 50);
    expect((await buddy(api)).coins).toBe(10 + 2);
    await session(api, 'r1', dayBase(), 10);
    expect((await buddy(api)).coins).toBe(10 + 2);
  });
});

describe('the buddy routes', () => {
  it('refuses writes while gameplay is off, and keeps the stored zone for a bad one', async () => {
    const api = await signIn('bd-gate');
    expect(await (await api('/api/buddy/claim', { method: 'POST', body: { tier: 'egg' } })).json()).toEqual({ error: 'gameplay_off' });
    expect((await api('/api/buddy/look', { method: 'PUT', body: { buddy: 'law' } })).status).toBe(409);
    expect((await api('/api/buddy/settings', { method: 'PUT', body: { enabled: 'yes' } })).status).toBe(400);
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'America/Toronto' } });
    expect((await (await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'Not/AZone' } })).json()).tz).toBe('America/Toronto');
  });

  it('is behind the buddy maintenance switch for everyone but admins', async () => {
    const api = await player('bd-maint');
    const admin = await signInAdmin('bd-maint-admin');
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = ?1")
      .bind(JSON.stringify({ features: ['buddy'], message: '', updatedAt: 1 })).run();
    try {
      expect(await (await api('/api/buddy')).json()).toEqual({ error: 'maintenance', feature: 'buddy' });
      expect((await api('/api/buddy/claim', { method: 'POST', body: { tier: 'egg' } })).status).toBe(503);
      expect((await admin('/api/buddy')).status).toBe(200);
      expect((await api('/api/me')).status).toBe(200);
    } finally {
      await env.DB.prepare("DELETE FROM app_meta WHERE key = 'maintenance'").run();
    }
  });
});

describe('POST /api/admin/buddy/grant', () => {
  it('writes coins or XP and an admin_log row; non-admins get 403', async () => {
    const admin = await signInAdmin('bd-boss');
    const api = await player('bd-granted');
    const grant = (who, body) => who('/api/admin/buddy/grant', { method: 'POST', body });
    expect((await grant(admin, { userId: api.id, coins: 100 })).status).toBe(204);
    expect((await grant(admin, { userId: api.id, xp: 500 })).status).toBe(204);
    expect(await buddy(api)).toMatchObject({ coins: 100, xp: 500, tier: 'r3' });
    expect(await env.DB.prepare("SELECT action, target, detail FROM admin_log WHERE target = 'bd-granted' ORDER BY id").all())
      .toMatchObject({ results: [{ action: 'grant', detail: 'coins 100' }, { action: 'grant', detail: 'xp 500' }] });
    expect((await grant(admin, { userId: api.id, coins: 0 })).status).toBe(400);
    expect((await grant(admin, { userId: api.id })).status).toBe(400);
    expect((await grant(admin, { userId: 'u-nobody', coins: 5 })).status).toBe(404);
    expect((await grant(api, { userId: api.id, coins: 5 })).status).toBe(403);
  });
});
