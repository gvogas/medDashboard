import { afterEach, describe, expect, it, vi } from "vitest"

// An outline planned against a class and imported into it, with the store, the API, the
// school calendar and the class calls as fakes.
const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me" }, courses: [] as unknown[], items: [] as unknown[], spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], space_prefs: [] as unknown[], marks: [] },
    saveShared: vi.fn(async () => ({})),
    create: vi.fn(),
    download: vi.fn(async () => true),
    openClass: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, saveShared: fake.saveShared }))
vi.mock("@/core/api", () => ({ api: { spaces: { create: fake.create } } }))
vi.mock("@/data/query", () => ({ schoolCal: () => null, termStart: () => "" }))
vi.mock("./classes", async (real) => ({ ...(await real<typeof import("./classes")>()), download: fake.download, openClass: fake.openClass }))

import { commitNewClass, commitToClass, importTargets, planForClass } from "./class-import"
import type { Outline } from "@/core/importers/plan"

const SID = "sp0000000007", SCOPE = "c:" + SID
const course = { scope: SCOPE, id: "web", code: "WEB", name: "Web Services", color: "#17B3AE", instructor: "", term: "", archived: false, target: null, updatedBy: null,
    meetings: [{ id: "m1", kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B" }] }
const shared = (over: Record<string, unknown>) => ({ scope: SCOPE, type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", start: "", end: "", where: "", weight: 10, status: "todo", notes: "", checklist: [], links: [], updatedBy: null, assignees: [], completedBy: null, ...over })
const outline: Outline = {
    code: "CS 446", name: "Web Services",
    classes: [{ kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B" }, { kind: "Lab", weekday: 3, start: "13:00", end: "15:00", room: "Lab 2" }],
    assessments: [
        { type: "quiz", title: "Quiz 1", date: "2026-10-01", start: "", end: "", weight: 10 },
        { type: "quiz", title: "Quiz  2!", date: "2026-10-22", start: "", end: "", weight: 10 },
        { type: "exam", title: "Midterm", date: "2026-10-30", start: "", end: "", weight: 30 },
    ],
}
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

    it("lists the classes you can import into", () => {
        const s = (role: string, archived = false) => ({ id: role, kind: "class", role, archived })
        expect(importTargets([s("owner"), s("editor"), s("member"), s("owner", true)] as never).map((x) => x.id)).toEqual(["owner", "editor"])
    })
})

describe("importing into a class", () => {
    it("adds ticked meetings to its course, new rows as its items, and changes matched ones", async () => {
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "q2", title: "Quiz 2", date: "2026-10-20" })]
        const plan = planForClass(outline, course as never, fake.data.shared_items as never)
        plan.items[1].include = true   /* Changed: ticked by hand */
        expect(await commitToClass(plan, SID)).toBe("Added 2 items, updated 1, and added 1 class to Web Services.")
        const calls = fake.saveShared.mock.calls as unknown as [string, Record<string, unknown>][]
        expect(calls[0][0]).toBe("shared_courses")
        expect((calls[0][1].meetings as unknown[]).length).toBe(2)
        const items = calls.filter(([s]) => s === "shared_items").map(([, r]) => [r.id === "q2" ? "q2" : "new", r.title, r.date, r.scope, r.courseId])
        expect(items).toEqual([
            ["new", "Quiz 1", "2026-10-01", SCOPE, "web"],
            ["q2", "Quiz 2", "2026-10-22", SCOPE, "web"],
            ["new", "Midterm", "2026-10-30", SCOPE, "web"],
        ])
    })

    it("makes a new class from the outline on Import, then writes its items", async () => {
        fake.create.mockResolvedValue({ id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "owner", members: 1 })
        fake.download.mockImplementation(async () => { fake.data.shared_courses = [{ ...course, meetings: [] }]; return true })
        const plan = planForClass(outline, null, [])
        expect(await commitNewClass(plan)).toBe("Made Web Services with 3 items. Invite people from Members.")
        expect(fake.create).toHaveBeenCalledWith({ kind: "class", course: expect.objectContaining({ code: "CS 446", name: "Web Services", meetings: [expect.objectContaining({ kind: "Lecture" }), expect.objectContaining({ kind: "Lab" })] }) })
        expect(fake.openClass).toHaveBeenCalledWith(SID, "members")
    })
})
