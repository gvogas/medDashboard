// The Study Buddy's rules on plain rows: counted minutes, finishes, XP, health, streak.
import { describe, expect, it } from 'vitest';
import { countSessions, sessionAwards, finishAwards, xpOf, healthOf, streakAwards, gradeAwards, levelAt } from '../worker/buddy.js';

const H = 3_600_000, MIN = 60_000;
const T = Date.UTC(2026, 10, 2, 12);                  /* 2026-11-02 12:00 UTC */
const TZ = 'UTC';
const s = (id, startedAt, minutes, more = {}) => ({ id, started_at: startedAt, study_minutes: minutes, manual: 0, created_at: startedAt + minutes * MIN, deleted_at: null, ...more });

describe('counted minutes', () => {
  it('counts timed minutes only, at most 240 a day across sessions, in start order', () => {
    const rows = [s('a', T, 200), s('b', T + 4 * H, 100), s('m', T, 60, { manual: 1 }), s('d', T, 30, { deleted_at: T + H })];
    expect(countSessions(rows, TZ, 0)).toEqual([{ id: 'a', day: '2026-11-02', counted: 200 }, { id: 'b', day: '2026-11-02', counted: 40 }]);
  });
  it('ignores sessions before gameplay was on and sessions saved more than 48 h after they began', () => {
    const rows = [s('old', T - H, 30), s('late', T, 30, { created_at: T + 49 * H })];
    expect(countSessions(rows, TZ, T)).toEqual([]);
  });
  it('splits days in the stored zone', () => {
    const late = Date.UTC(2026, 10, 3, 3);              /* 22:00 on 11-02 in Toronto */
    expect(countSessions([s('t', late, 30)], 'America/Toronto', 0)[0].day).toBe('2026-11-02');
  });
  it('pays a coin per 5 counted minutes', () => {
    expect(sessionAwards([{ id: 'a', day: '2026-11-02', counted: 47 }])).toEqual([{ source: 'session:a', amount: 9, day: '2026-11-02' }]);
    expect(sessionAwards([{ id: 'b', day: '2026-11-02', counted: 4 }])).toEqual([]);
  });
});

describe('finishes', () => {
  const item = (id, type, more = {}) => ({ key: 'u:' + id, scope: 'u', id, type, status: 'done', completed_at: T, title: id, ...more });
  const opts = (more = {}) => ({ tz: TZ, from: T - H, now: T, ...more });
  it('orders by finish time; over 5 personal finishes a day writes 0; class finishes have no limit and pay 15 for an exam', () => {
    /* finished in this order: t1..t6 a minute apart, then the two exams at T */
    const rows = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => item(id, 'task', { completed_at: T - (6 - i) * MIN }));
    rows.push(item('e1', 'exam'));                                                     /* a personal exam shares the 5, and pays 5 */
    rows.push({ ...item('x1', 'exam'), key: 'c:sp:x1', scope: 'c' });               /* a class exam: no limit, 15 */
    const out = finishAwards(rows, opts());
    expect(out.filter((a) => a.amount > 0).map((a) => a.source)).toEqual(['item:u:t1', 'item:u:t2', 'item:u:t3', 'item:u:t4', 'item:u:t5', 'item:c:sp:x1']);
    expect(out.find((a) => a.source === 'item:c:sp:x1').amount).toBe(15);
    expect(out.filter((a) => a.amount === 0).map((a) => a.source)).toEqual(['item:u:t6', 'item:u:e1']);
  });
  it('gives lecture reviews their own 4 a day', () => {
    const rv = (n) => item('rvabc' + n, 'task', { title: `Review 1/4 · PHARM Lecture Mon ${n} Sep`, completed_at: T - (9 - n) * MIN });
    const out = finishAwards([1, 2, 3, 4, 5].map(rv), opts({ used: { '2026-11-02': { personal: 5, review: 0 } } }));
    expect(out.map((a) => a.amount)).toEqual([5, 5, 5, 5, 0]);
  });
  it('counts on from what earlier reads already paid that day', () => {
    const out = finishAwards([item('t7', 'task')], opts({ used: { '2026-11-02': { personal: 5, review: 0 } } }));
    expect(out[0].amount).toBe(0);
  });
  it('dates a finish no earlier than the last look and no later than now', () => {
    expect(finishAwards([item('t', 'task', { completed_at: T - 30 * 24 * H })], opts())[0].day).toBe('2026-11-02');
    expect(finishAwards([item('t', 'task', { completed_at: T + 30 * 24 * H })], opts())[0].day).toBe('2026-11-02');
    expect(finishAwards([item('t', 'task', { completed_at: null })], opts())[0].day).toBe('2026-11-02');
  });
});

