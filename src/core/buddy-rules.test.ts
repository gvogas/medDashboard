import { describe, expect, it } from 'vitest';
import { TIERS, tierOf, nextTier, moodOf, FINISHED, isReview, UPGRADES, COSMETICS, upgradeCost, checkCustom, CUSTOM_BYTES } from './buddy-rules.ts';
import { reviewId } from './reviews.ts';

describe('buddy rules', () => {
  it('has seven tiers in rising order, Legend at 4,000 XP', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['egg', 'hatchling', 'r3', 'r4', 'r5', 'r6', 'legend']);
    expect(TIERS.every((t, i) => i === 0 || t.minXp > TIERS[i - 1].minXp)).toBe(true);
    expect(TIERS.at(-1)).toMatchObject({ minXp: 4000, reward: 800 });
  });
  it('picks the highest tier reached and the next one', () => {
    expect(tierOf(0).id).toBe('egg');
    expect(tierOf(119).id).toBe('egg');
    expect(tierOf(120).id).toBe('hatchling');
    expect(nextTier(120)).toMatchObject({ id: 'r3', minXp: 300 });
    expect(nextTier(9999)).toBeNull();
  });
  it('maps health to a mood', () => {
    expect([100, 70, 69, 40, 39, 15, 14, 0].map(moodOf)).toEqual(['happy', 'happy', 'tired', 'tired', 'sick', 'sick', 'hurt', 'hurt']);
  });
  it('counts done, submitted and graded as finished', () => {
    expect(FINISHED).toEqual(['done', 'submitted', 'graded']);
  });
  it('knows a lecture review task by its id and title, as reviews.ts makes them', () => {
    const id = reviewId('pharm', 'm1', '2026-09-14', 1);
    expect(isReview(id, 'Review 1/4 · PHARM Lecture Mon 14 Sep')).toBe(true);
    expect(isReview(id, 'My own task')).toBe(false);
    expect(isReview('t1', 'Review 1/4 · PHARM Lecture Mon 14 Sep')).toBe(false);
  });

  it('prices upgrade levels as base + step × level, and opens only the ones whose stage has shipped', () => {
    const focus = UPGRADES.find((u) => u.sku === 'focus')!;
    expect([1, 2, 5].map((n) => upgradeCost(focus, n))).toEqual([75, 110, 215]);
    expect(UPGRADES.filter((u) => u.open).map((u) => u.sku)).toEqual(['focus', 'finisher']);
    expect(new Set([...UPGRADES, ...COSMETICS].map((x) => x.sku)).size).toBe(UPGRADES.length + COSMETICS.length);
    expect(COSMETICS.every((c) => c.cost >= 30 && c.cost <= 300 && c.sku.startsWith(c.kind + '-'))).toBe(true);
  });
  it('checks a custom buddy: n rows of n palette indexes, 1-16 colours, at most 1 KB', () => {
    const ok = { palette: ['#112233', '#aabbcc'], rows: ['.01.', '0110', '0110', '.00.'] };
    expect(checkCustom(ok)).toEqual(ok);
    expect(checkCustom({ ...ok, rows: ['.01.', '0110', '0110'] })).toBeNull();               /* not square */
    expect(checkCustom({ ...ok, rows: ['.02.', '0110', '0110', '.00.'] })).toBeNull();       /* no colour 2 */
    expect(checkCustom({ ...ok, palette: ['red', '#aabbcc'] })).toBeNull();
    expect(checkCustom({ ...ok, rows: ['....', '....', '....', '....'] })).toBeNull();      /* nothing to show */
    expect(checkCustom({ ...ok, rows: Array(3).fill('...') })).toBeNull();                  /* under 4 */
    expect(checkCustom({ palette: ok.palette, rows: Array(25).fill('0'.repeat(25)) })).toBeNull();
    const full = { palette: Array.from({ length: 16 }, (_, i) => '#0000' + i.toString(16).padStart(2, '0')), rows: Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => ((x + y) % 16).toString(16)).join('')) };
    expect(JSON.stringify(full).length).toBeLessThanOrEqual(CUSTOM_BYTES);
    expect(checkCustom(full)).toEqual(full);                                                   /* the largest fits */
    expect(checkCustom({ ...ok, note: 'x'.repeat(CUSTOM_BYTES) })).toBeNull();                /* over 1 KB as sent */
    expect(checkCustom(null)).toBeNull();
  });
});
