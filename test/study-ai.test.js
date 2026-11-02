// Study Buddy, Stage 4: the study-AI gateway (spec §6). Generate here through the provider slot,
// the caps (per user, bought extras, the global ceiling), giving a failed use back, the usage log,
// the admin page and the studyai switch.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { signInAdmin } from './spaces.js';
import { generateCards, studyAiAdmin, studyAiStatus, neuronsOf, PROVIDERS, workersProvider } from '../worker/study-ai.js';
import { HttpError } from '../worker/http.js';

const usage = { prompt_tokens: 3000, completion_tokens: 2000 };
const reply = (cards) => ({ choices: [{ message: { content: 'Here:\n```json\n' + JSON.stringify({ cards }) + '\n```' } }], usage });
/* a Workers AI binding that answers `cards`, or throws `error` */
const ai = ({ cards = [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }], error = null } = {}) => ({
  calls: 0,
  async run() { this.calls++; if (error) throw new Error(error); return reply(cards); },
});
const body = (over = {}) => ({ sources: { topic: 'Beta blockers' }, count: 2, level: 'exam', ...over });
let n = 0;
const user = async () => { const name = 'sa-' + ++n; await signIn(name); return 'u-' + name; };
const caps = (c) => env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('studyai_caps', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = ?1").bind(JSON.stringify(c)).run();
const clearMeta = () => env.DB.prepare("DELETE FROM app_meta WHERE key GLOB 'studyai_*'").run();

describe('Generate here', () => {
  it('makes cards through the workers provider and records the neurons', async () => {
    await clearMeta();
    const id = await user(), AI = ai();
    const out = await generateCards({ DB: env.DB, AI }, id, body());
    expect(out).toEqual({ cards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }], provider: 'workers', left: 2 });
    const admin = await studyAiAdmin(env.DB);
    expect(admin.today).toMatchObject({ generations: 1, neurons: neuronsOf(usage), byProvider: { workers: 1 }, ceiling: 4000 });
    expect(neuronsOf(usage)).toBe(Math.ceil((3000 * 31_818 + 2000 * 68_182) / 1e6));
    expect(admin.last14).toHaveLength(14);
  });

  it('stops at 3 a day, then says so with paste: true; an extra bought today adds one', async () => {
    await clearMeta();
    const id = await user(), e = { DB: env.DB, AI: ai() };
    for (let i = 0; i < 3; i++) await generateCards(e, id, body());
    const spent = await generateCards(e, id, body()).catch((x) => x);
    expect(spent).toBeInstanceOf(HttpError);
    expect(spent.status).toBe(429);
    expect(spent.body).toMatchObject({ error: 'study_ai_cap', paste: true, extra: false });
    await env.DB.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, 'spend', -60, ?, 1)")
      .bind(id, `buy:ai:${new Date().toISOString().slice(0, 10)}:1`, new Date().toISOString().slice(0, 10)).run();
    expect((await generateCards(e, id, body())).left).toBe(0);
    expect((await studyAiStatus(e, id)).extraLeft).toBe(1);
  });

  it('gives the use back when the model fails, and when its answer has no cards', async () => {
    await clearMeta();
    const id = await user();
    await expect(generateCards({ DB: env.DB, AI: ai({ error: 'AiError: 3043: Internal server error' }) }, id, body())).rejects.toMatchObject({ status: 503, body: { paste: true } });
    await expect(generateCards({ DB: env.DB, AI: ai({ cards: [{ front: '', back: '' }] }) }, id, body())).rejects.toMatchObject({ status: 502 });
    expect((await studyAiStatus({ DB: env.DB, AI: ai() }, id)).left).toBe(3);
  });

  it('closes for everyone once the day passes the neuron ceiling', async () => {
    await clearMeta();
    await caps({ perUser: 3, extraMax: 2, ceiling: 100 });
    try {
      const id = await user(), e = { DB: env.DB, AI: ai() };
      await generateCards(e, id, body());                         /* this call goes past it, and finishes */
      await expect(generateCards(e, await user(), body())).rejects.toMatchObject({ status: 429, body: { error: 'study_ai_busy', paste: true } });
      expect((await studyAiStatus(e, id)).globalOpen).toBe(false);
    } finally { await clearMeta(); }
  });

  it('runs through the provider slot: a second provider needs no other change', async () => {
    await clearMeta();
    const fake = { id: 'fake', available: () => true, run: async (_env, prompt, clean) => ({ answer: clean(JSON.stringify({ cards: [{ front: prompt.system.slice(0, 5), back: 'x' }] })), usage: { prompt_tokens: 10, completion_tokens: 10 }, model: 'fake-1' }) };
    const out = await generateCards({ DB: env.DB }, await user(), body({ provider: 'fake' }), Date.now(), [workersProvider, fake]);
    expect(out).toMatchObject({ provider: 'fake', cards: [{ front: 'You w', back: 'x' }] });
    expect(PROVIDERS.map((p) => p.id)).toEqual(['workers']);
  });

  it('checks the request', async () => {
    const id = await user(), e = { DB: env.DB, AI: ai() };
    for (const bad of [body({ count: 0 }), body({ count: 31 }), body({ level: 'expert' }), body({ sources: {} }), body({ sources: { topic: 'x'.repeat(121) } })]) {
      await expect(generateCards(e, id, bad)).rejects.toMatchObject({ status: expect.any(Number) });
    }
    await expect(generateCards(e, id, body({ sources: { text: 'x'.repeat(60_001) } }))).rejects.toMatchObject({ status: 413 });
  });
});

