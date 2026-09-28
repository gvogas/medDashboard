import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

/* The selectors are pure; the actions change a fake legacy ui. */
const fake = vi.hoisted(() => ({
    ui: { hist: { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null as string | null, undo: null as unknown } },
}))
vi.mock("@/legacy/js/store.js", () => ({ data: { items: [], courses: [], quotes: [], study_sessions: [], achievements: [], profile: null }, subscribe: () => () => {} }))
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))
vi.mock("@/legacy/js/query.js", () => ({ termStart: () => null, schoolCal: () => null }))

import { normalizeItem, normalizePrefs } from "@/legacy/js/model.js"
import { badges, monthOf, pickDay, rangeLabel, setHistTab, shownSessions, stepHist, studyTiles, termOf, undoSessionDelete, weekOf } from "./study"
import type { Achievement, Item, StudyPrefs, StudySession } from "./types"

/* Wednesday 23 September 2026; the week runs Mon 21 – Sun 27. */
const TODAY = "2026-09-23"
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { Object.assign(fake.ui.hist, { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null, undo: null }) })

/** A session at a local hour on a day, so the tests hold in any time zone. */
let n = 0
const at = (day: string, minutes: number, courseId: string | null = "anat", hour = 12): StudySession => {
    const [y, m, d] = day.split("-").map(Number)
    return { id: "s" + ++n, courseId, itemId: null, startedAt: new Date(y, m - 1, d, hour).getTime(), studyMinutes: minutes, roundsDone: 0, note: "", manual: false }
}
const prefs = (raw: Record<string, unknown> = {}) => normalizePrefs(raw) as StudyPrefs

describe("the tiles", () => {
    it("say nothing much with no sessions, no goal and no term start", () => {
        const t = studyTiles([], prefs(), null, TODAY)
        expect(t.streak).toEqual({ days: 0, sub: "Longest 0 · a day counts from 15 min" })
        expect(t.today).toEqual({ minutes: 0, goal: 0, sub: "" })
        expect(t.term).toEqual({ label: "Last 12 weeks", minutes: 0, sub: "0 sessions" })
    })

    it("count the streak, and ask for today while it does not count yet", () => {
        const list = [at("2026-09-21", 30), at("2026-09-22", 20)]
        expect(studyTiles(list, prefs(), null, TODAY).streak).toEqual({ days: 2, sub: "Longest 2 · a day counts from 15 min · study today to keep it" })
        expect(studyTiles([...list, at(TODAY, 16)], prefs(), null, TODAY).streak).toEqual({ days: 3, sub: "Longest 3 · a day counts from 15 min" })
        /* under the day's minimum, today does not count yet; a short day breaks the run */
        expect(studyTiles([...list, at(TODAY, 10)], prefs({ dayMin: 20 }), null, TODAY).streak.sub).toBe("Longest 2 · a day counts from 20 min · study today to keep it")
        expect(studyTiles([...list, at(TODAY, 10)], prefs({ dayMin: 25 }), null, TODAY).streak).toEqual({ days: 0, sub: "Longest 1 · a day counts from 25 min" })
    })

    it("show what is left of the goal, then that it is reached", () => {
        expect(studyTiles([at(TODAY, 65)], prefs({ goal: 120 }), null, TODAY).today).toEqual({ minutes: 65, goal: 120, sub: "55 min to your daily goal" })
        expect(studyTiles([at(TODAY, 65), at(TODAY, 60)], prefs({ goal: 120 }), null, TODAY).today.sub).toBe("Daily goal reached")
    })

    it("count the term from its start, or the last 12 weeks", () => {
        const list = [at("2026-08-31", 40), at("2026-09-02", 50), at("2026-09-22", 30), at("2026-06-01", 99)]
        expect(studyTiles(list, prefs(), "2026-09-01", TODAY).term).toEqual({ label: "This term", minutes: 120, sub: "3 sessions since 1 Sep" })
        /* the term counts from its first Monday; twelve weeks back from this Monday is 29 June */
        expect(studyTiles(list, prefs(), null, TODAY).term).toEqual({ label: "Last 12 weeks", minutes: 120, sub: "3 sessions" })
        expect(studyTiles([at(TODAY, 5)], prefs(), "2026-09-01", TODAY).term.sub).toBe("1 session since 1 Sep")
    })
})

