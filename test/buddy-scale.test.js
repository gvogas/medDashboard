// Study Buddy with a long history: every Buddy read re-reads the person's sessions, finishes,
// reviews and ledger. Half a year of heavy use, written straight to D1, must still read quickly,
// pay each award once, and leave a second read with nothing to write.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

describe('a long history', () => {
  it('reads half a year of heavy use in one go, pays each award once, and a second read writes nothing', async () => {
    const api = await signIn('scale-a');
    const id = 'u-scale-a', now = Date.now(), start = now - 180 * DAY;
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC' } });
    await env.DB.prepare('UPDATE buddy_settings SET since = ?1, on_at = ?1, reconciled_at = ?1 WHERE user_id = ?2').bind(start, id).run();
    const stmts = [];
    for (let d = 0; d < 180; d++) {
      const t = start + d * DAY + 9 * 3_600_000;
      /* three timed sessions a day (one over the 240 cap), two finished tasks, 30 card reviews */
      for (let s = 0; s < 3; s++) stmts.push(env.DB.prepare('INSERT INTO study_sessions (user_id, id, started_at, study_minutes, manual, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .bind(id, `s${d}-${s}`, t + s * 3_600_000, 100, t + s * 3_600_000 + 6_000_000, t + s * 3_600_000 + 6_000_000));
      for (let k = 0; k < 2; k++) stmts.push(env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, completed_at, created_at, updated_at) VALUES (?, ?, 'task', ?, ?, 'done', ?, ?, ?)")
        .bind('u:' + id, `t${d}-${k}`, 'Task', isoDay(t), t, t, t));
      for (let r = 0; r < 30; r++) stmts.push(env.DB.prepare("INSERT INTO card_reviews (user_id, id, card_ref, deck_ref, day, grade, at, created_at, updated_at) VALUES (?, ?, ?, 'd1', ?, 'good', ?, ?, ?)")
        .bind(id, `r${d}-${r}`, 'k' + r, isoDay(t), t, t, t));
    }
    for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));

    const t0 = performance.now();
    const first = await (await api('/api/buddy')).json();
    const firstMs = performance.now() - t0;
    const rows = async () => (await env.DB.prepare('SELECT count(*) AS n, SUM(amount) AS coins FROM buddy_ledger WHERE user_id = ?').bind(id).first());
    const after = await rows();
    /* 180 days × (3 sessions + 2 finishes + 1 cards day + 1 streak day) */
    expect(after.n).toBe(180 * 7);
    expect(first.coins).toBe(after.coins);
    expect(first.xp).toBe(180 * 240 + 180 * 2 * 10);          /* the 240-minute day holds every day */
    expect(first.streak).toBeGreaterThanOrEqual(180);

    const t1 = performance.now();
    const second = await (await api('/api/buddy')).json();
    const secondMs = performance.now() - t1;
    expect(await rows()).toEqual(after);                      /* nothing new to pay */
    expect(second.coins).toBe(first.coins);
    console.log(`buddy read, 180 days of history: first ${Math.round(firstMs)} ms (pays ${after.n} awards), second ${Math.round(secondMs)} ms`);
    /* generous: a local D1 read of this size takes well under a second; this catches a read gone quadratic */
    expect(secondMs).toBeLessThan(3000);
  }, 60_000);
});
