// Study Buddy, Stage 2: the shop (upgrades, backgrounds and frames), the grade bonus, the custom
// buddy and the name (spec §10, Stage 2).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, mark, sharedItem } from './spaces.js';

const MIN = 60_000, DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
async function player(name) {
  const api = await signIn(name);
  api.id = 'u-' + name;
  expect((await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC' } })).status).toBe(200);
  return api;
}
const backdate = (api, ms) => env.DB.prepare('UPDATE buddy_settings SET since = ?1, on_at = ?1, reconciled_at = ?1 WHERE user_id = ?2').bind(ms, api.id).run();
const coins = (api, n) => env.DB.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, 'earn', ?, '2026-11-02', 1)")
  .bind(api.id, 'admin:' + Math.random(), n).run();
const buddy = async (api) => (await api('/api/buddy')).json();
const buy = (api, sku, level) => api('/api/buddy/buy', { method: 'POST', body: { sku, level } });
const look = (api, body) => api('/api/buddy/look', { method: 'PUT', body });
const spends = async (api) => (await env.DB.prepare("SELECT source, amount FROM buddy_ledger WHERE user_id = ? AND kind = 'spend' ORDER BY source").bind(api.id).all()).results;
const session = (api, id, startedAt, minutes) => api(`/api/study_sessions/${id}`, { method: 'PUT', body: { startedAt, studyMinutes: minutes, manual: false } });
const task = (api, id) => api(`/api/items/${id}`, { method: 'PUT', body: { type: 'task', title: id, date: isoDay(Date.now()), status: 'done', completedAt: Date.now(), notes: '', checklist: [], links: [] } });
const dayBase = () => { const d0 = Math.floor(Date.now() / DAY) * DAY; return Date.now() - d0 > 6 * 60 * MIN ? d0 : d0 - DAY; };

describe('GET /api/buddy/shop and POST /api/buddy/buy', () => {
  it('lists the open upgrades and the cosmetics, with your level and the next cost', async () => {
    const api = await player('sh-list');
    const shop = await (await api('/api/buddy/shop')).json();
    expect(shop.coins).toBe(0);
    expect(shop.items.find((i) => i.sku === 'focus')).toEqual({ sku: 'focus', kind: 'upgrade', name: 'Focus Engine', effect: '+20% study coins', level: 0, max: 5, cost: 75 });
    expect(shop.items.map((i) => i.sku)).not.toContain('magnet');            /* quizzes come in Stage 5 */
    expect(shop.items.find((i) => i.sku === 'bg-meadow')).toMatchObject({ kind: 'bg', level: 0, max: 1, cost: 30 });
  });

  it('fails with too few coins and writes nothing; buys with enough', async () => {
    const api = await player('sh-poor');
    await coins(api, 74);
    expect(await (await buy(api, 'focus', 1)).json()).toEqual({ error: 'not_enough_coins', coins: 74, cost: 75 });
    expect(await spends(api)).toEqual([]);
    await coins(api, 1);
    const r = await buy(api, 'focus', 1);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ coins: 0, item: expect.objectContaining({ sku: 'focus', level: 1, cost: 110 }) });
    expect(await spends(api)).toEqual([{ source: 'buy:focus:1', amount: -75 }]);
  });

  it('two quick taps buy one level; a level that is not the next one is stale_level', async () => {
    const api = await player('sh-taps');
    await coins(api, 1000);
    const [a, b] = await Promise.all([buy(api, 'finisher', 1), buy(api, 'finisher', 1)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await (await buy(api, 'finisher', 3)).json()).toEqual({ error: 'stale_level', level: 1 });
    expect(await spends(api)).toEqual([{ source: 'buy:finisher:1', amount: -115 }]);
    expect((await buddy(api)).coins).toBe(1000 - 115);
    expect((await buy(api, 'finisher', 6)).status).toBe(400);
    expect((await buy(api, 'magnet', 1)).status).toBe(400);
    expect((await buy(api, 'bg-meadow', 2)).status).toBe(400);
  });

  it('is gameplay_off while off', async () => {
    const api = await signIn('sh-off');
    expect((await buy(api, 'focus', 1)).status).toBe(409);
    expect((await api('/api/buddy/shop')).status).toBe(409);
  });
});

describe('upgrade effects', () => {
  it('Focus Engine raises the next sessions’ coins, never ones already paid', async () => {
    const api = await player('sh-focus');
    const base = dayBase();
    await backdate(api, base - MIN);
    await session(api, 's1', base, 50);                                   /* 10 coins, and 2 for the streak day */
    expect((await buddy(api)).coins).toBe(12);
    await coins(api, 75 + 110 - 12);
    expect((await buy(api, 'focus', 1)).status).toBe(200);
    expect((await buy(api, 'focus', 2)).status).toBe(200);
    expect((await buddy(api)).coins).toBe(0);                              /* s1 keeps its 10 */
    await session(api, 's2', base + 60 * MIN, 50);                         /* 10 × 1.4 */
    expect((await buddy(api)).coins).toBe(14);
  });

  it('Finisher adds 2 coins per level to each paying finish', async () => {
    const api = await player('sh-fin');
    await coins(api, 115);
    expect((await buy(api, 'finisher', 1)).status).toBe(200);
    await task(api, 't1');
    expect((await buddy(api)).coins).toBe(5 + 2);
  });
});

