// Your eye toggles (spec §9): the sources you hid from your Week and Month, kept in the
// profile's hiddenSources ('course:<id>', 'space:<sid>', 'personal') and synced with it.
// All items, the stat tiles and grades still count them; the calendar feed honours them from
// Stage 6.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { notify } from "@/bridge"
import { toast } from "./toast"

/** The most sources you can hide at once (the profile's CHECK). */
export const HIDDEN_MAX = 40
export const hiddenSources = (): string[] => data.profile?.hiddenSources ?? []

/** Hide a source, or show it again. */
export async function toggleSource(source: string): Promise<void> {
    const now = hiddenSources()
    if (!now.includes(source) && now.length >= HIDDEN_MAX) { toast("You can hide " + HIDDEN_MAX + " at most. Show one again first."); return }
    await store.saveProfile({ hiddenSources: now.includes(source) ? now.filter((s) => s !== source) : [...now, source] })
    notify()
}
