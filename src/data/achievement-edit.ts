// An achievement of your own: a sticker cut from a picture, a name, and what earns it,
// hours on one course or a grade on one exam or quiz. The draft lives in the sheet's
// state (overlay.ts); the picture being cropped lives only in the sheet component.

import * as store from "@/core/store"
import { uid } from "@/core/model"
import { dayMonth } from "@/core/dates"
import { ownAchievements } from "@/core/achievements"
import { notify } from "@/bridge"
import { closeSheet } from "./overlay"
import { courseRefKey, itemRefKey, refOf } from "./refs"
import type { Achievement, Course, Item, StudySession } from "./types"

export type Rule = Achievement["rule"]

export interface AchievementDraft {
    isNew: boolean
    base: Achievement | null
    id: string
    name: string
    sticker: string
    rule: Rule
    courseId: string | null
    itemId: string | null
    target: number
}

export const NAME_MAX = 40
export const TOP: Record<Rule, number> = { hours: 1000, grade: 100 }
const START: Record<Rule, number> = { hours: 10, grade: 90 }

const firstLive = (courses: Course[]) => courses.find((c) => !c.archived)?.id || null

export function newAchievement(courses: Course[]): AchievementDraft {
    return { isNew: true, base: null, id: uid(), name: "", sticker: "", rule: "hours", courseId: firstLive(courses), itemId: null, target: START.hours }
}

export function achievementDraft(a: Achievement): AchievementDraft {
    return { isNew: false, base: structuredClone(a), id: a.id, name: a.name, sticker: a.sticker, rule: a.rule, courseId: courseRefKey(a), itemId: itemRefKey(a), target: a.target }
}

/** A name, a sticker, a target in range and what it is on; never while a crop is in progress. */
export const validAchievement = (d: AchievementDraft, cropping = false) =>
    !cropping && !!d.name.trim() && !!d.sticker && Number.isInteger(d.target) && d.target >= 1 && d.target <= TOP[d.rule]
    && (d.rule === "hours" ? !!d.courseId : !!d.itemId)

export const footHint = (d: AchievementDraft, cropping = false) =>
    cropping ? "Finish the crop first"
        : !d.sticker ? "Upload a sticker"
            : !d.name.trim() ? "Give it a name"
                : validAchievement(d) ? (d.isNew ? "Ready to add" : "Unsaved changes") : "Not ready yet"

/** Switching what earns it starts the target over, and hours need a course. */
export function switchRule(d: AchievementDraft, rule: Rule, courses: Course[]): AchievementDraft {
    if (d.rule === rule) return d
    return { ...d, rule, target: START[rule], courseId: rule === "hours" ? d.courseId || firstLive(courses) : d.courseId }
}

/** Where it stands now, in a line, as the Study view's panel would show it. */
export function standing(d: AchievementDraft, sessions: StudySession[], items: Item[], courses: Course[]): string {
    if (!(d.rule === "hours" ? d.courseId : d.itemId)) return d.rule === "hours" ? "Pick a course." : "Pick an exam or quiz."
    const [b] = ownAchievements([{ ...d, name: d.name || "This" }], sessions, items, courses)
    return b.earned ? "Already earned, on " + dayMonth(b.earnedOn) + ". It goes on straight away." : b.progress + " so far."
}

/** Save it, keeping what the stored one had besides, and close the sheet. */
export async function saveAchievementDraft(d: AchievementDraft) {
    if (!validAchievement(d)) return
    /* the draft holds keys; the row stores the ids and the space they are in */
    const ref = refOf(d.rule === "hours" ? d.courseId : null, d.rule === "grade" ? d.itemId : null)
    await store.saveAchievement({
        ...(d.base || {}), id: d.id, name: d.name.trim(), sticker: d.sticker, rule: d.rule,
        courseId: ref.courseId, itemId: ref.itemId, spaceId: ref.spaceId, target: d.target,
    })
    closeSheet()
    notify()
}
