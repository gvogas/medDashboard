// Hooks over the store (core/store.ts). Every write reloads the store, which
// replaces each collection array and the profile, so the reference itself is the
// snapshot: a component redraws when its collection changed and not otherwise.

import { useSyncExternalStore } from "react"
import * as store from "@/core/store"
import { conflicts, data } from "@/core/store"
import { getVersion, notify, subscribe } from "@/bridge"
import type { SavedCopy } from "./types"
import { effectiveCourses, effectiveItems } from "./effective"

/* Events after which the data may differ. save-error leaves it as it was. */
const WAKE = new Set(["change", "synced", "hidden", "remote", "signed-out"])
store.subscribe((e: { type: string }) => { if (WAKE.has(e.type)) notify() })

/* What the views read: your own rows and, from Stage 4, your classes' and projects' (effective.ts). */
const items = () => effectiveItems()
const courses = () => effectiveCourses()
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

/* Read with `??`: a test's fake store may hold none of these. */
const NONE: never[] = []
const spaces = () => data.spaces ?? NONE
const sharedCourses = () => data.shared_courses ?? NONE
const sharedItems = () => data.shared_items ?? NONE
/** Your spaces as sync last described them, and your classes' rows: the class sheet reads them (they join the views in Stage 4). */
export const useSpaces = () => useSyncExternalStore(subscribe, spaces)
export const useSharedCourses = () => useSyncExternalStore(subscribe, sharedCourses)
export const useSharedItems = () => useSyncExternalStore(subscribe, sharedItems)
const marks = () => data.marks ?? NONE
const spacePrefs = () => data.space_prefs ?? NONE
/** Your marks on shared items, and your prefs for your spaces: the class item card and the class sheet read them. */
export const useMarks = () => useSyncExternalStore(subscribe, marks)
export const useSpacePrefs = () => useSyncExternalStore(subscribe, spacePrefs)
const removedItems = () => data.removed_items ?? NONE
/** Class items an editor removed, as tombstones: their cards and the class sheet's Removed list read them. */
export const useRemovedItems = () => useSyncExternalStore(subscribe, removedItems)

/** Edits the server turned down, kept on this device. The store changes this list in place,
    so the bridge's version is the snapshot. */
export function useConflicts(): SavedCopy[] {
    useSyncExternalStore(subscribe, getVersion)
    return conflicts
}