describe('the grade bonus', () => {
  it('pays 25 once for a 92 on a class item, nothing more for 85 and back, nothing for a personal grade', async () => {
    const api = await player('sh-grade');
    const s = await makeSpace({ members: { [api.id]: 'member' } });
    await sharedItem(s.scope, 'x1', { type: 'exam', course_id: s.course });
    await mark(api.id, s.id, 'x1', { grade: 92, updated_at: Date.now() });
    expect((await buddy(api)).coins).toBe(25);
    for (const g of [85, 92]) await env.DB.prepare('UPDATE marks SET grade = ?, updated_at = ? WHERE user_id = ? AND item_id = ?').bind(g, Date.now(), api.id, 'x1').run();
    expect((await buddy(api)).coins).toBe(25);
    await api('/api/items/own1', { method: 'PUT', body: { type: 'exam', title: 'Mine', date: isoDay(Date.now()), status: 'graded', grade: 99, notes: '', checklist: [], links: [] } });
    const b = await buddy(api);
    expect(b.recent.filter((r) => r.source.startsWith('grade')).map((r) => r.source).sort()).toEqual([`grade80:c:${s.id}:x1`, `grade90:c:${s.id}:x1`]);
  });

  it('pays nothing for a grade set while gameplay was off', async () => {
    const api = await player('sh-gold');
    const s = await makeSpace({ members: { [api.id]: 'member' } });
    await sharedItem(s.scope, 'x2', { type: 'exam', course_id: s.course });
    await mark(api.id, s.id, 'x2', { grade: 95, updated_at: Date.now() - DAY });
    expect((await buddy(api)).coins).toBe(0);
  });
});

describe('backgrounds, frames and the name', () => {
  it('equips only what you own', async () => {
    const api = await player('sh-cos');
    expect(await (await look(api, { bg: 'bg-night' })).json()).toMatchObject({ error: 'not_owned', field: 'bg' });
    expect((await look(api, { bg: 'frame-gold' })).status).toBe(400);
    await coins(api, 450);
    await buy(api, 'bg-night', 1);
    await buy(api, 'frame-gold', 1);
    const b = await (await look(api, { bg: 'bg-night', frame: 'frame-gold' })).json();
    expect(b.look).toMatchObject({ bg: 'bg-night', frame: 'frame-gold' });
    expect(b.owned).toEqual(['bg-night', 'frame-gold']);
    expect((await (await look(api, { bg: 'none' })).json()).look.bg).toBe('none');
  });

  it('keeps a name of up to 16 characters, trimmed; longer or with control characters is 400', async () => {
    const api = await player('sh-name');
    expect((await (await look(api, { name: '  Professor Mochi ' })).json()).look.name).toBe('Professor Mochi');
    expect((await look(api, { name: 'Professor Mochi II' })).status).toBe(400);
    expect((await look(api, { name: 'a\nb' })).status).toBe(400);
    expect((await (await look(api, { name: '' })).json()).look.name).toBe('');
  });
});

const PIC = { palette: ['#e8913f', '#2e4a2a', '#fff4e6'], rows: ['.00.', '0110', '0220', '.00.'] };
const custom = (api, body) => api('/api/buddy/custom', { method: body ? 'PUT' : 'DELETE', ...(body && { body }) });

describe('the custom buddy', () => {
  it('saves a grid and palette, then can be picked; deleting it puts the look back to auto', async () => {
    const api = await player('sh-cust');
    const saved = await (await custom(api, PIC)).json();
    expect(saved.custom).toEqual(PIC);
    expect((await (await look(api, { buddy: 'custom' })).json()).look.buddy).toBe('custom');
    const gone = await (await custom(api)).json();
    expect(gone.custom).toBeNull();
    expect(gone.look.buddy).toBe('auto');
    expect((await look(api, { buddy: 'custom' })).status).toBe(409);
  });

  it('refuses a wrong size, an unknown palette index, or over 1 KB with 400', async () => {
    const api = await player('sh-bad');
    for (const body of [
      { ...PIC, rows: ['.00.', '0110', '0220'] },
      { ...PIC, rows: ['.00.', '0110', '0230', '.00.'] },
      { ...PIC, rows: Array(25).fill('0'.repeat(25)) },
      { ...PIC, extra: 'x'.repeat(1100) },
      { palette: [], rows: PIC.rows },
    ]) expect(await (await custom(api, body)).json()).toEqual({ error: 'invalid', field: 'custom' });
    expect((await buddy(api)).custom).toBeNull();
  });
});
