// The answer rules for AI study material (spec §6): one place that reads a model's answer and
// keeps only what fits, used by the Worker (worker/study-ai.js, Generate here) and the browser
// (Use your own AI, a pasted answer), so both meet the same limits. Plain TypeScript with no
// imports beyond the shared limits: worker/ imports it too.

/* How much text the scans below may walk in all: a pasted answer is up to 200,000 characters, and
   brackets that open and never parse must not make reading it quadratic. */
const SCAN_BUDGET = 2_000_000

/** Where the `{` or `[` at `from` closes, minding strings and nesting; -1 when the text ends first. */
function closeOf(s: string, from: number): number {
  let depth = 0, inString = false
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{' || c === '[') depth++
    else if ((c === '}' || c === ']') && --depth === 0) return i
  }
  return -1
}

/**
 * Every JSON value in the text that stands on its own, in order: each `{` or `[` is followed to
 * where it closes and parsed; one that parses is kept and skipped past, one that does not is
 * looked inside. `only` keeps to objects. `cut` is set when a bracket never closes: what follows
 * it is the inside of a value that was cut off (or prose), not values of their own.
 */
function jsonValues(s: string, only: '{' | null = null): { values: { value: unknown; length: number }[]; cut: boolean } {
  const values: { value: unknown; length: number }[] = []
  let budget = SCAN_BUDGET
  for (let i = 0; i < s.length && budget > 0; i++) {
    if (s[i] !== '{' && s[i] !== '[') continue
    const to = closeOf(s, i)
    budget -= (to < 0 ? s.length : to) - i
    if (to < 0) {
      if (!only) return { values, cut: true }
      continue                        /* salvaging: the whole values inside a cut-off one are what is wanted */
    }
    if (only && s[i] !== only) continue
    try { values.push({ value: JSON.parse(s.slice(i, to + 1)), length: to + 1 - i }); i = to } catch { /* not JSON: look inside it */ }
  }
  return { values, cut: false }
}

const unfenced = (text: string) => text.replace(/```(?:json)?/gi, '')

/**
 * The JSON in a model's answer, after any code fence: models wrap it in prose or ```json, and
 * the prose can have brackets of its own ("the {front, back} shape", "[Source: lecture 3]", a
 * citation "[3]"). The longest value that parses is the answer; of equals, the first. An answer
 * cut off before its JSON closed gives null: half an answer is not one (worker/ai.js asks again).
 */
export function parseLoose(text: string): unknown {
  const s = unfenced(text)
  const { values } = jsonValues(s)
  let best: { value: unknown; length: number } | null = null
  for (const v of values) if (!best || v.length > best.length) best = v
  if (best) return best.value
  /* the reading before this one: the first opening bracket to the last closing one */
  const pairs = [['{', '}'], ['[', ']']].sort((a, b) => (s.indexOf(a[0]) + 1 || Infinity) - (s.indexOf(b[0]) + 1 || Infinity))
  for (const [open, close] of pairs) {
    const from = s.indexOf(open), to = s.lastIndexOf(close)
    if (from < 0 || to <= from) continue
    try { return JSON.parse(s.slice(from, to + 1)) } catch { /* the next shape */ }
  }
  return null
}

/**
 * A study answer's JSON, for both sides (the Worker reading the model, the browser a pasted
 * answer): parseLoose, and when the answer was cut off mid-list (a model out of tokens, a
 * paste that missed the end), the whole objects it did hold, as a list. Null when there are none.
 */
export function parseAnswer(text: string): unknown {
  const whole = parseLoose(text)
  if (whole !== null) return whole
  const objects = jsonValues(unfenced(text), '{').values.map((v) => v.value)
  return objects.length ? objects : null
}

export const CARD_FRONT_MAX = 500
export const CARD_BACK_MAX = 1000
export const CARDS_MAX = 30
/** The most a pasted answer may be (spec §7.1). */
export const PASTE_MAX = 200_000

export interface CardDraft { front: string; back: string }
/** `total` entries in the answer, `usable` of them good (readable and not a repeat), `items` those kept: at most the count asked for. */
export interface Read<T> { items: T[]; total: number; usable: number }

/* plain text: no control characters but line breaks, spaces squeezed at the ends, cut to `max` */
const plain = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}

/* the list an object holds: under `key`, or its one list */
function listIn(r: Record<string, unknown>, key: string): unknown[] {
  if (Array.isArray(r[key])) return r[key] as unknown[]
  const lists = Object.values(r).filter(Array.isArray)
  return lists.length === 1 ? lists[0] as unknown[] : []
}

/** The list an answer holds under `key`: {key: [...]}, a bare list, an object holding one list, or one level down, a wrapper around any of those ({"result": {key: [...]}}). */
function listOf(o: unknown, key: string): unknown[] {
  if (Array.isArray(o)) return o
  if (!o || typeof o !== 'object') return []
  const r = o as Record<string, unknown>
  const own = listIn(r, key)
  if (own.length) return own
  const inner = Object.values(r).filter((v) => !!v && typeof v === 'object' && !Array.isArray(v)).map((v) => listIn(v as Record<string, unknown>, key)).filter((l) => l.length)
  return inner.length === 1 ? inner[0] : own
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
  return { items: items.slice(0, Math.max(1, Math.min(CARDS_MAX, count))), total: list.length, usable: items.length }
}

export type Route = 'cards'
/** A pasted answer read: what fits, out of how many entries it held. Null when no JSON could be found at all. */
export function readAnswer(route: Route, text: string, count = CARDS_MAX): Read<CardDraft> | null {
  const o = parseAnswer(String(text).slice(0, PASTE_MAX))
  if (o === null) return null
  return route === 'cards' ? checkCards(o, count) : null
}
