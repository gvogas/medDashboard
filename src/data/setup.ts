// The first-run setup: a new account with nothing in it gets four short steps in place of
// an empty Week (a theme, the timetable, a course outline, reviews and a daily goal). Each
// step can be skipped, and so can the whole thing. Finishing or skipping saves `setupDone`
// in the study prefs, which sync, so another device never offers it again.
//
// Once offered, it stays up until finished or skipped, even after the timetable import adds
// the first courses: the steps after it still have something to say.

import { useSyncExternalStore } from "react"
import { normalizePrefs } from "@/core/model"
import { data } from "@/core/store"
import { notify, subscribe } from "@/bridge"
import { savePrefs } from "./study-controller"

export const SETUP_STEPS = ["theme", "timetable", "outline", "habits"] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/* offered this session and not yet finished */
let started = false
/* finished or skipped here, before the profile comes back from the server */
let done = false

/** Nothing of the person's yet: no course, no item, no class or project. */
type Holdings = Pick<typeof data, "profile" | "courses" | "items" | "spaces">
export function isFresh(d: Holdings): boolean {
    return !!d.profile && !d.courses.length && !d.items.length && !d.spaces.length
}

/** Whether to show the setup now. */
export function needsSetup(d: Holdings = data): boolean {
    if (done || !d.profile || normalizePrefs(d.profile.studyPrefs).setupDone) return false
    if (isFresh(d)) started = true
    return started
}

/** Finished or skipped: never again, on any device. */
export async function finishSetup() {
    done = true
    started = false
    notify()
    try { await savePrefs({ setupDone: true }) } catch { /* saved with the next sync */ }
}

export const useNeedsSetup = () => useSyncExternalStore(subscribe, () => needsSetup())

/** Only for tests. */
export function resetSetup() { started = false; done = false }
