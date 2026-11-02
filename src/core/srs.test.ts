import { describe, expect, it } from 'vitest'
import { dueCount, fresh, grade, plusDays, queue, type Schedule } from './srs.ts'

const T = '2026-11-02'
const s = (o: Partial<Schedule>): Schedule => ({ due: T, interval: 0, ease: 2.5, reps: 0, lapses: 0, ...o })

describe('spaced repetition (spec §5)', () => {
  /* [before, grade, after]: the table, row by row */
  const TABLE: [Partial<Schedule> | null, 'again' | 'good' | 'easy', Partial<Schedule>][] = [
    [null, 'good', { interval: 1, reps: 1, ease: 2.5, due: '2026-11-03' }],
    [null, 'easy', { interval: 4, reps: 1, ease: 2.65, due: '2026-11-06' }],
    [null, 'again', { interval: 1, reps: 0, ease: 2.3, lapses: 1, due: '2026-11-03' }],
    [{ reps: 1, interval: 1 }, 'good', { interval: 3, reps: 2, ease: 2.5 }],
    [{ reps: 2, interval: 3 }, 'good', { interval: 8, reps: 3 }],                       /* round(3 × 2.5) */
    [{ reps: 2, interval: 3 }, 'easy', { interval: 10, reps: 3, ease: 2.65 }],          /* round(3 × 2.5 × 1.3) */
    [{ reps: 5, interval: 40, lapses: 2 }, 'again', { interval: 1, reps: 0, ease: 2.3, lapses: 3 }],
    [{ ease: 1.4 }, 'again', { ease: 1.3 }],                                            /* never under 1.3 */
    [{ ease: 2.95, reps: 1, interval: 1 }, 'easy', { ease: 3.0 }],                      /* never over 3.0 */
    [{ reps: 6, interval: 150, ease: 3.0 }, 'good', { interval: 180, due: plusDays(T, 180) }],   /* capped at 180 days */
  ]
  it.each(TABLE)('%o graded %s', (before, g, after) => {
    expect(grade(before ? s(before) : null, g, T)).toMatchObject(after)
  })

  it('counts days across month and year ends', () => {
    expect(plusDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(plusDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('queues due cards first, oldest due first, then up to 20 new cards in deck order', () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ id: 'k' + String(i).padStart(2, '0'), deckId: i < 15 ? 'a' : 'b', createdAt: i }))
    const states = new Map<string, Schedule>([
      ['k05', s({ due: '2026-11-01' })], ['k03', s({ due: '2026-10-30' })], ['k07', s({ due: '2026-11-09' })],
    ])
    const q = queue(cards, states, T)
    expect(q.slice(0, 2).map((c) => c.id)).toEqual(['k03', 'k05'])
    expect(q).toHaveLength(2 + 20)
    expect(q.map((c) => c.id)).not.toContain('k07')
    expect(dueCount(cards, states, T, 15)).toBe(2 + 5)                 /* 15 new already started today */
    expect(dueCount(cards, states, '2026-11-09')).toBe(3 + 20)         /* the next week, k07 is due too */
  })

  it('a new card starts at ease 2.5', () => {
    expect(fresh(T)).toEqual({ due: T, interval: 0, ease: 2.5, reps: 0, lapses: 0 })
  })
})
