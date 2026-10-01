import { afterEach, describe, expect, it, vi } from "vitest"

/* A store that records what is saved; the busy screen and the redraw are fakes. */
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as { id: string; meetings: unknown[] }[], profile: { id: "p", termStart: null as string | null } as { id: string; termStart: string | null } | null },
    rows: [] as { kind: string; row: { id: string } }[],
    profile: [] as unknown[],
    cal: null as unknown,
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    course: (id: string) => fake.data.courses.find((c) => c.id === id) || null,
    saveRows: vi.fn(async (rows: typeof fake.rows) => { fake.rows.push(...rows) }),
    saveProfile: vi.fn(async (patch: unknown) => { fake.profile.push(patch) }),
    subscribe: () => () => {},
}))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => fake.data.profile?.termStart ?? null }))
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn() }))
vi.mock("@/core/api", () => ({ api: {} }))

import { normalizeCourse } from "@/core/model"
import { feedLink, hm, savedValues, syncLine, TAB_OF, themeLabel, toggleRest } from "./settings"
import { commitImport, defaultTerm, importCount, type ImportPlan } from "./import-edit"
import { normalizeSchool } from "@/core/school"
import { dayOk, footHint, groupDays, moveFrom, saveSchool, toSave, valid, type SchoolDraft } from "./school-edit"

afterEach(() => { fake.rows = []; fake.profile = []; fake.cal = null; fake.data.profile = { id: "p", termStart: null } })

describe("what Settings says", () => {
    it("puts the sync status in a sentence", () => {
        expect(syncLine({ state: "offline", pending: 2, message: "" })).toBe("Offline — 2 changes waiting to sync.")
        expect(syncLine({ state: "offline", pending: 0, message: "" })).toBe("Offline — everything is saved on this device.")
        expect(syncLine({ state: "error", pending: 0, message: "server down" })).toBe("Sync problem: server down.")
        expect(syncLine({ state: "syncing", pending: 1, message: "" })).toBe("Syncing…")
        expect(syncLine({ state: "idle", pending: 0, message: "", lastPull: 1_000_000 }, 1_000_000 + 5 * 60_000)).toBe("Synced 5 min ago.")
        expect(syncLine({ state: "idle", pending: 0, message: "" })).toBe("Synced.")
    })

    it("says what the theme follows", () => {
        expect(themeLabel("system", true)).toBe("following your device — currently dark")
        expect(themeLabel("light", true)).toBe("always light")
        expect(themeLabel("dark", false)).toBe("always dark")
    })

    it("opens a deep link on its tab", () => {
        expect(TAB_OF.qText).toBe("you")
        expect(TAB_OF.importGrp).toBe("study")
        expect(TAB_OF.spotifyGrp).toBe("spotify")
    })

    it("writes minutes, rest days and the feed link", () => {
        expect(hm(90)).toBe("1h 30m")
        expect(hm(120)).toBe("2h")
        expect(hm(45)).toBe("45m")
        expect(toggleRest([0], 6)).toEqual([0, 6])
        expect(toggleRest([0, 6], 0)).toEqual([6])
        expect(toggleRest([1, 2, 3, 4, 5, 6], 0)).toEqual([1, 2, 3, 4, 5, 6])
        expect(feedLink("https://x.org/cal/abc.ics", "America/Toronto")).toBe("https://x.org/cal/abc.ics?tz=America%2FToronto")
        expect(feedLink("https://x.org/cal/abc.ics", "")).toBe("https://x.org/cal/abc.ics")
    })

    it("lists a saved copy's values", () => {
        expect(savedValues({ title: "Quiz", date: "2026-09-23", notes: "", checklist: [{ text: "ch. 4", done: true }], meetings: [{ kind: "Lab", start: "09:00", end: "10:00", room: "B" }] }))
            .toEqual([["Title", "Quiz"], ["Date", "2026-09-23"], ["Checklist", "Done: ch. 4"], ["Class", "Lab 09:00-10:00 B"]])
    })
})