describe("the week", () => {
    const list = [
        at("2026-09-21", 45, "anat", 9), at("2026-09-21", 30, "phys", 15), at(TODAY, 60, null, 8),
        at("2026-09-15", 80), at("2026-09-28", 10),
    ]

    it("totals the week against the one before, newest first", () => {
        const w = weekOf(list, 0, TODAY)
        expect(w.range).toBe("21 – 27 Sep")
        expect(w.total).toBe(135)
        expect(w.summary).toBe("in 3 sessions · 55m more than the week before")
        expect(w.sessions.map((s) => s.studyMinutes)).toEqual([60, 30, 45])
        expect(w.perCourse).toEqual([["", 60], ["anat", 45], ["phys", 30]])
        expect(weekOf(list, -1, TODAY).summary).toBe("in 1 session")
        expect(weekOf([at("2026-09-14", 30), at("2026-09-21", 30)], 0, TODAY).summary).toBe("in 1 session · same as the week before")
        expect(weekOf([at("2026-09-14", 90), at("2026-09-21", 30)], 0, TODAY).summary).toBe("in 1 session · 1h 00m less than the week before")
    })

    it("draws a bar a day by course, future days marked, and the goal line", () => {
        const w = weekOf(list, 0, TODAY, 120)
        expect(w.days.map((d) => d.label)).toEqual(["Mon 21", "Tue 22", "Wed 23", "Thu 24", "Fri 25", "Sat 26", "Sun 27"])
        expect(w.days.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY])
        expect(w.days.filter((d) => d.future).map((d) => d.date)).toEqual(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"])
        /* the chart is 150 minutes tall: a quarter over the goal */
        expect(w.goalLine).toBe(80)
        expect(w.days[0].bars).toEqual([{ courseId: "anat", minutes: 45, height: 30 }, { courseId: "phys", minutes: 30, height: 20 }])
        expect(w.days[0].title).toBe("Mon 21 Sep · 1h 15m")
        /* no goal: at least an hour tall, else the biggest day */
        expect(weekOf(list, 0, TODAY).goalLine).toBeNull()
        expect(weekOf(list, 0, TODAY).days[2].bars[0].height).toBe(80)
        expect(weekOf([at(TODAY, 30)], 0, TODAY).days[2].bars[0].height).toBe(50)
    })

    it("steps back across a month and the clocks going back", () => {
        expect(weekOf(list, 1, "2026-09-30").range).toBe("5 – 11 Oct")
        const w = weekOf([at("2026-10-25", 30, "anat", 23)], -1, "2026-10-28")
        expect(w.range).toBe("19 – 25 Oct")
        expect(w.days.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"])
        expect(w.days[6].total).toBe(30)
        expect(weekOf([], 0, "2026-10-01").range).toBe("28 Sep – 4 Oct")
    })

    it("is empty with no study", () => {
        const w = weekOf([], 0, TODAY)
        expect(w.total).toBe(0)
        expect(w.summary).toBe("in 0 sessions")
        expect(w.sessions).toEqual([])
        expect(w.perCourse).toEqual([])
    })
})

describe("the month", () => {
    const list = [at("2026-09-02", 30), at("2026-09-02", 45, "phys"), at("2026-09-14", 130), at(TODAY, 20), at("2026-08-30", 10)]

    it("has the stats, days so far, and a cell a day Monday first", () => {
        const m = monthOf(list, 0, null, TODAY, 120)
        expect(m.title).toBe("September 2026")
        expect(m.lead).toBe(1)   /* 1 September 2026 is a Tuesday */
        expect(m.cells).toHaveLength(30)
        expect(m.stats).toEqual({ total: 225, count: 4, daysStudied: 3, daysSoFar: 23, average: 10 })
        const two = m.cells[1]
        expect(two).toMatchObject({ date: "2026-09-02", minutes: 75, split: [["anat", 30], ["phys", 45]].reverse(), level: 2, met: false, label: "Wed 2 Sep, 1h 15m" })
        expect(m.cells[13]).toMatchObject({ minutes: 130, met: true, level: 3 })
        expect(m.cells[23]).toMatchObject({ future: true, label: "Thu 24 Sep, no study" })
        expect(m.cells.filter((c) => c.isToday).map((c) => c.date)).toEqual([TODAY])
    })

    it("picks the chosen day, else today, else the month's latest day studied", () => {
        expect(monthOf(list, 0, "2026-09-14", TODAY).picked).toMatchObject({ date: "2026-09-14", isToday: false, label: "Mon 14 Sep", total: 130 })
        expect(monthOf(list, 0, null, TODAY).picked).toMatchObject({ date: TODAY, isToday: true, total: 20 })
        /* a day chosen in another month does not count */
        expect(monthOf(list, 0, "2026-08-30", TODAY).picked?.date).toBe(TODAY)
        const aug = monthOf(list, -1, null, TODAY)
        expect(aug.title).toBe("August 2026")
        expect(aug.picked).toMatchObject({ date: "2026-08-30", total: 10 })
        expect(aug.picked?.sessions).toHaveLength(1)
        expect(aug.stats.daysSoFar).toBe(31)
        expect(aug.cells.filter((c) => c.picked).map((c) => c.date)).toEqual(["2026-08-30"])
        /* a month with no study picks nothing */
        expect(monthOf(list, -2, null, TODAY).picked).toBeNull()
        expect(monthOf(list, -2, null, TODAY).stats).toEqual({ total: 0, count: 0, daysStudied: 0, daysSoFar: 31, average: 0 })
    })

    it("steps back across the year and the clocks changing", () => {
        const jan = monthOf([], -1, null, "2027-02-10")
        expect(jan.title).toBe("January 2027")
        expect(jan.lead).toBe(4)   /* a Friday */
        const dec = monthOf([at("2026-12-31", 30, "anat", 23)], -2, null, "2027-02-10")
        expect(dec.title).toBe("December 2026")
        expect(dec.cells[30]).toMatchObject({ date: "2026-12-31", minutes: 30 })
        expect(monthOf([], 0, null, "2027-03-29").cells.map((c) => c.date).slice(26)).toEqual(["2027-03-27", "2027-03-28", "2027-03-29", "2027-03-30", "2027-03-31"])
        expect(monthOf([], 0, null, "2026-10-26").cells).toHaveLength(31)
    })
})

describe("the term", () => {
    it("runs from the term's Monday, a column a week, labelled by month", () => {
        const t = termOf([at("2026-09-01", 30), at("2026-09-22", 200, "phys"), at("2026-08-30", 99)], prefs({ goal: 120 }), "2026-09-01", TODAY, "2026-09-22")
        expect(t.title).toBe("Term")
        expect(t.weeks).toHaveLength(16)
        expect(t.range).toBe("31 Aug – 20 Dec")
        expect(t.weeks[0]).toMatchObject({ monday: "2026-08-31", month: "Sep" })
        expect(t.weeks.map((w) => w.month).filter(Boolean)).toEqual(["Sep", "Oct", "Nov", "Dec"])
        const day = (d: string) => t.weeks.flatMap((w) => w.days).find((x) => x.date === d)!
        expect(day("2026-09-01")).toMatchObject({ minutes: 30, level: 1, future: false })
        expect(day("2026-09-22")).toMatchObject({ minutes: 200, level: 4, picked: true, label: "Tue 22 Sep, 3h 20m" })
        expect(day(TODAY)).toMatchObject({ isToday: true, level: 0 })
        expect(day("2026-09-24").future).toBe(true)
        expect(t.perCourse).toEqual([["phys", 200], ["anat", 30]])
        expect(t.daysStudied).toBe(2)
    })

    it("falls back to the last 12 weeks, levelled by the hour with no goal", () => {
        const t = termOf([at("2026-07-01", 100)], prefs(), null, TODAY)
        expect(t.title).toBe("Last 12 weeks")
        expect(t.weeks[0].monday).toBe("2026-06-29")
        expect(t.weeks[0].month).toBe("Jul")   /* 1 July is in the first week */
        expect(t.weeks).toHaveLength(16)
        expect(t.weeks[0].days[2]).toMatchObject({ date: "2026-07-01", level: 3 })
        /* a term start in the future or over half a year back is left out */
        expect(termOf([], prefs(), "2026-10-01", TODAY).title).toBe("Last 12 weeks")
        expect(termOf([], prefs(), "2026-01-05", TODAY).title).toBe("Last 12 weeks")
    })

    it("spans the new year", () => {
        const t = termOf([at("2027-01-05", 45), at("2026-11-29", 60)], prefs(), "2026-11-30", "2027-01-20")
        expect(t.title).toBe("Term")
        expect(t.range).toBe("30 Nov – 21 Mar")
        expect(t.weeks.map((w) => w.month).filter(Boolean)).toEqual(["Dec", "Jan", "Feb", "Mar"])
        expect(t.daysStudied).toBe(1)
        expect(t.perCourse).toEqual([["anat", 45]])
    })

    it("counts a long term past sixteen weeks up to this week", () => {
        const t = termOf([], prefs(), "2026-04-01", TODAY)
        expect(t.weeks[0].monday).toBe("2026-03-30")
        expect(t.weeks).toHaveLength(26)
        expect(t.weeks.at(-1)!.days.map((d) => d.date)).toContain(TODAY)
    })
})

describe("achievements", () => {
    it("lists the badges, your own, the three closest and the count", () => {
        const items = [normalizeItem({ id: "e1", type: "exam", title: "Midterm", date: "2026-09-10", status: "graded", grade: 91, completedAt: new Date(2026, 8, 10, 12).getTime() }) as Item]
        const own: Achievement[] = [{ id: "a1", name: "Anatomy 1h", sticker: "data:image/webp;base64,AAAA", rule: "hours", courseId: "anat", itemId: null, target: 1 }]
        const b = badges([at("2026-09-21", 70)], items, prefs({ goal: 60 }), TODAY, own, [{ id: "anat" } as never])
        expect(b.own).toMatchObject([{ id: "own-a1", ownId: "a1", earned: true, earnedOn: "2026-09-21" }])
        expect(b.builtIn.find((x) => x.id === "hours-1")).toMatchObject({ earned: true, earnedOn: "2026-09-21" })
        expect(b.builtIn.find((x) => x.id === "grades-90")?.earned).toBe(true)
        expect(b.next).toHaveLength(3)
        expect(b.next.every((x) => !x.earned && x.group !== "grades")).toBe(true)
        expect(b.total).toBe(b.builtIn.length + 1)
        expect(b.earned).toBe([...b.builtIn, ...b.own].filter((x) => x.earned).length)
    })

    it("has nothing earned with nothing logged", () => {
        const b = badges([], [], prefs(), TODAY, [], [])
        expect(b.earned).toBe(0)
        expect(b.own).toEqual([])
    })
})

describe("the History card's actions", () => {
    it("switch tabs, letting a picked day go", () => {
        fake.ui.hist.focusDay = "2026-09-02"
        setHistTab("term")
        expect(fake.ui.hist).toMatchObject({ tab: "term", focusDay: null })
    })

    it("step back and on, never past now, and come back", () => {
        stepHist(-1); stepHist(-1)
        expect(fake.ui.hist.weekOffset).toBe(-2)
        stepHist(1); stepHist(1); stepHist(1)
        expect(fake.ui.hist.weekOffset).toBe(0)
        stepHist(-1); stepHist(0)
        expect(fake.ui.hist.weekOffset).toBe(0)

        Object.assign(fake.ui.hist, { tab: "month", focusDay: "2026-09-02" })
        stepHist(-1)
        expect(fake.ui.hist).toMatchObject({ monthOffset: -1, focusDay: null, weekOffset: 0 })
        stepHist(0)
        expect(fake.ui.hist.monthOffset).toBe(0)

        fake.ui.hist.tab = "term"
        stepHist(-1)
        expect(fake.ui.hist).toMatchObject({ monthOffset: 0, weekOffset: 0 })
    })

    it("pick a day: the Month tab on its month, across the year", () => {
        pickDay("2026-07-14")
        expect(fake.ui.hist).toMatchObject({ tab: "month", monthOffset: -2, focusDay: "2026-07-14" })
        pickDay("2025-12-31")
        expect(fake.ui.hist.monthOffset).toBe(-9)
        pickDay(TODAY)
        expect(fake.ui.hist.monthOffset).toBe(0)
    })

    it("undo a delete: the session shows again and is not deleted", () => {
        const s = at(TODAY, 30), commit = vi.fn()
        fake.ui.hist.undo = { session: s, timer: setTimeout(commit, 6000) }
        expect(shownSessions([s, at(TODAY, 5)], fake.ui.hist.undo as never)).toHaveLength(1)
        undoSessionDelete()
        expect(fake.ui.hist.undo).toBeNull()
        vi.advanceTimersByTime(7000)
        expect(commit).not.toHaveBeenCalled()
        expect(shownSessions([s], null)).toEqual([s])
        undoSessionDelete()   /* nothing waiting: nothing happens */
    })
})

describe("labels", () => {
    it("say a range within a month, or across two", () => {
        expect(rangeLabel("2026-09-14", "2026-09-20")).toBe("14 – 20 Sep")
        expect(rangeLabel("2026-12-28", "2027-01-03")).toBe("28 Dec – 3 Jan")
    })
})