describe('XP', () => {
  it('is counted minutes plus 10 per paid finish still finished, plus the bonus', () => {
    expect(xpOf({ counted: [{ counted: 200 }, { counted: 40 }], finishes: 3, bonus: 50 })).toBe(240 + 30 + 50);
  });
});

describe('health', () => {
  const days = (n) => Array.from({ length: n }, (_, i) => new Date(T - (n - 1 - i) * 24 * H).toISOString().slice(0, 10));
  it('starts at 100, loses 10 for a missed lab and 5 for each idle day from the 4th, gains 1 per 10 minutes', () => {
    const window = days(6);                                                     /* 10-28 .. 11-02 */
    const h = healthOf({ window, minutesByDay: { '2026-11-02': 25 }, events: [{ day: '2026-10-28', change: -10 }] });
    /* -10 on 10-28; idle 10-28..11-01 is five days: the 4th and 5th cost 5 each; +2 on 11-02 */
    expect(h).toBe(100 - 10 - 10 + 2);
  });
  it('never goes below 0 or above 100', () => {
    expect(healthOf({ window: days(1), minutesByDay: { [days(1)[0]]: 2000 }, events: [] })).toBe(100);
    expect(healthOf({ window: days(1), minutesByDay: {}, events: Array(20).fill({ day: days(1)[0], change: -10 }) })).toBe(0);
  });
});

describe('streak', () => {
  it('pays 2 per streak day, at most 20; a past day under 15 minutes resets it', () => {
    const m = { '2026-10-30': 15, '2026-10-31': 20, '2026-11-01': 5, '2026-11-02': 30 };
    expect(streakAwards(m, '2026-10-30', '2026-11-02')).toEqual({
      awards: [{ source: 'streak:2026-10-30', amount: 2, day: '2026-10-30' }, { source: 'streak:2026-10-31', amount: 4, day: '2026-10-31' }, { source: 'streak:2026-11-02', amount: 2, day: '2026-11-02' }],
      streak: 1,
    });
  });
  it('leaves the run standing while today is still under 15 minutes, and caps the pay at 20', () => {
    const m = {};
    for (let d = 1; d <= 12; d++) m[`2026-10-${String(d).padStart(2, '0')}`] = 30;
    const { awards, streak } = streakAwards(m, '2026-10-01', '2026-10-13');
    expect(streak).toBe(12);
    expect(awards.at(-1)).toEqual({ source: 'streak:2026-10-12', amount: 20, day: '2026-10-12' });
  });
});

describe('Stage 2 rules', () => {
  it('Focus Engine: +20% a level on the coins, rounded down', async () => {
    const c = [{ id: 'a', day: '2026-11-02', counted: 47 }];
    expect(sessionAwards(c, () => 1)[0].amount).toBe(10);             /* 9 × 1.2 = 10.8 */
    expect(sessionAwards(c, () => 5)[0].amount).toBe(18);             /* 9 × 2 */
  });
  it('a level counts from the spend that bought it', async () => {
    const ledger = [{ source: 'buy:focus:1', at: 10 }, { source: 'buy:focus:2', at: 20 }, { source: 'buy:finisher:1', at: 5 }];
    expect([5, 10, 15, 25].map((t) => levelAt(ledger, 'focus', t))).toEqual([0, 1, 1, 2]);
  });
  it('the grade bonus pays each step once', async () => {
    const rows = [{ key: 'c:s:1', grade: 92 }, { key: 'c:s:2', grade: 81 }, { key: 'c:s:3', grade: 79.9 }];
    expect(gradeAwards(rows, new Set(['grade80:c:s:1']), '2026-11-02').map((a) => [a.source, a.amount]))
      .toEqual([['grade90:c:s:1', 15], ['grade80:c:s:2', 10]]);
  });
  it('Finisher adds to paying finishes only', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ key: 'u:t' + i, scope: 'u', id: 't' + i, type: 'task', title: 't', completed_at: Date.UTC(2026, 10, 2, 12) }));
    const out = finishAwards(rows, { tz: 'UTC', from: 0, now: Date.UTC(2026, 10, 2, 13), finisher: 2 });
    expect(out.map((a) => a.amount)).toEqual([9, 9, 9, 9, 9, 0]);
  });
});
