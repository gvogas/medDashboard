// What the Worker and the client agree on about shared rows (a class's or a project's
// courses and items): the fields each kind shares, how two values compare, and how a
// pending key names a shared row. Plain TypeScript with no imports: worker/ uses it too.

/** The fields a shared row's `changed` may name, in API shape (spec §4). */
export const SHARED_FIELDS = {
  courses: ['code', 'name', 'color', 'instructor', 'term', 'meetings'],
  class: ['type', 'title', 'courseId', 'date', 'start', 'end', 'where', 'weight', 'notes', 'links', 'recur', 'weekday', 'recurUntil', 'dept'],
  project: ['type', 'title', 'date', 'start', 'end', 'where', 'status', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recurUntil', 'dept', 'completedAt', 'assignees'],
  /* your mark: written with a field-level merge too, since two of your devices can both make it (spec §6) */
  marks: ['status', 'grade', 'weight', 'notes', 'checklist', 'completedAt', 'hidden'],
} as const satisfies Record<string, readonly string[]>
export type FieldSet = keyof typeof SHARED_FIELDS

/** JSON with object keys sorted, so equal values compare equal however they were built. Undefined reads as null. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}

/** What each field of a mark holds before you touch the item: what a first write merges against. */
export const MARK_DEFAULTS: Record<string, unknown> = { status: 'todo', grade: null, weight: null, notes: '', checklist: [], completedAt: null, hidden: false }

/** The most the inbox's unread count says (spec §12): the Worker counts no higher, the bell reads it as "99+". */
export const UNREAD_CAP = 99

/** How long a tombstone lasts before the nightly purge removes it (worker/index.js); the device drops a removed class item it holds after as long. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** A mark holding anything of yours besides "not mine" (worker/leaving.js `MEANINGFUL`): a removed item with one waits for you (spec §13). */
export const meaningfulMark = (m: Record<string, unknown>): boolean =>
  ['status', 'grade', 'weight', 'notes', 'checklist', 'completedAt'].some((f) => stable(m[f] ?? MARK_DEFAULTS[f]) !== stable(MARK_DEFAULTS[f]))

export type SharedStore = 'shared_courses' | 'shared_items'
export const SHARED_STORES: SharedStore[] = ['shared_courses', 'shared_items']

/** The pending key of a shared row: its store, then its scope, then its id. */
export const sharedKey = (store: SharedStore, scope: string, id: string): string => `${store}:${scope}:${id}`

/**
 * What a pending key names. 'profile'; a personal '<kind>:<id>'; a shared
 * 'shared_items:c:<space id>:<id>'. A space id never holds ':', so a shared scope ends at
 * the key's third ':'; the id after it may hold ':' itself (spec §7).
 */
export function parseKey(key: string): { store: string; scope: string | null; id: string } {
  if (key === 'profile') return { store: 'meta', scope: null, id: 'profile' }
  const at = key.indexOf(':'), store = key.slice(0, at), rest = key.slice(at + 1)
  if (store === 'shared_courses' || store === 'shared_items') {
    const end = rest.indexOf(':', 2)
    return { store, scope: rest.slice(0, end), id: rest.slice(end + 1) }
  }
  return { store, scope: null, id: rest }
}

/** The field set of a shared row (its course's, a class item's or a project item's), or of a mark. */
export const fieldSetOf = (store: string, scope: string): FieldSet =>
  store === 'marks' ? 'marks' : store === 'shared_courses' || store === 'courses' ? 'courses' : scope.startsWith('p:') ? 'project' : 'class'

/**
 * What a shared edit changed since it was queued, as `changed: {field: value before}`.
 * A new row (no base) names every shared field with null before: the server merges a
 * create against its own defaults (spec §6).
 */
export function changedFields(store: string, scope: string, body: Record<string, unknown>, base: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of SHARED_FIELDS[fieldSetOf(store, scope)]) {
    if (!base) out[f] = null
    else if (stable(body[f]) !== stable(base[f])) out[f] = base[f] ?? null
  }
  return out
}

/** A generated lecture review's id (core/reviews.ts): 'rv', seven characters, its step. A review is yours alone and never goes into a class (spec §13). */
export const REVIEW_ID = /^rv[0-9a-z]{7}([1-4])$/

/**
 * A join code as typed: Crockford base32 read the forgiving way (any case, O as 0, I and L
 * as 1, spaces and hyphens dropped). The eight characters, or null (spec §11).
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : null
}
