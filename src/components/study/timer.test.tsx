import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { stubMatchMedia } from "@/components/test-media"

// The timer cards and the corner dock over the real study-timer.ts, run.ts and core/timer.ts,
// with a store in memory: the device's meta store (where run.ts keeps the run), the
// sessions it logs, and a profile that saving replaces, as a reload does.
const fake = vi.hoisted(() => ({
    meta: new Map<string, unknown>(),
    data: {
        items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], achievements: [] as unknown[],
        study_sessions: [] as Record<string, unknown>[],
        profile: null as Record<string, unknown> | null,
    },
    profileSaves: [] as Record<string, unknown>[],
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    conflicts: [],
    subscribe: () => () => {},
    course: (id: string) => (fake.data.courses as { id: string }[]).find((c) => c.id === id) || null,
    item: (id: string) => (fake.data.items as { id: string }[]).find((c) => c.id === id) || null,
    meta: {
        get: async (key: string) => structuredClone(fake.meta.get(key) ?? null),
        set: async (key: string, value: unknown) => { fake.meta.set(key, structuredClone(value)) },
    },
    saveStudySession: async (s: Record<string, unknown>) => { fake.data.study_sessions = [...fake.data.study_sessions, s] },
    saveProfile: async (patch: Record<string, unknown>) => {
        fake.profileSaves.push(patch)
        await Promise.resolve()
        fake.data.profile = { ...fake.data.profile, ...structuredClone(patch) }
    },
}))
vi.mock("@/data/query", () => ({ termStart: () => null, schoolCal: () => null }))
const actions = vi.hoisted(() => ({ openCourse: vi.fn(), openSettings: vi.fn() }))
vi.mock("@/data/actions", () => actions)

import * as focus from "@/data/run"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { notify } from "@/bridge"
import { ui } from "@/data/ui"
import { leaveFocus } from "@/data/study-timer"
import { TimerCards } from "./timer-cards"
import { StudyDock } from "./study-dock"
import type { Flow } from "@/data/types"

const MIN = 60_000
const T0 = new Date(2026, 8, 28, 14, 0).getTime()
const CLASSIC: Flow = { steps: [["study", 25], ["break", 5]], rounds: 4 }

beforeAll(() => {
    stubMatchMedia({ reducedMotion: true })
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve())
})

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    fake.meta.clear()
    fake.profileSaves = []
    fake.data.courses = [
        normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#C2571A" }, 0),
        normalizeCourse({ id: "phys", code: "PHYS", name: "Physiology", color: "#1E628F" }, 1),
        normalizeCourse({ id: "old", code: "OLD", name: "Old course", color: "#1E628F", archived: true }, 2),
    ]
    fake.data.items = [
        normalizeItem({ id: "e2", type: "exam", title: "Upper limb exam", courseId: "anat", date: "2026-10-09", status: "todo" }),
        normalizeItem({ id: "e1", type: "quiz", title: "Brachial plexus quiz", courseId: "anat", date: "2026-10-01", status: "todo" }),
        normalizeItem({ id: "e0", type: "quiz", title: "Done quiz", courseId: "anat", date: "2026-09-20", status: "done" }),
        normalizeItem({ id: "p1", type: "exam", title: "Cardio exam", courseId: "phys", date: "2026-10-03", status: "todo" }),
    ]
    fake.data.study_sessions = []
    fake.data.profile = { id: "me", studyFlow: structuredClone(CLASSIC), studyPrefs: { goal: 60 } }
    Object.assign(ui, { focus: false, view: "study", bg: "med", study: { courseId: null, itemId: null } })
    ui.hist.undo = null
})
afterEach(async () => {
    cleanup()
    focus.reset()
    act(() => notify())
    vi.useRealTimers()
    vi.clearAllMocks()
})

const flow = () => fake.data.profile!.studyFlow as Flow
const region = (name: string) => screen.getByRole("region", { name })
/* the store's saves and the redraws after them settle */
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
const tickFor = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const cards = () => render(<TimerCards />)
const start = async () => {
    fireEvent.click(within(region("Ready")).getByRole("button", { name: "Start focus" }))
    await settle()
}

