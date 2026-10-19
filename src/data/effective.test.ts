import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({ data: { profile: null, items: [], courses: [], shared_items: [], shared_courses: [], marks: [], space_prefs: [], spaces: [] }, subscribe: () => () => {} }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { data } from "@/core/store"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { courseByKey, courseKeyOf, effectiveCourses, effectiveItems, itemByKey, keyOf, mergeCourses, mergeItems, onCalendar } from "./effective"
import { keyedAchievements, keyedCourses, keyedItems, keyedSessions } from "./refs"
import { instances, tableRows, typeCounts, weekDays } from "./views"
import type { Achievement, Course, Item, Mark, SpacePref, StudySession } from "./types"

const WEB = "c:abcdefghij12"
const item = (row: Partial<Item> & { id: string }) => normalizeItem({ type: "assignment", title: row.id, date: "2026-09-23", status: "todo", ...row }) as Item
const course = (row: Partial<Course> & { id: string }) => normalizeCourse({ code: row.id.toUpperCase(), name: row.id, ...row }) as Course
const ALL = { search: "", course: "all" }

describe("the effective lists", () => {
    it("are today's arrays themselves while there is no shared row", () => {
        const store = data as unknown as Record<string, unknown[]>
        store.items = [item({ id: "a" })]
        store.courses = [course({ id: "bio" })]
        store.shared_items = []
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
    })

    it("keeps project rows out of the views until Stage 9 (PROJECTS_IN_VIEWS)", () => {
        const task = { ...item({ id: "t1", type: "task" }), scope: "p:fire00000001" }
        expect(mergeItems([], [task], true)).toEqual([])
        const own = [item({ id: "a" })]
        expect(mergeItems(own, [task], true, { removed: [{ ...task, deletedAt: 5 }], marks: new Map([["fire00000001:t1", { notes: "mine" } as Mark]]) })).toEqual(own)
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

describe("your layer over a class", () => {
    const SID = "abcdefghij12"
    const mark = (id: string, over: Partial<Mark> = {}): Mark => ({ id: SID + ":" + id, spaceId: SID, itemId: id, status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: false, ...over })
    const store = data as unknown as Record<string, unknown>

    it("puts your status, grade, weight, checklist and notes on a class item, and leaves out what you hid", () => {
        const shared = [{ ...item({ id: "a1", weight: 20, notes: "Teams of 3", courseId: "web" }), scope: WEB }, { ...item({ id: "h1", courseId: "web" }), scope: WEB }]
        const marks = new Map([[SID + ":a1", mark("a1", { status: "graded", grade: 87, notes: "mine", weight: 25 })], [SID + ":h1", mark("h1", { hidden: true })]])
        const out = mergeItems([], shared, true, { marks })
        expect(out.map(keyOf)).toEqual([WEB + "/a1"])
        expect(out[0]).toMatchObject({ status: "graded", grade: 87, weight: 25, notes: "mine", classWeight: 20, classNotes: "Teams of 3", spaceId: SID, courseKey: WEB + "/web" })
        expect(mergeItems([], [shared[0]], true)[0]).toMatchObject({ status: "todo", grade: null, weight: 20, notes: "", checklist: [] })
    })

    it("shows your items filed under a class at the class course's key, and keeps today's arrays when nothing is", () => {
        const own = [item({ id: "x" }), item({ id: "y", classId: SID })]
        const out = mergeItems(own, [], true, { classCourse: new Map([[SID, WEB + "/web"]]) })
        expect(out.map(courseKeyOf)).toEqual([null, WEB + "/web"])
        expect(out[0]).toBe(own[0])
        const plain = [item({ id: "x" })]
        expect(mergeItems(plain, [], true)).toBe(plain)
    })

    it("gives a class course your colour, target, semester and archive flag", () => {
        const pref: SpacePref = { id: SID, spaceId: SID, color: "#B8457E", target: 75, term: "Spring 2027", archived: true }
        const [c] = mergeCourses([], [{ ...course({ id: "web", color: "#17B3AE", term: "Fall 2026" }), scope: WEB }], true, { prefs: new Map([[SID, pref]]) })
        expect(c).toMatchObject({ key: WEB + "/web", spaceId: SID, color: "#B8457E", target: 75, term: "Spring 2027", archived: true })
    })

    it("shows shared rows to everyone, admin or not", () => {
        store.items = [item({ id: "a" })]
        store.courses = [course({ id: "bio" })]
        store.shared_items = [{ ...item({ id: "a1", courseId: "web" }), scope: WEB }]
        store.shared_courses = [{ ...course({ id: "web" }), scope: WEB }]
        for (const profile of [{ id: "u1", isAdmin: false }, { id: "u1" }, { id: "u1", isAdmin: true }]) {
            store.profile = profile
            expect(effectiveItems().map(keyOf)).toEqual(["a", WEB + "/a1"])
            expect(courseByKey(WEB + "/web")?.name).toBe("web")
            expect(itemByKey(WEB + "/a1")?.id).toBe("a1")
            expect(itemByKey("a")).toBe(data.items[0])
        }
        store.profile = null
    })

    it("gives anyone without a class the store's own arrays and rows, and every keyed list back as it was", () => {
        const own = [item({ id: "a", courseId: "bio" }), item({ id: "b" })]
        store.items = own
        store.courses = [course({ id: "bio" })]
        store.shared_items = []
        store.shared_courses = []
        store.marks = [mark("a1", { status: "graded", grade: 90 })]
        store.space_prefs = [{ id: SID, spaceId: SID, color: "#B8457E", target: 75, term: "Spring 2027", archived: false }]
        const sessions = [{ id: "s", courseId: "bio", itemId: "a", startedAt: 1, studyMinutes: 30, roundsDone: 0, note: "", manual: false }] as StudySession[]
        const achievements = [{ id: "x", courseId: "bio" }] as Achievement[]
        for (const profile of [null, { id: "u1" }, { id: "u1", isAdmin: false }]) {
            store.profile = profile
            const items = effectiveItems(), courses = effectiveCourses()
            expect(items).toBe(data.items)
            expect(courses).toBe(data.courses)
            items.forEach((it, i) => expect(it).toBe(own[i]))
            expect(keyedItems(items)).toBe(items)
            expect(keyedCourses(courses)).toBe(courses)
            expect(keyedSessions(sessions)).toBe(sessions)
            expect(keyedAchievements(achievements)).toBe(achievements)
            expect(itemByKey("a")).toBe(own[0])
            expect(itemByKey(WEB + "/a1")).toBeNull()
            expect(courseByKey(WEB + "/web")).toBeNull()
        }
        store.profile = null
        store.marks = []
        store.space_prefs = []
    })

    it("leaves hidden sources off the calendar, and returns the lists themselves with none hidden", () => {
        const items = mergeItems([item({ id: "p" }), item({ id: "b", courseId: "bio" }), item({ id: "f", classId: SID })], [{ ...item({ id: "a1", courseId: "web" }), scope: WEB }], true)
        const courses = mergeCourses([course({ id: "bio" })], [{ ...course({ id: "web" }), scope: WEB }], true)
        expect(onCalendar(items, courses, [])).toEqual({ items, courses })
        expect(onCalendar(items, courses, []).items).toBe(items)
        const shown = onCalendar(items, courses, ["space:" + SID, "personal"])
        expect(shown.items.map((it) => it.id)).toEqual(["b"])
        expect(shown.courses.map(keyOf)).toEqual(["bio"])
        expect(onCalendar(items, courses, ["course:bio"]).items.map((it) => it.id)).toEqual(["p", "f", "a1"])
    })
})
