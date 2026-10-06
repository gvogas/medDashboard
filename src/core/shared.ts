// What the Worker and the client agree on about shared rows (a class's or a project's
// courses and items): the fields each kind shares, how two values compare, and how a
// pending key names a shared row. Plain TypeScript with no imports: worker/ uses it too.

/** The fields a shared row's `changed` may name, in API shape (spec §4). */
export const SHARED_FIELDS = {
  courses: ['code', 'name', 'color', 'instructor', 'term', 'meetings'],
  class: ['type', 'title', 'courseId', 'date', 'start', 'end', 'where', 'weight', 'notes', 'links', 'recur', 'weekday', 'recurUntil', 'dept'],
  project: ['type', 'title', 'date', 'start', 'end', 'where', 'status', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recurUntil', 'dept', 'completedAt', 'assignees'],
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

/** The field set of a shared row: its course's, a class item's or a project item's. */
export const fieldSetOf = (store: string, scope: string): FieldSet =>
  store === 'shared_courses' || store === 'courses' ? 'courses' : scope.startsWith('p:') ? 'project' : 'class'

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