describe("the Ready card", () => {
    it("shows the first step on the clock, the rounds, the course and item to log against, and Start", () => {
        cards()
        const ready = within(region("Ready"))
        expect(ready.getByText("Ready")).toBeTruthy()
        expect(ready.getByRole("timer").textContent).toContain("25 minutes 0 seconds left")
        expect(region("Ready").querySelectorAll("[data-strip] > span")).toHaveLength(4)
        expect(region("Ready").querySelectorAll("[data-strip] [data-kind]")).toHaveLength(8)
        expect(ready.getByText("Round 1 of 4")).toBeTruthy()
        expect(ready.getByText("1h 40m study · 2h 00m total")).toBeTruthy()
        /* live courses only; the first is picked */
        const course = ready.getByRole("combobox", { name: "Course" }) as HTMLSelectElement
        expect([...course.options].map((o) => o.text)).toEqual(["ANAT · Anatomy", "PHYS · Physiology"])
        expect(course.value).toBe("anat")
        /* the course's open items, soonest first */
        const item = ready.getByRole("combobox", { name: "Item (optional)" }) as HTMLSelectElement
        expect([...item.options].map((o) => o.text)).toEqual(["No item", "Brachial plexus quiz", "Upper limb exam"])
        expect(item.value).toBe("")
        expect(ready.getByRole("button", { name: "Start focus" })).toBeTruthy()
        expect(ready.getByText("Opens the focus screen: the clock and your music, nothing else.")).toBeTruthy()
    })

    it("keeps the course and item picked, and a new course starts with no item", () => {
        cards()
        const ready = within(region("Ready"))
        fireEvent.change(ready.getByRole("combobox", { name: "Item (optional)" }), { target: { value: "e2" } })
        expect(ui.study).toEqual({ courseId: null, itemId: "e2" })
        fireEvent.change(ready.getByRole("combobox", { name: "Course" }), { target: { value: "phys" } })
        expect(ui.study).toEqual({ courseId: "phys", itemId: null })
        const item = ready.getByRole("combobox", { name: "Item (optional)" }) as HTMLSelectElement
        expect([...item.options].map((o) => o.text)).toEqual(["No item", "Cardio exam"])
        fireEvent.change(item, { target: { value: "p1" } })
        expect((ready.getByRole("combobox", { name: "Item (optional)" }) as HTMLSelectElement).value).toBe("p1")
    })

    it("asks for a course first when there is none, or only archived ones", () => {
        fake.data.courses = [(fake.data.courses as { id: string }[])[2]]
        const { unmount } = cards()
        const ready = within(region("Ready"))
        expect(ready.getByText("Add a course first; study time is logged against one.")).toBeTruthy()
        expect(ready.queryByRole("combobox")).toBeNull()
        expect(ready.queryByRole("button", { name: "Start focus" })).toBeNull()
        fireEvent.click(ready.getByRole("button", { name: "Add a course" }))
        expect(actions.openCourse).toHaveBeenCalledWith(null)
        unmount()
        fake.data.courses = []
        cards()
        expect(within(region("Ready")).getByRole("button", { name: "Add a course" })).toBeTruthy()
    })

    it("starts a run on the saved flow, logged against the course and item picked, in full screen", async () => {
        cards()
        const ready = within(region("Ready"))
        fireEvent.change(ready.getByRole("combobox", { name: "Course" }), { target: { value: "anat" } })
        fireEvent.change(ready.getByRole("combobox", { name: "Item (optional)" }), { target: { value: "e1" } })
        await start()
        expect(focus.active()).toBe(true)
        expect(focus.read()).toMatchObject({ courseId: "anat", itemId: "e1", kind: "study", round: 1, leftMs: 25 * MIN, flow: CLASSIC })
        expect(document.documentElement.requestFullscreen).toHaveBeenCalledOnce()
        expect(ui.focus).toBe(true)
        /* off the focus screen, a second Start is not offered: the card goes back to it instead */
        act(() => leaveFocus())
        expect(ready.queryByRole("button", { name: "Start focus" })).toBeNull()
        fireEvent.click(ready.getByRole("button", { name: "Back to focus" }))
        expect(ui.focus).toBe(true)
        expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(2)
    })

    it("starts on minutes typed a moment before Start, saved as the box lost focus", async () => {
        cards()
        const box = screen.getByRole("spinbutton", { name: "Minutes for step 1" })
        fireEvent.change(box, { target: { value: "40" } })
        fireEvent.blur(box)
        await start()
        expect(focus.read()).toMatchObject({ leftMs: 40 * MIN, flow: { steps: [["study", 40], ["break", 5]], rounds: 4 } })
    })
})

