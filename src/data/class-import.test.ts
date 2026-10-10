import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// An outline planned against a class and imported into it, with the store, the API, the
// school calendar and the class calls as fakes.
const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me" }, courses: [] as unknown[], items: [] as unknown[], spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], space_prefs: [] as unknown[], marks: [] },
    saveShared: vi.fn(async (..._: unknown[]) => ({})),
    create: vi.fn(),
    download: vi.fn(async (..._: unknown[]) => true),
    openClass: vi.fn(),
    cal: null as unknown,
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, saveShared: fake.saveShared }))
vi.mock("@/core/api", () => ({ api: { spaces: { create: fake.create } } }))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => "" }))
vi.mock("./classes", async (real) => ({ ...(await real<typeof import("./classes")>()), download: fake.download, openClass: fake.openClass }))

import { commitNewClass, commitToClass, importTargets, NotDownloaded, planForClass, setWeekOne } from "./class-import"
import type { Outline } from "@/core/importers/plan"
import { normalizeSchool } from "@/core/school"

const SID = "sp0000000007", SCOPE = "c:" + SID
const course = { scope: SCOPE, id: "web", code: "WEB", name: "Web Services", color: "#17B3AE", instructor: "", term: "", archived: false, target: null, updatedBy: null,
    meetings: [{ id: "m1", kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B" }] }
const shared = (over: Record<string, unknown>) => ({ scope: SCOPE, type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", start: "", end: "", where: "", weight: 10, status: "todo", notes: "", checklist: [], links: [], recur: null, weekday: null, updatedBy: null, assignees: [], completedBy: null, ...over })
const quiz = (over: Record<string, unknown> = {}) => ({ type: "quiz", title: "Quiz 1", date: "2026-10-01", start: "", end: "", weight: 10, ...over }) as Outline["assessments"][number]
const outline: Outline = {
    code: "CS 446", name: "Web Services",
    classes: [{ kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B" }, { kind: "Lab", weekday: 3, start: "13:00", end: "15:00", room: "Lab 2" }],
    assessments: [
        quiz(),
        quiz({ title: "Quiz  2!", date: "2026-10-22" }),
        { type: "exam", title: "Midterm", date: "2026-10-30", start: "", end: "", weight: 30 },
    ],
}
/* an outline of just these assessments (and office hours), no classes */
const only = (assessments: Outline["assessments"], more: Partial<Outline> = {}): Outline => ({ code: "CS 446", name: "Web Services", classes: [], assessments, ...more })
const saved = () => (fake.saveShared.mock.calls as unknown as [string, Record<string, unknown>][]).filter(([s]) => s === "shared_items").map(([, r]) => r)

beforeEach(() => {
    fake.data.shared_courses = []
    fake.data.shared_items = []
    fake.download.mockImplementation(async () => true)
    fake.cal = null
})
afterEach(() => vi.clearAllMocks())

describe("an outline planned against a class", () => {
    it("marks each row New, Changed (unticked, with what it was) or Already there, under the class's course", () => {
        const plan = planForClass(outline, course as never, [shared({ id: "q1" }), shared({ id: "q2", title: "Quiz 2", date: "2026-10-20" })] as never)
        expect(plan.courses.map((c) => [c.id, c.isNew, c.meetings.map((m) => [m.kind, m.include])])).toEqual([["web", false, [["Lecture", false], ["Lab", true]]]])
        expect(plan.items.map((i) => [i.row.title, i.row.courseId, i.include, i.duplicate ?? false, i.match ?? null, i.was ?? null])).toEqual([
            ["Quiz 1", "web", false, true, "q1", null],
            ["Quiz  2!", "web", false, false, "q2", "Tue 20 Oct"],
            ["Midterm", "web", true, false, null, null],
        ])
        expect(plan.outline).toBe(outline)
    })

    it("matches only the class's live items: a removed one, or another class's, is not there", () => {
        const plan = planForClass(outline, course as never, [shared({ id: "q1", deletedAt: 1 }), shared({ id: "x1", scope: "c:sp0000000009" })] as never)
        expect(plan.items[0]).toMatchObject({ include: true, duplicate: false })
        expect(plan.items[0].match).toBeUndefined()
    })

    it("matches one to one: rows with the same title take the item on their day first, then one left over", () => {
        const o = only([quiz({ title: "Weekly quiz", date: "2026-10-05" }), quiz({ title: "Weekly quiz", date: "2026-10-12" }), quiz({ title: "Weekly quiz", date: "2026-10-19" })])
        const plan = planForClass(o, course as never, [
            shared({ id: "w2", title: "Weekly quiz", date: "2026-10-12" }), shared({ id: "w9", title: "Weekly quiz", date: "2026-10-09" }), shared({ id: "w1", title: "Weekly quiz", date: "2026-10-05" }),
        ] as never)
        expect(plan.items.map((i) => [i.match, i.duplicate, i.was ?? null])).toEqual([["w1", true, null], ["w2", true, null], ["w9", false, "Fri 9 Oct"]])
    })

    it("matches titles in any script, and never on a title with no letters or digits", () => {
        const o = only([quiz({ title: "Κουίζ 1" }), quiz({ title: "测验" }), quiz({ title: "!!!" })])
        const plan = planForClass(o, course as never, [shared({ id: "zh", title: "测验" }), shared({ id: "qq", title: "???" })] as never)
        expect(plan.items.map((i) => [i.row.title, i.match ?? null])).toEqual([["Κουίζ 1", null], ["测验", "zh"], ["!!!", null]])
    })

    it("says what changed: the time, the weight; a time, room or weight the outline leaves out is no change", () => {
        const o = only([
            quiz({ title: "Timed", start: "09:00", end: "10:00" }),
            quiz({ title: "Weighed", weight: 15 }),
            quiz({ title: "Roomless", room: "" }),
            quiz({ title: "Untimed", start: "", end: "", weight: null }),
            quiz({ title: "Moved", date: "2026-10-02", room: "Hall C", weight: 20 }),
        ])
        const plan = planForClass(o, course as never, [
            shared({ id: "t", title: "Timed", start: "10:00", end: "11:00" }),
            shared({ id: "w", title: "Weighed" }),
            shared({ id: "r", title: "Roomless", where: "Hall B" }),
            shared({ id: "u", title: "Untimed", start: "10:00", end: "11:00", weight: 25 }),
            shared({ id: "m", title: "Moved", where: "Hall B" }),
        ] as never)
        expect(plan.items.map((i) => [i.match, i.duplicate, i.was ?? null])).toEqual([
            ["t", false, "10:00–11:00"],
            ["w", false, "10%"],
            ["r", true, null],
            ["u", true, null],
            ["m", false, "Thu 1 Oct · Hall B · 10%"],
        ])
    })

    it("compares recurring rows by weekday and start, not by their date", () => {
        const o = only([], { instructor: "Dr Lee", officeHours: [{ weekday: 2, start: "14:00", end: "15:00" }] })
        const office = (over: Record<string, unknown>) => shared({ type: "office", title: "Dr Lee — office hours", date: "2026-09-01", start: "14:00", end: "15:00", weight: null, recur: "weekly", weekday: 2, ...over })
        expect(planForClass(o, course as never, [office({ id: "o1" })] as never).items[0]).toMatchObject({ match: "o1", duplicate: true, include: false })
        expect(planForClass(o, course as never, [office({ id: "o1", weekday: 1, date: "2026-08-31" })] as never).items[0]).toMatchObject({ match: "o1", duplicate: false, was: "Mondays" })
    })

    it("week 1 dates the week-numbered rows, then matches them again: one the class has stays unticked", () => {
        const o = only([quiz({ title: "Quiz 1", date: undefined, week: 4 }), quiz({ title: "Quiz 3", date: undefined, week: 5 })])
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "q1", date: "2026-09-28" })]
        const plan = planForClass(o, course as never, fake.data.shared_items as never)
        expect(plan.items.map((i) => [i.include, i.match ?? null, i.was ?? null])).toEqual([[false, "q1", "Mon 28 Sep"], [false, null, null]])
        setWeekOne(plan, "2026-09-07", { kind: "class", spaceId: SID })
        expect(plan.items.map((i) => [i.row.date, i.include, i.match ?? null, i.duplicate, i.was ?? null])).toEqual([
            ["2026-09-28", false, "q1", true, null],
            ["2026-10-05", true, null, false, null],
        ])
    })

    it("lists the classes you can import into: not a member's, an archived one or a project", () => {
        const s = (id: string, role: string, archived = false, kind = "class") => ({ id, kind, role, archived })
        expect(importTargets([s("o", "owner"), s("e", "editor"), s("m", "member"), s("a", "owner", true), s("p", "owner", false, "project")] as never).map((x) => x.id)).toEqual(["o", "e"])
    })
})

describe("importing into a class", () => {
    it("adds ticked meetings to its course, new rows as its items, and changes matched ones", async () => {
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "q2", title: "Quiz 2", date: "2026-10-20" })]
        const plan = planForClass(outline, course as never, fake.data.shared_items as never)
        plan.items[1].include = true   /* Changed: ticked by hand */
        expect(await commitToClass(plan, SID)).toBe("Added 2 items, updated 1 item and added 1 class to Web Services.")
        const calls = fake.saveShared.mock.calls as unknown as [string, Record<string, unknown>][]
        expect(calls[0][0]).toBe("shared_courses")
        expect((calls[0][1].meetings as unknown[]).length).toBe(2)
        expect(saved().map((r) => [r.id === "q2" ? "q2" : "new", r.title, r.date, r.scope, r.courseId])).toEqual([
            ["new", "Quiz 1", "2026-10-01", SCOPE, "web"],
            ["q2", "Quiz 2", "2026-10-22", SCOPE, "web"],
            ["new", "Midterm", "2026-10-30", SCOPE, "web"],
        ])
    })

    it("a Changed row keeps the class's notes, status and assignees, and what the outline leaves out", async () => {
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "q1", date: "2026-09-30", start: "10:00", end: "11:00", where: "Hall B", weight: 5, notes: "bring a calculator", status: "done", assignees: ["u-a"] })]
        const plan = planForClass(only([quiz({ weight: null })]), course as never, fake.data.shared_items as never)
        expect(plan.items[0].was).toBe("Wed 30 Sep")
        plan.items[0].include = true
        expect(await commitToClass(plan, SID)).toBe("Updated 1 item in Web Services.")
        expect(saved()[0]).toMatchObject({ id: "q1", title: "Quiz 1", date: "2026-10-01", start: "10:00", end: "11:00", where: "Hall B", weight: 5, notes: "bring a calculator", status: "done", assignees: ["u-a"] })
    })

    it("a Changed one-off row keeps a recurring item's series", async () => {
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "q1", date: "2026-09-03", recur: "weekly", weekday: 4 })]
        const plan = planForClass(only([quiz({ weight: 20 })]), course as never, fake.data.shared_items as never)
        expect(plan.items[0].was).toBe("10%")
        plan.items[0].include = true
        await commitToClass(plan, SID)
        expect(saved()[0]).toMatchObject({ id: "q1", date: "2026-09-03", recur: "weekly", weekday: 4, weight: 20 })
    })

    it("a Changed weekly row moves a weekly item to its weekday", async () => {
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "o1", type: "office", title: "Dr Lee — office hours", date: "2026-08-31", start: "14:00", end: "15:00", weight: null, recur: "weekly", weekday: 1 })]
        const plan = planForClass(only([], { instructor: "Dr Lee", officeHours: [{ weekday: 2, start: "14:00", end: "15:00" }] }), course as never, fake.data.shared_items as never)
        plan.items[0].include = true
        expect(await commitToClass(plan, SID)).toBe("Updated 1 item in Web Services.")
        expect(saved()[0]).toMatchObject({ id: "o1", recur: "weekly", weekday: 2, date: plan.items[0].row.date })
        expect(new Date(plan.items[0].row.date + "T12:00").getDay()).toBe(2)
    })

    it("a Changed row whose item was removed after the preview is added as new", async () => {
        fake.data.shared_courses = [course]
        const plan = planForClass(outline, course as never, [shared({ id: "q2", title: "Quiz 2", date: "2026-10-20" })] as never)
        fake.data.shared_items = []
        for (const it of plan.items) it.include = it.match === "q2"
        expect(await commitToClass(plan, SID)).toBe("Added 1 item and added 1 class to Web Services.")
        expect(saved().map((r) => [r.id === "q2", r.title, r.date])).toEqual([[false, "Quiz  2!", "2026-10-22"]])
    })

    it("counts only the classes the course has room for", async () => {
        const full = { ...course, meetings: Array.from({ length: 11 }, (_, i) => ({ id: "k" + i, kind: "Lecture", weekday: 5, start: String(10 + i).padStart(2, "0") + ":00", end: "", room: "" })) }
        fake.data.shared_courses = [full]
        const plan = planForClass(only([], { classes: outline.classes }), full as never, [])
        expect(await commitToClass(plan, SID)).toBe("Added 1 class to Web Services.")
        expect(((fake.saveShared.mock.calls[0] as unknown as [string, { meetings: unknown[] }])[1]).meetings.length).toBe(12)
    })

    it("says so when nothing is ticked", async () => {
        fake.data.shared_courses = [course]
        const plan = planForClass(only([quiz()]), course as never, [shared({ id: "q1" })] as never)
        expect(await commitToClass(plan, SID)).toBe("Nothing new for Web Services.")
        expect(fake.saveShared).not.toHaveBeenCalled()
    })
})

