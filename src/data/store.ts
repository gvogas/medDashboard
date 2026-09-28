// Hooks over the store (core/store.ts). Every write reloads the store, which
// replaces each collection array and the profile, so the reference itself is the
// snapshot: a component redraws when its collection changed and not otherwise.

import { useSyncExternalStore } from "react"
import * as store from "@/core/store"
import { conflicts, data } from "@/core/store"
import { getVersion, notify, subscribe } from "@/bridge"
import type { SavedCopy } from "./types"

/* Events after which the data may differ. save-error leaves it as it was. */
const WAKE = new Set(["change", "synced", "hidden", "remote", "signed-out"])
store.subscribe((e: { type: string }) => { if (WAKE.has(e.type)) notify() })

const items = () => data.items
const courses = () => data.courses
const profile = () => data.profile
const quotes = () => data.quotes
const sessions = () => data.study_sessions
const achievements = () => data.achievements

export const useItems = () => useSyncExternalStore(subscribe, items)
export const useCourses = () => useSyncExternalStore(subscribe, courses)
export const useProfile = () => useSyncExternalStore(subscribe, profile)
export const useQuotes = () => useSyncExternalStore(subscribe, quotes)
export const useStudySessions = () => useSyncExternalStore(subscribe, sessions)
/** Your own achievements (the built-in badges are worked out from the data, in study.ts). */
export const useAchievements = () => useSyncExternalStore(subscribe, achievements)

/** Edits the server turned down, kept on this device. The store changes this list in place,
    so the bridge's version is the snapshot. */
export function useConflicts(): SavedCopy[] {
    useSyncExternalStore(subscribe, getVersion)
    return conflicts
}
