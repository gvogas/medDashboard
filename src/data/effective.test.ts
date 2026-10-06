import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({ data: { items: [], courses: [], shared_items: [], shared_courses: [] }, subscribe: () => () => {} }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { data } from "@/core/store"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { courseKeyOf, effectiveCourses, effectiveItems, keyOf, mergeCourses, mergeItems } from "./effective"
import { instances, tableRows, typeCounts, weekDays } from "./views"
import type { Course, Item } from "./types"

const WEB = "c:abcdefghij12"
const item = (row: Partial<Item> & { id: string }) => normalizeItem({ type: "assignment", title: row.id, date: "2026-09-23", status: "todo", ...row }) as Item
const course = (row: Partial<Course> & { id: string }) => normalizeCourse({ code: row.id.toUpperCase(), name: row.id, ...row }) as Course
const ALL = { search: "", course: "all" }

describe("the effective lists", () => {
    it("are today's arrays themselves while no shared row is shown", () => {
        const store = data as unknown as Record<string, unknown[]>
        store.items = [item({ id: "a" })]
        store.courses = [course({ id: "bio" })]
        store.shared_items = [{ ...item({ id: "a" }), scope: WEB }]
        expect(effectiveItems()).toBe(data.items)
        expect(effectiveCourses()).toBe(data.courses)
        expect(effectiveItems()).toBe(effectiveItems())
    })

    it("leave shared rows out until they are shown, and key them by scope when they are", () => {
        const own = [item({ id: "a" })], shared = [{ ...item({ id: "a" }), scope: WEB }]
        expect(mergeItems(own, shared, false)).toBe(own)
        const both = mergeItems(own, shared, true)
        expect(both.map(keyOf)).toEqual(["a", WEB + "/a"])
        expect(both.map((it) => it.source ?? "personal")).toEqual(["personal", "class"])
        expect(mergeItems(own, [{ ...item({ id: "t", type: "task" }), scope: "p:abcdefghij12" }], true)[1].source).toBe("project")
    })

    it("keep a class course and a personal course with the same id apart in every view", () => {
        const courses = mergeCourses([course({ id: "bio", name: "Biology" })], [{ ...course({ id: "bio", name: "Biology (class)" }), scope: WEB }], true)
        const items = mergeItems([item({ id: "mine", courseId: "bio" })], [{ ...item({ id: "theirs", courseId: "bio" }), scope: WEB }], true)
        expect(courses.map(keyOf)).toEqual(["bio", WEB + "/bio"])
        expect(items.map(courseKeyOf)).toEqual(["bio", WEB + "/bio"])
        const ids = (picked: string) => instances(items, courses, { ...ALL, course: picked }, "2026-09-21", "2026-09-27").map((x) => x.item.id)
        expect(ids("bio")).toEqual(["mine"])
        expect(ids(WEB + "/bio")).toEqual(["theirs"])
        expect(instances(items, courses, { ...ALL, search: "(class)" }, "2026-09-21", "2026-09-27").map((x) => x.item.id)).toEqual(["theirs"])
        expect(tableRows(items, courses, { ...ALL, types: {}, show: "all" }, { key: "course", dir: -1 }).map((it) => it.id)).toEqual(["theirs", "mine"])
        expect(typeCounts(items, WEB + "/bio")).toEqual({ assignment: 1 })
        const day = weekDays({ items, courses, filters: ALL, schedule: "deadlines", anchor: "2026-09-23", today: "2026-09-23", cal: null }).days[2]
        expect(day.entries.map((e) => e.key)).toEqual(["imine", "i" + WEB + "/theirs"])
    })
})
