import { describe, expect, it } from "vitest"
import { normalizeItem } from "@/core/model"
import { studyTimeline } from "@/core/study-timeline"
import { mergeItems } from "./effective"
import type { Item, Mark, SharedItem } from "./types"

const t = (text: string, done = false) => ({ id: text, text, done })

/* a class's exam row as the store keeps it, and your mark on it */
const classExam = (over: Partial<SharedItem> = {}): SharedItem => ({
    ...normalizeItem({ id: "mid", type: "exam", title: "Bio midterm", date: "2026-10-22", status: "todo", checklist: [t("Cells"), t("Genetics")], courseId: "bio" }),
    scope: "c:s1", updatedBy: null, assignees: [], completedBy: null, ...over,
} as SharedItem)
const mark = (over: Partial<Mark> = {}): Mark => ({ id: "s1:mid", spaceId: "s1", itemId: "mid", status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: false, ...over } as Mark)

describe("studyTimeline with class exams", () => {
    it("includes a class exam with your mark applied: your done topics drop out", () => {
        const marks = new Map([["s1:mid", mark({ checklist: [t("Cells", true), t("Genetics")] as Mark["checklist"] })]])
        const tl = studyTimeline(mergeItems([], [classExam()], { marks }) as Item[], "2026-10-20", [], 14)
        expect(tl.map((e) => [e.date, e.exam, e.topics])).toEqual([["2026-10-20", "Bio midterm", ["Genetics"]]])
        expect(tl[0].examKey).toBe("c:s1/mid")
    })

    it("skips a class exam that you marked done", () => {
        const marks = new Map([["s1:mid", mark({ status: "done" })]])
        expect(studyTimeline(mergeItems([], [classExam()], { marks }) as Item[], "2026-10-20", [], 14)).toEqual([])
    })

    it("skips a removed class exam and project items", () => {
        const removed = { ...classExam({ id: "gone", title: "Gone" }), deletedAt: 1 }
        const project = classExam({ id: "pe", scope: "p:x", title: "Team exam" })
        const items = mergeItems([], [project], { removed: [removed] })
        expect(studyTimeline(items as Item[], "2026-10-20", [], 14)).toEqual([])
    })
})
