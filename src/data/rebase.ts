// A sheet's draft saved onto its row as stored now. A sheet keeps the row as it was when it
// opened; a sync can move the stored row on while it is open (another editor's or device's
// change, or this device's last upload settling at a new revision). Saving the whole draft
// would send the other change back undone, and at a revision the Worker refuses.

import { stable } from "@/core/shared"

/** `stored` with each field of `draft` whose value differs from `opened`'s. With nothing stored, the draft. */
export function rebased<T extends object>(stored: T | null | undefined, opened: T | null | undefined, draft: T): T {
    if (!stored || !opened) return draft
    const was = opened as Record<string, unknown>, now = draft as Record<string, unknown>
    const out = { ...stored } as Record<string, unknown>
    for (const f of Object.keys(now)) if (stable(now[f]) !== stable(was[f])) out[f] = now[f]
    return out as T
}
