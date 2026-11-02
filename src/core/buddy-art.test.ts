import { describe, expect, it } from 'vitest';
import { BUDDIES, BUDDY_ORDER, N, buddyFor, rankName, sprite, type Grid } from './buddy-art.ts';
import { MOODS, TIERS } from './buddy-rules.ts';

const INK = '#1E1B24', GOLD_OUT = '#7A4A00';
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const count = (g: Grid, test: (c: string | null) => boolean) => g.flat().filter(test).length;

describe('buddy art', () => {
  it('has six buddies, one per theme, each with a rank name for every tier', () => {
    expect(BUDDY_ORDER).toEqual(['med', 'cs', 'law', 'pilot', 'sports', 'eng']);
    for (const b of BUDDY_ORDER) expect(BUDDIES[b].ranks).toHaveLength(TIERS.length);
    expect(rankName('med', 5)).toBe('Resident');
    expect(rankName('cs', 6)).toBe('10x engineer');
  });

  it('draws every buddy, tier, mood and frame inside 32 × 32, with an outline', () => {
    for (const b of BUDDY_ORDER) for (let t = 0; t < 7; t++) for (const m of MOODS) for (const f of [0, 1] as const) {
      const g = sprite(b, t, m, f);
      expect(g).toHaveLength(N);
      expect(g.every((row) => row.length === N)).toBe(true);
      expect(count(g, (c) => c === INK || c === GOLD_OUT)).toBeGreaterThan(10);
    }
  });

  /* a change to any pixel fails here: update the table on purpose, after looking at design/study-buddies-prototype.html */
  it('matches the art as it was approved', () => {
    const hashes = Object.fromEntries(BUDDY_ORDER.map((b) => {
      let all = '';
      for (let t = 0; t < 7; t++) for (const m of MOODS) for (const f of [0, 1] as const) all += JSON.stringify(sprite(b, t, m, f));
      return [b, fnv(all)];
    }));
    expect(hashes).toEqual({ med: '5nab56', cs: 'whah7k', law: '14vx9hs', pilot: '1whpxvq', sports: '9hplxy', eng: '1b11udy' });
  });

  it('adds gear as it grows: an egg has no eyes, the legend has a gold outline and glow', () => {
    const egg = sprite('med', 0, 'happy'), r3 = sprite('med', 3, 'happy'), legend = sprite('med', 6, 'happy');
    expect(count(egg, (c) => c === '#FFFFFF')).toBe(0);                     /* the white of an eye */
    expect(count(r3, (c) => c === '#2FA59A')).toBeGreaterThan(0);           /* the surgical cap */
    expect(count(sprite('med', 2, 'happy'), (c) => c === '#2FA59A')).toBe(0);
    expect(count(sprite('med', 4, 'happy'), (c) => c === '#A87A4A')).toBeGreaterThan(0);   /* the clipboard */
    expect(count(sprite('med', 5, 'happy'), (c) => c === '#F6FAFA')).toBeGreaterThan(0);   /* the white coat */
    expect(count(legend, (c) => c === GOLD_OUT)).toBeGreaterThan(10);
    expect(count(legend, (c) => c?.startsWith('rgba') ?? false)).toBeGreaterThan(0);
  });

  it('follows the profile theme on auto, and keeps a picked buddy', () => {
    expect(buddyFor({ buddy: 'auto' }, 'law')).toBe('law');
    expect(buddyFor(null, 'cs')).toBe('cs');
    expect(buddyFor({ buddy: 'pilot' }, 'law')).toBe('pilot');
    expect(buddyFor({ buddy: 'dragon' }, 'nope')).toBe('med');
  });
});