describe('the study-AI routes', () => {
  it('answers the status, and is behind the studyai switch; the admin page changes the caps', async () => {
    await clearMeta();
    const api = await signIn('sa-route'), admin = await signInAdmin('sa-admin');
    expect(await (await api('/api/study-ai/status')).json()).toMatchObject({ left: 3, perUser: 3, extraLeft: 2, globalOpen: true });
    expect((await api('/api/admin/study-ai')).status).toBe(403);
    const put = (b) => admin('/api/admin/study-ai/caps', { method: 'PUT', body: b });
    expect((await put({ perUser: 21, extraMax: 2, ceiling: 4000 })).status).toBe(400);
    expect((await (await put({ perUser: 5, extraMax: 1, ceiling: 3000 })).json()).caps).toEqual({ perUser: 5, extraMax: 1, ceiling: 3000 });
    expect(await (await api('/api/study-ai/status')).json()).toMatchObject({ left: 5, extraLeft: 1 });
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = ?1")
      .bind(JSON.stringify({ features: ['studyai'], message: '', updatedAt: 1 })).run();
    try {
      expect((await api('/api/study-ai/status')).status).toBe(503);
      expect((await api('/api/decks/d1', { method: 'PUT', body: { title: 'By hand' } })).status).toBe(200);   /* hand-made cards still work */
    } finally {
      await env.DB.prepare("DELETE FROM app_meta WHERE key = 'maintenance'").run();
      await clearMeta();
    }
  });

  it('sells an extra AI use for 60 coins, at most extraMax a day', async () => {
    await clearMeta();
    const api = await signIn('sa-buy');
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC' } });
    await env.DB.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES ('u-sa-buy', 'admin:x', 'earn', 200, '2026-11-02', 1)").run();
    const shop = await (await api('/api/buddy/shop')).json();
    expect(shop.items.find((i) => i.sku === 'ai')).toEqual({ sku: 'ai', kind: 'ai', name: 'Extra AI use', effect: '+1 Generate here today', level: 0, max: 2, cost: 60 });
    const buy = (level) => api('/api/buddy/buy', { method: 'POST', body: { sku: 'ai', level } });
    expect((await (await buy(1)).json()).item).toMatchObject({ level: 1, cost: 60 });
    expect(await (await buy(1)).json()).toMatchObject({ error: 'stale_level' });
    expect((await (await buy(2)).json())).toMatchObject({ coins: 80, item: { level: 2, cost: null } });
    expect((await buy(3)).status).toBe(400);
    expect(await (await api('/api/study-ai/status')).json()).toMatchObject({ left: 5, extraLeft: 0 });
  });
});
