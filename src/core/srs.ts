// Spaced repetition (spec §5): a simplified SM-2 with three grades, run in the browser so review
// works offline. A card's schedule is a card_state row; each review is a card_reviews row. Pure:
// days are local YYYY-MM-DD strings, so the same inputs always give the same queue.

export type Grade = 'again' | 'good' | 'easy'
export interface Schedule { due: string; interval: number; ease: number; reps: number; lapses: number }

export const NEW_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_EASE = 3.0
export const MAX_INTERVAL = 180
export const NEW_PER_DAY = 20            /* new cards a day, per class */

/** A card with no schedule yet. */
export const fresh = (today: string): Schedule => ({ due: today, interval: 0, ease: NEW_EASE, reps: 0, lapses: 0 })

/** `day` + `n` days, as YYYY-MM-DD (UTC arithmetic on a date-only string, so no time zone can shift it). */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** The schedule after grading a card on `today` (spec §5's table); `due` is today + the interval, at most 180 days. */
export function grade(s: Schedule | null | undefined, g: Grade, today: string): Schedule {
  const cur = s ?? fresh(today)
  let { interval, ease, reps, lapses } = cur
  if (g === 'again') {
    reps = 0; interval = 1; ease = Math.max(MIN_EASE, round2(ease - 0.2)); lapses += 1
  } else if (g === 'good') {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease)
    reps += 1
  } else {
    interval = reps === 0 ? 4 : Math.round(interval * ease * 1.3)
    ease = Math.min(MAX_EASE, round2(ease + 0.15))
    reps += 1
  }
  interval = Math.max(1, Math.min(MAX_INTERVAL, interval))
  return { due: plusDays(today, interval), interval, ease, reps, lapses }
}

export interface QueueCard { id: string; deckId: string; createdAt: number }

/**
 * Today's queue for one class's cards: due cards first (oldest due first), then new cards (no
 * schedule) in deck order, up to NEW_PER_DAY less the new cards already started today.
 */
export function queue<C extends QueueCard>(cards: C[], states: Map<string, Schedule>, today: string, newStartedToday = 0): C[] {
  const due = cards.filter((c) => { const s = states.get(c.id); return !!s && s.due <= today })
    .sort((a, b) => states.get(a.id)!.due.localeCompare(states.get(b.id)!.due) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const room = Math.max(0, NEW_PER_DAY - newStartedToday)
  const fresh = cards.filter((c) => !states.has(c.id))
    .sort((a, b) => a.deckId.localeCompare(b.deckId) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(0, room)
  return [...due, ...fresh]
}

/** How many a queue holds, without building it. */
export const dueCount = (cards: QueueCard[], states: Map<string, Schedule>, today: string, newStartedToday = 0): number =>
  queue(cards, states, today, newStartedToday).length