describe("a new class from an outline", () => {
    it("makes the class on Import, waits for it, then writes its items under the server's course", async () => {
        const log: string[] = []
        fake.create.mockImplementation(async () => { log.push("create"); return { id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "owner", members: 1 } })
        fake.download.mockImplementation(async () => { log.push("download"); fake.data.shared_courses = [{ ...course, meetings: [] }]; return true })
        fake.saveShared.mockImplementation(async () => { log.push("write"); return {} })
        const plan = planForClass(outline, null, [])
        expect(await commitNewClass(plan)).toBe("Made Web Services with 3 items. Invite people from Members.")
        expect(fake.create).toHaveBeenCalledWith({ kind: "class", course: expect.objectContaining({ code: "CS 446", name: "Web Services", meetings: [expect.objectContaining({ kind: "Lecture" }), expect.objectContaining({ kind: "Lab" })] }) })
        expect(log).toEqual(["create", "download", "write", "write", "write"])
        expect(saved().map((r) => [r.scope, r.courseId])).toEqual([[SCOPE, "web"], [SCOPE, "web"], [SCOPE, "web"]])
        expect(fake.openClass).toHaveBeenCalledWith(SID, "members")
    })

    it("starts in the semester the outline names, and is made in the one picked in the preview", async () => {
        fake.cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-01-01", end: "2026-12-31" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })
        fake.create.mockResolvedValue({ id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "owner", members: 1 })
        fake.download.mockImplementation(async () => { fake.data.shared_courses = [course]; return true })
        const plan = planForClass({ ...outline, term: "Winter 2027" }, null, [])
        expect(plan.courses[0].term).toBe("Winter 2027")
        plan.courses[0].term = ""
        await commitNewClass(plan)
        expect(fake.create).toHaveBeenCalledWith({ kind: "class", course: expect.objectContaining({ term: "" }) })
    })

    it("writes nothing and opens nothing while the class hasn't downloaded", async () => {
        fake.create.mockResolvedValue({ id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "owner", members: 1 })
        fake.download.mockImplementation(async () => false)
        const error = await commitNewClass(planForClass(outline, null, [])).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(NotDownloaded)
        expect(error).toMatchObject({ spaceId: SID, message: "Web Services is made, but hasn't downloaded yet. Import again in a moment to add the items to it." })
        expect(fake.saveShared).not.toHaveBeenCalled()
        expect(fake.openClass).not.toHaveBeenCalled()
    })
})
