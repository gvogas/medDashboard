// Study Buddy, Stage 3: card reviews pay `cards:<day>` coins, heal the buddy and count toward the streak.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { cardAwards, streakAwards } from '../worker/buddy.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
async function player(name) {
  const api = await signIn(name);
  api.id = 'u-' + name;
  await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC' } });
  return api;
}
const buddy = async (api) => (await api('/api/buddy')).json();
/* n reviews today, each of a different card unless `cards` says how many distinct */
async function reviews(api, n, { day = isoDay(Date.now()), cards = n, prefix = 'r' } = {}) {
  for (let i = 0; i < n; i++) {
    const r = await api(`/api/card_reviews/${prefix}${i}`, { method: 'PUT', body: { cardRef: 'k' + (i % cards), deckRef: 'd1', day, grade: 'good', at: Date.now() } });
    expect(r.status).toBe(200);
  }
}

describe('card rewards', () => {
  it('pays one coin per 10 reviews a day, and the day counts for the streak', async () => {
    const api = await player('bc-coins');
    await reviews(api, 9);
    expect(await buddy(api)).toMatchObject({ coins: 0, streak: 0 });
    await reviews(api, 1, { prefix: 'x' });
    const b = await buddy(api);
    expect(b.streak).toBe(1);
    expect(b.coins).toBe(1 + 2);                                   /* a card coin and a streak day */
    await reviews(api, 25, { prefix: 'y' });
    expect((await buddy(api)).coins).toBe(3 + 2);                   /* 35 reviews: 3 coins, the row grew */
    expect((await env.DB.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = 'u-bc-coins' AND source GLOB 'cards:*'").first()).n).toBe(1);
  });

  it('heals 2 per card reviewed a day', async () => {
    const api = await player('bc-heal');
    /* a missed lab today: -10 */
    await api('/api/items/lab1', { method: 'PUT', body: { type: 'lab', title: 'Lab', date: isoDay(Date.now()), status: 'missed', notes: '', checklist: [], links: [] } });
    expect((await buddy(api)).health).toBe(90);
    await reviews(api, 4, { cards: 3 });                            /* three cards, one twice */
    expect((await buddy(api)).health).toBe(96);
  });

  it('pays nothing for reviews made while gameplay was off', async () => {
    const api = await player('bc-off');
    await env.DB.prepare('UPDATE buddy_settings SET on_at = ? WHERE user_id = ?').bind(Date.now() + DAY, api.id).run();
    await reviews(api, 20);
    expect(await buddy(api)).toMatchObject({ coins: 0, streak: 1 });   /* the day still counts for the streak, but nothing pays */
  });

  it('answers how many cards are due today', async () => {
    const api = await player('bc-due');
    for (const [id, due] of [['k1', '2020-01-01'], ['k2', isoDay(Date.now())], ['k3', '2999-01-01']]) {
      await api(`/api/card_state/${id}`, { method: 'PUT', body: { due, interval: 1, ease: 2.5, reps: 1, lapses: 0 } });
    }
    expect((await buddy(api)).due).toBe(2);
  });

  it('caps card coins at 10 a day plus one per Card Foundry level', () => {
    expect(cardAwards({ '2026-11-02': 250 })).toEqual([{ source: 'cards:2026-11-02', amount: 10, day: '2026-11-02' }]);
    expect(cardAwards({ '2026-11-02': 250 }, () => 3)[0].amount).toBe(13);
    expect(cardAwards({ '2026-11-02': 9 })).toEqual([]);
    expect(streakAwards({}, '2026-11-01', '2026-11-02', { '2026-11-01': 10, '2026-11-02': 3 }).streak).toBe(1);
  });
});
