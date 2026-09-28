// Hooks over the legacy store (legacy/js/store.js). Every write reloads the store, which
// replaces each collection array and the profile, so the reference itself is the
// snapshot: a component redraws when its collection changed and not otherwise.

import { useSyncExternalStore } from "react"
import * as store from "@/legacy/js/store.js"
import { conflicts, data } from "@/legacy/js/store.js"
import { getVersion, notify, subscribe } from "@/bridge"
import type { Course, Item, Profile, Quote, SavedCopy, StudySession } from "./types"

/* Events after which the data may differ. save-error leaves it as it was. */
const WAKE = new Set(["change", "synced", "hidden", "remote", "signed-out"])
store.subscribe((e: { type: string }) => { if (WAKE.has(e.type)) notify() })

const items = () => data.items as Item[]
const courses = () => data.courses as Course[]
const profile = () => data.profile as Profile | null
const quotes = () => data.quotes as Quote[]
const sessions = () => data.study_sessions as StudySession[]

export const useItems = () => useSyncExternalStore(subscribe, items)
export const useCourses = () => useSyncExternalStore(subscribe, courses)
export const useProfile = () => useSyncExternalStore(subscribe, profile)
export const useQuotes = () => useSyncExternalStore(subscribe, quotes)
export const useStudySessions = () => useSyncExternalStore(subscribe, sessions)

/** Edits the server turned down, kept on this device. The store changes this list in place,
    so the bridge's version is the snapshot. */
export function useConflicts(): SavedCopy[] {
    useSyncExternalStore(subscribe, getVersion)
    return conflicts as SavedCopy[]
}