describe("the flow card", () => {
    it("names the third Quick start for the theme, and presses the preset the flow is", async () => {
        ui.bg = "cs"
        cards()
        const card = within(region("Your flow"))
        const pressed = (name: string) => card.getByRole("button", { name }).getAttribute("aria-pressed")
        expect(card.queryByRole("button", { name: "Anki then read" })).toBeNull()
        expect([pressed("Classic 25/5"), pressed("Deep 50/10"), pressed("LeetCode then read")]).toEqual(["true", "false", "false"])
        fireEvent.click(card.getByRole("button", { name: "LeetCode then read" }))
        await settle()
        expect(flow()).toEqual({ steps: [["study", 20], ["break", 5], ["study", 40], ["break", 15]], rounds: 2 })
        expect([pressed("Classic 25/5"), pressed("LeetCode then read")]).toEqual(["false", "true"])
    })

    it("shows one round in proportion, the numbered steps, the rounds, the totals and the presets", () => {
        cards()
        const card = within(region("Your flow"))
        expect(card.getByText("Tap Study or Break to switch it")).toBeTruthy()
        const bar = [...region("Your flow").querySelectorAll<HTMLElement>("[data-round] > i")]
        expect(bar.map((i) => i.style.flexGrow)).toEqual(["25", "5"])
        expect(card.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Studymin✕", "2Breakmin✕"])
        expect((card.getByRole("spinbutton", { name: "Minutes for step 1" }) as HTMLInputElement).value).toBe("25")
        expect((card.getByRole("spinbutton", { name: "Repeat" }) as HTMLInputElement).value).toBe("4")
        expect(card.getByText("1h 40m study · 2h 00m total")).toBeTruthy()
        expect(card.getAllByRole("button").filter((b) => ["Classic 25/5", "Deep 50/10", "Anki then read"].includes(b.textContent!))).toHaveLength(3)
    })

    it("switches a step between Study and Break, but never the only Study step", async () => {
        cards()
        const card = within(region("Your flow"))
        const only = card.getByRole("button", { name: "Step 1: Study" }) as HTMLButtonElement
        expect(only.disabled).toBe(true)
        expect((card.getByRole("button", { name: "Remove step 1" }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(card.getByRole("button", { name: "Step 2: Break, switch to study" }))
        await settle()
        expect(flow().steps).toEqual([["study", 25], ["study", 5]])
        /* two Study steps: either may now switch or go */
        expect((card.getByRole("button", { name: "Step 1: Study, switch to a break" }) as HTMLButtonElement).disabled).toBe(false)
        expect((card.getByRole("button", { name: "Remove step 1" }) as HTMLButtonElement).disabled).toBe(false)
    })

    it("saves a step's minutes on Enter or when the box is left, within 1 to 180", async () => {
        cards()
        const box = () => screen.getByRole("spinbutton", { name: "Minutes for step 2" }) as HTMLInputElement
        fireEvent.change(box(), { target: { value: "1" } })
        expect(fake.profileSaves).toHaveLength(0)
        fireEvent.change(box(), { target: { value: "12" } })
        fireEvent.keyDown(box(), { key: "Enter" })
        await settle()
        expect(flow().steps[1]).toEqual(["break", 12])
        fireEvent.change(box(), { target: { value: "500" } })
        fireEvent.blur(box())
        await settle()
        expect(flow().steps[1]).toEqual(["break", 180])
        expect(box().value).toBe("180")
        /* the saved value again: nothing to save, the box shows it */
        fireEvent.change(box(), { target: { value: "900" } })
        fireEvent.blur(box())
        await settle()
        expect(box().value).toBe("180")
        expect(fake.profileSaves).toHaveLength(2)
    })

    it("puts back what is saved when a box is left empty, or on Escape", async () => {
        cards()
        const box = () => screen.getByRole("spinbutton", { name: "Minutes for step 1" }) as HTMLInputElement
        fireEvent.change(box(), { target: { value: "" } })
        fireEvent.blur(box())
        expect(box().value).toBe("25")
        fireEvent.change(box(), { target: { value: "70" } })
        fireEvent.keyDown(box(), { key: "Escape" })
        expect(box().value).toBe("25")
        fireEvent.blur(box())
        await settle()
        expect(fake.profileSaves).toHaveLength(0)
    })

    it("adds study and breaks, up to twelve steps, and removes them", async () => {
        cards()
        const card = within(region("Your flow"))
        fireEvent.click(card.getByRole("button", { name: "Add study" }))
        await settle()
        fireEvent.click(card.getByRole("button", { name: "Add break" }))
        await settle()
        expect(flow().steps).toEqual([["study", 25], ["break", 5], ["study", 25], ["break", 5]])
        expect(card.getAllByRole("listitem")).toHaveLength(4)
        fireEvent.click(card.getByRole("button", { name: "Remove step 2" }))
        await settle()
        expect(flow().steps).toEqual([["study", 25], ["study", 25], ["break", 5]])
        fake.data.profile = { ...fake.data.profile, studyFlow: { steps: Array.from({ length: 12 }, (_, i) => [i % 2 ? "break" : "study", 10]), rounds: 1 } }
        act(() => notify())
        expect((card.getByRole("button", { name: "Add study" }) as HTMLButtonElement).disabled).toBe(true)
        expect((card.getByRole("button", { name: "Add break" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("repeats 1 to 12 rounds, and the totals follow", async () => {
        cards()
        const rounds = () => screen.getByRole("spinbutton", { name: "Repeat" }) as HTMLInputElement
        fireEvent.change(rounds(), { target: { value: "2" } })
        fireEvent.blur(rounds())
        await settle()
        expect(flow().rounds).toBe(2)
        expect(within(region("Your flow")).getByText("50m study · 1h 00m total")).toBeTruthy()
        expect(within(region("Ready")).getByText("Round 1 of 2")).toBeTruthy()
        fireEvent.change(rounds(), { target: { value: "40" } })
        fireEvent.keyDown(rounds(), { key: "Enter" })
        await settle()
        expect(flow().rounds).toBe(12)
        expect(rounds().value).toBe("12")
    })

    it("replaces the flow with a Quick start preset", async () => {
        cards()
        fireEvent.click(within(region("Your flow")).getByRole("button", { name: "Anki then read" }))
        await settle()
        expect(flow()).toEqual({ steps: [["study", 20], ["break", 5], ["study", 40], ["break", 15]], rounds: 2 })
        expect(within(region("Ready")).getByRole("timer").textContent).toContain("20 minutes 0 seconds left")
        expect(within(region("Your flow")).getAllByRole("listitem")).toHaveLength(4)
    })
})

describe("the corner dock", () => {
    const dock = () => screen.queryByRole("region", { name: "Study timer" })
    const both = () => render(<><TimerCards /><StudyDock /></>)
    /* Start opens the focus screen; the dock is for when you leave it */
    const startAndLeave = async () => { await start(); act(() => leaveFocus()) }

    it("is not there without a run", () => {
        render(<StudyDock />)
        expect(dock()).toBeNull()
    })

    it("shows the clock, the phase and round, and today against the goal, off the focus screen", async () => {
        fake.data.study_sessions = [{ id: "s1", courseId: "anat", itemId: null, startedAt: new Date(2026, 8, 28, 9).getTime(), studyMinutes: 20, roundsDone: 0, note: "", manual: false }]
        both()
        await start()
        /* the focus screen is up: no dock */
        expect(ui.focus).toBe(true)
        expect(dock()).toBeNull()
        act(() => leaveFocus())
        const d = within(dock()!)
        expect(d.getByRole("timer").textContent).toContain("25 minutes 0 seconds left")
        expect(d.getByText("On shift · round 1 of 4")).toBeTruthy()
        expect(dock()!.dataset.phase).toBe("study")
        await tickFor(12 * MIN)
        expect(d.getByRole("timer").textContent).toContain("13 minutes 0 seconds left")
        /* 20 logged today and 12 of this run, of 60 */
        const ring = d.getByRole("meter", { name: "Daily goal" })
        expect(ring.getAttribute("aria-valuenow")).toBe("32")
        expect(ring.parentElement!.title).toBe("Today: 32m of 1h 00m")
    })

    it("pauses and resumes the run", async () => {
        both()
        await startAndLeave()
        const d = within(dock()!)
        fireEvent.click(d.getByRole("button", { name: "Pause timer" }))
        await settle()
        expect(focus.read()!.paused).toBe(true)
        expect(d.getByText("On shift · round 1 of 4 · paused")).toBeTruthy()
        await tickFor(5 * MIN)
        expect(d.getByRole("timer").textContent).toContain("25 minutes 0 seconds left")
        fireEvent.click(d.getByRole("button", { name: "Resume timer" }))
        await settle()
        expect(focus.read()!.paused).toBe(false)
        expect(d.getByRole("button", { name: "Pause timer" })).toBeTruthy()
    })

    it("turns to the break colours in a break, and has no ring without a goal", async () => {
        fake.data.profile = { id: "me", studyFlow: { steps: [["study", 1], ["break", 5]], rounds: 1 } }
        both()
        await startAndLeave()
        await tickFor(61_000)
        expect(dock()!.dataset.phase).toBe("break")
        expect(within(dock()!).getByText("Break · round 1 of 1")).toBeTruthy()
        expect(within(dock()!).queryByRole("meter")).toBeNull()
    })

    it("goes back to the focus screen", async () => {
        both()
        await startAndLeave()
        expect(ui.view).toBe("week")
        fireEvent.click(within(dock()!).getByRole("button", { name: "Focus" }))
        expect(ui.focus).toBe(true)
        expect(dock()).toBeNull()
    })

    it("goes when the run is stopped", async () => {
        both()
        await startAndLeave()
        expect(dock()).not.toBeNull()
        await act(() => focus.stop())
        await settle()
        expect(dock()).toBeNull()
    })
})