describe("importing", () => {
    const mtg = (id: string, include: boolean) => ({ id, kind: "Lecture", weekday: 1, start: "09:00", end: "10:00", room: "Hall B", include })
    const plan = (): ImportPlan => ({
        notes: [],
        courses: [
            { id: "new1", code: "PHYS", name: "Physiology", color: "#4F74D9", isNew: true, keep: true, meetings: [mtg("a", true), mtg("b", false)] },
            { id: "old", code: "ANAT", name: "Anatomy", color: "#E4749B", isNew: false, keep: false, meetings: [mtg("c", true)] },
        ],
        items: [
            { include: true, row: { id: "i1", type: "exam", title: "Midterm", courseId: "new1", date: "2026-10-05", start: "09:30", where: "" } as never },
            { include: false, row: { id: "i2", type: "quiz", title: "Quiz", courseId: "old", date: "2026-10-06" } as never },
            { include: true, row: { id: "i3", type: "assignment", title: "Undated", courseId: null, date: "" } as never },
        ],
    })

    it("counts the ticked classes and items and the new courses kept", () => {
        expect(importCount(plan())).toBe(5)   /* a, c, the new course, i1, i3 */
    })

    it("writes courses before items, adds classes to a course already there, and fills rooms", async () => {
        fake.data.courses = [normalizeCourse({ id: "old", code: "ANAT", name: "Anatomy", meetings: [] }, 0) as { id: string; meetings: unknown[] }]
        const line = await commitImport(plan())
        expect(line).toBe("Imported 2 classes and 1 item.")
        expect(fake.rows.map((r) => r.kind + ":" + r.row.id)).toEqual(["courses:new1", "courses:old", "items:i1"])
        expect((fake.rows[1].row as unknown as { meetings: unknown[] }).meetings).toHaveLength(1)
        expect((fake.rows[2].row as unknown as { where: string }).where).toBe("Hall B")
    })

    it("sets the term start only when none is set and there is no school calendar", async () => {
        await commitImport({ ...plan(), week1: "2026-09-07" })
        expect(fake.profile).toEqual([{ termStart: "2026-09-07" }])
        fake.profile = []
        fake.cal = { terms: [] }
        await commitImport({ ...plan(), week1: "2026-09-07" })
        expect(fake.profile).toEqual([])
    })

    it("saves a semester picked for a course that exists, even with no new classes", async () => {
        fake.data.courses = [normalizeCourse({ id: "old", code: "ANAT", name: "Anatomy", term: "", meetings: [] }, 0) as { id: string; meetings: unknown[] }]
        const p: ImportPlan = { notes: [], items: [], courses: [{ id: "old", code: "ANAT", name: "Anatomy", color: "#E4749B", isNew: false, meetings: [], term: "Fall 2026" }] }
        expect(await commitImport(p)).toBe("Imported 0 classes and 0 items.")
        expect(fake.rows.map((r) => [r.row.id, (r.row as unknown as { term: string }).term])).toEqual([["old", "Fall 2026"]])
        fake.rows = []
        p.courses[0].term = undefined
        await commitImport(p)
        expect(fake.rows).toEqual([])
    })

    it("gives a new course the semester its file names, else the current one", () => {
        const cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })
        expect(defaultTerm(cal, "fall 2026", "2027-02-01")).toBe("Fall 2026")
        expect(defaultTerm(cal, "", "2027-02-01")).toBe("Winter 2027")
        expect(defaultTerm(cal, "Autumn", "2026-10-01")).toBe("Fall 2026")
        expect(defaultTerm(null, "2026 Autumn", "2027-02-01")).toBe("2026 Autumn")
    })
})

describe("the school calendar", () => {
    const draft = (over: Partial<SchoolDraft> = {}): SchoolDraft => ({
        source: null, truncated: false, name: " Uni 2026–27 ",
        terms: [{ name: "Winter", start: "2027-01-06", end: "2027-04-10" }, { name: "Autumn", start: "2026-09-02", end: "2026-12-04" }],
        days: [{ from: "2027-02-16", to: "2027-02-20", kind: "break", label: "Reading week" }, { from: "2026-10-12", to: "2026-10-12", kind: "off", label: "Thanksgiving" }],
        ...over,
    })

    it("is valid when every semester has a name and dates in order, and every day ends on or after it starts", () => {
        expect(valid(draft())).toBe(true)
        expect(valid(draft({ terms: [] }))).toBe(false)
        expect(valid(draft({ terms: [{ name: "X", start: "2026-12-01", end: "2026-09-01" }] }))).toBe(false)
        expect(dayOk({ from: "2026-10-12", to: "2026-10-11", kind: "off", label: "" })).toBe(false)
        expect(footHint(draft())).toBe("2 semesters, 2 days")
        expect(footHint(draft({ terms: [] }))).toBe("Fix the dates marked in red")
    })

    it("saves trimmed and in date order, a swap with the day it follows", () => {
        const s = toSave(draft({ days: [{ from: "2026-11-11", to: "2026-11-11", kind: "swap", label: " Monday schedule ", follows: 1 }] }))
        expect(s.name).toBe("Uni 2026–27")
        expect(s.terms.map((t) => t.name)).toEqual(["Autumn", "Winter"])
        expect(s.days).toEqual([{ from: "2026-11-11", to: "2026-11-11", kind: "swap", label: "Monday schedule", follows: 1 }])
    })

    it("carries the last date along when the first moves", () => {
        const one = { from: "2026-10-12", to: "2026-10-12", kind: "off" as const, label: "" }
        expect(moveFrom(one, "2026-10-14").to).toBe("2026-10-14")
        expect(moveFrom({ ...one, to: "2026-10-20" }, "2026-10-14").to).toBe("2026-10-20")
        expect(moveFrom({ ...one, to: "2026-10-13" }, "2026-10-15").to).toBe("2026-10-15")
    })

    it("moves a renamed semester's courses to its new name", async () => {
        fake.cal = normalizeSchool(toSave(draft()))
        fake.data.courses = [
            normalizeCourse({ id: "a", code: "A", name: "A", term: "autumn" }, 0),
            normalizeCourse({ id: "w", code: "W", name: "W", term: "Winter" }, 1),
            normalizeCourse({ id: "y", code: "Y", name: "Y", term: "" }, 2),
        ] as typeof fake.data.courses
        await saveSchool(draft({ terms: [{ name: "Winter", start: "2027-01-06", end: "2027-04-10" }, { name: "Fall", start: "2026-09-02", end: "2026-12-04" }] }))
        expect(fake.profile).toHaveLength(1)
        expect(fake.rows.map((r) => [r.row.id, (r.row as { term?: string }).term])).toEqual([["a", "Fall"]])
        fake.rows = []
        await saveSchool(draft())
        expect(fake.rows).toEqual([])
        fake.data.courses = []
    })

    it("groups the days under the semester they fall in", () => {
        const g = groupDays(draft())
        expect(g.map((x) => [x.term?.name, x.days.map(([d, i]) => d.label + i)])).toEqual([["Autumn", ["Thanksgiving1"]], ["Winter", ["Reading week0"]]])
    })
})
