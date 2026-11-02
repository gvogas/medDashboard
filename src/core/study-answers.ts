// The answer rules for AI study material (spec §6): one place that reads a model's answer and
// keeps only what fits, used by the Worker (worker/study-ai.js, Generate here) and the browser
// (Use your own AI, a pasted answer), so both meet the same limits. Plain TypeScript with no
// imports beyond the shared limits: worker/ imports it too.

/** The first {...} or [...] that parses, after any code fence: models wrap JSON in prose or ```json. */
export function parseLoose(text: string): unknown {
  const s = text.replace(/```(?:json)?/gi, '')
  /* whichever opens first: a list of objects is a list, not its first object */
  const pairs = [['{', '}'], ['[', ']']].sort((a, b) => (s.indexOf(a[0]) + 1 || Infinity) - (s.indexOf(b[0]) + 1 || Infinity))
  for (const [open, close] of pairs) {
    const from = s.indexOf(open), to = s.lastIndexOf(close)
    if (from < 0 || to <= from) continue
    try { return JSON.parse(s.slice(from, to + 1)) } catch { /* the next shape */ }
  }
  return null
}

export const CARD_FRONT_MAX = 500
export const CARD_BACK_MAX = 1000
export const CARDS_MAX = 30
/** The most a pasted answer may be (spec §7.1). */
export const PASTE_MAX = 200_000

export interface CardDraft { front: string; back: string }
export interface Read<T> { items: T[]; total: number }

/* plain text: no control characters but line breaks, spaces squeezed at the ends, cut to `max` */
const plain = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}

/** The list an answer holds under `key`: {key: [...]}, a bare list, or an object holding one list. */
function listOf(o: unknown, key: string): unknown[] {
  if (Array.isArray(o)) return o
  if (!o || typeof o !== 'object') return []
  const r = o as Record<string, unknown>
  if (Array.isArray(r[key])) return r[key] as unknown[]
  const lists = Object.values(r).filter(Array.isArray)
  return lists.length === 1 ? lists[0] as unknown[] : []
}

/** Cards from an answer already parsed: each {front, back} kept, cut to the limits; the rest dropped. At most `count`. */
export function checkCards(o: unknown, count = CARDS_MAX): Read<CardDraft> {
  const list = listOf(o, 'cards')
  const items: CardDraft[] = []
  const seen = new Set<string>()
  for (const c of list) {
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>
    const front = plain(r.front ?? r.question ?? r.q, CARD_FRONT_MAX), back = plain(r.back ?? r.answer ?? r.a, CARD_BACK_MAX)
    if (!front || !back) continue
    const key = front.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ front, back })
  }
  return { items: items.slice(0, Math.max(1, Math.min(CARDS_MAX, count))), total: list.length }
}

export type Route = 'cards'
/** A pasted answer read: what fits, out of how many entries it held. Null when no JSON could be found at all. */
export function readAnswer(route: Route, text: string, count = CARDS_MAX): Read<CardDraft> | null {
  const o = parseLoose(String(text).slice(0, PASTE_MAX))
  if (o === null) return null
  return route === 'cards' ? checkCards(o, count) : null
}
