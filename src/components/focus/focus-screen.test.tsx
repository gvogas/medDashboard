import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { stubMatchMedia } from "@/components/test-media"

// The focus screen over the real study-timer.ts, focus.js and timer.js, and the real
// Spotify engine behind the music pill and panel (with a fake Worker). The store is in
// memory: the meta store where focus.js keeps the run, the sessions it logs, the profile.
// Esc goes through the legacy keyboard.js, as on the page.
const fake = vi.hoisted(() => ({
    meta: new Map<string, unknown>(),
    data: {
        items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], achievements: [] as unknown[],
        study_sessions: [] as Record<string, unknown>[],
        profile: null as Record<string, unknown> | null,
    },
}))
vi.mock("@/legacy/js/store.js", () => ({
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
    saveProfile: async (patch: Record<string, unknown>) => { fake.data.profile = { ...fake.data.profile, ...structuredClone(patch) } },
}))
vi.mock("@/legacy/js/views/render.js", async () => {
    const { notify } = await import("@/bridge")
    return { render: notify, renderView: notify }
})
vi.mock("@/legacy/js/query.js", () => ({ termStart: () => null, schoolCal: () => null }))
vi.mock("@/legacy/js/study-controller.js", () => ({ setView: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))
vi.mock("@/data/actions", () => ({ openCourse: vi.fn(), openSettings: vi.fn(), newItem: vi.fn(), goToday: vi.fn(), step: vi.fn() }))
const api = vi.hoisted(() => ({}) as ReturnType<typeof import("@/components/spotify/test-spotify").fakeApi>)
vi.mock("@/legacy/js/api.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/legacy/js/api.js")>()),
    api,
    spotifyRetryAt: () => 0,
}))

import * as focus from "@/legacy/js/focus.js"
import { normalizeCourse, normalizeItem } from "@/legacy/js/model.js"
import { onKeydown } from "@/legacy/js/keyboard.js"
import { getStudyBadge, notify } from "@/bridge"
import { ui } from "@/data/ui"
import { closeSheet, openSheet } from "@/data/overlay"
import { closeKeys, openKeys } from "@/data/keys"
import { leaveFocus } from "@/data/study-timer"
import { fakeApi, resetEngine, track } from "@/components/spotify/test-spotify"
import { TimerCards } from "@/components/study/timer-cards"
import { StudyDock } from "@/components/study/study-dock"
import { Focus } from "./focus-screen"
import type { Flow } from "@/data/types"

const MIN = 60_000
const T0 = new Date(2026, 8, 28, 14, 0).getTime()
const CLASSIC: Flow = { steps: [["study", 25], ["break", 5]], rounds: 4 }

beforeAll(() => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve())
    document.addEventListener("keydown", onKeydown)
})

beforeEach(() => {
    stubMatchMedia({ reducedMotion: false })
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    document.body.innerHTML = '<div id="app"><aside id="side"></aside><div id="page"></div></div>'
    fake.meta.clear()
    fake.data.courses = [normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#C2571A" }, 0)]
    fake.data.items = [normalizeItem({ id: "e1", type: "quiz", title: "Brachial plexus quiz", courseId: "anat", date: "2026-10-01", status: "todo" })]
    fake.data.study_sessions = [{ id: "s0", courseId: "anat", itemId: null, startedAt: new Date(2026, 8, 28, 9).getTime(), studyMinutes: 20, roundsDone: 0, note: "", manual: false }]
    fake.data.profile = { id: "me", studyFlow: structuredClone(CLASSIC), studyPrefs: { goal: 60 } }
    Object.assign(ui, { focus: false, focusMusic: false, view: "study", study: { courseId: "anat", itemId: "e1" } })
    ui.hist.undo = null
    Object.assign(api, fakeApi())
    resetEngine({ track: track("t1", { title: "Weightless" }), playing: true, device: "MacBook", deviceId: "mac" })
})
afterEach(() => {
    cleanup()
    closeSheet()
    closeKeys()
    focus.reset()
    act(() => notify())
    vi.useRealTimers()
    vi.clearAllMocks()
})

const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
const tickFor = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const screenEl = () => screen.queryByRole("region", { name: "Focus" })
const stage = () => within(screenEl()!)
const dock = () => screen.queryByRole("region", { name: "Study timer" })
const panel = () => screen.queryByRole("complementary", { name: "Music" })
const flip = () => screenEl()!.querySelector(".fc-clock")!
const nextText = () => screenEl()!.querySelector("[data-next]")!.textContent
const key = (k: string, target: Element = document.body) => {
    let pressed = false
    act(() => { pressed = !fireEvent.keyDown(target, { key: k }) })
    return pressed
}

/** The page's pieces: the Study page's cards, the dock and the focus screen. */
const page = () => render(<><TimerCards /><StudyDock /><Focus /></>, { container: document.getElementById("page")! })
async function begin(flow: Flow = CLASSIC) {
    fake.data.profile = { ...fake.data.profile, studyFlow: structuredClone(flow) }
    page()
    fireEvent.click(screen.getByRole("button", { name: "Start focus" }))
    await settle()
}

describe("starting", () => {
    it("Start begins a run and shows the focus screen, with the page behind it hidden", async () => {
        await begin()
        expect(focus.active()).toBe(true)
        expect(screenEl()).not.toBeNull()
        expect(document.documentElement.classList.contains("focusing")).toBe(true)
        expect(screenEl()!.dataset.phase).toBe("study")
        expect(dock()).toBeNull()
        /* the top line: Leave, the course chip, today against the goal */
        expect(stage().getByRole("button", { name: "Leave" })).toBeTruthy()
        expect(stage().getByText("ANAT").parentElement!.textContent).toBe("ANAT · Brachial plexus quiz")
        expect(stage().getByRole("meter", { name: "Daily goal" }).getAttribute("aria-valuenow")).toBe("20")
        expect(stage().getByText("of 1h 00m today").parentElement!.textContent).toBe("20m of 1h 00m today")
        /* the stage */
        expect(stage().getByText("Study · round 1 of 4")).toBeTruthy()
        expect(stage().getByRole("timer").textContent).toContain("25 minutes 0 seconds left")
        expect(screenEl()!.querySelectorAll("[data-strip] > span")).toHaveLength(4)
        expect(nextText()).toBe("Next · Break 5 min · done at 16:00")
        expect(stage().getByRole("button", { name: "Skip" })).toBeTruthy()
        expect(stage().getByRole("button", { name: "Pause timer" })).toBeTruthy()
        expect(stage().getByRole("button", { name: "Stop & log" })).toBeTruthy()
        /* focus starts on the screen, not on the hidden page */
        expect(document.activeElement).toBe(screenEl())
        /* the music, folded */
        expect(stage().getByRole("region", { name: "Music" }).textContent).toContain("Weightless")
    })

    it("shows the course with no item, a deleted course as none, and no goal without one", async () => {
        ui.study = { courseId: "anat", itemId: null }
        fake.data.profile = { id: "me", studyFlow: structuredClone(CLASSIC) }
        await begin()
        expect(stage().getByText("ANAT").parentElement!.textContent).toBe("ANAT")
        expect(stage().queryByRole("meter")).toBeNull()
        expect(stage().queryByText(/today$/)).toBeNull()
        fake.data.courses = []
        act(() => notify())
        expect(stage().getByText("No course")).toBeTruthy()
    })
})

describe("the run on the focus screen", () => {
    it("fills the strip and counts down as it goes, and says what comes next and when it is done", async () => {
        await begin()
        await tickFor(10 * MIN)
        expect(stage().getByRole("timer").textContent).toContain("15 minutes 0 seconds left")
        const now = screenEl()!.querySelector<HTMLElement>("[data-now]")!
        expect(now.dataset.kind).toBe("study")
        expect(now.querySelector("i")!.style.width).toBe("40%")
        expect(nextText()).toBe("Next · Break 5 min · done at 16:00")
        /* today counts this run's study so far */
        expect(stage().getByText("of 1h 00m today").parentElement!.textContent).toBe("30m of 1h 00m today")
    })

    it("pauses and resumes, and the finish moves on while paused", async () => {
        await begin()
        fireEvent.click(stage().getByRole("button", { name: "Pause timer" }))
        await settle()
        expect(focus.read()!.paused).toBe(true)
        expect(stage().getByText("Study · round 1 of 4 · paused")).toBeTruthy()
        await tickFor(7 * MIN)
        expect(stage().getByRole("timer").textContent).toContain("25 minutes 0 seconds left")
        expect(nextText()).toBe("Next · Break 5 min · done at 16:07")
        fireEvent.click(stage().getByRole("button", { name: "Resume timer" }))
        await settle()
        expect(focus.read()!.paused).toBe(false)
        await tickFor(MIN)
        expect(nextText()).toBe("Next · Break 5 min · done at 16:07")
    })

    it("skips into the break, in the break colours, without counting the study skipped", async () => {
        await begin()
        await tickFor(10 * MIN)
        fireEvent.click(stage().getByRole("button", { name: "Skip" }))
        await settle()
        expect(focus.read()).toMatchObject({ kind: "break", index: 1, studyMs: 10 * MIN })
        expect(screenEl()!.dataset.phase).toBe("break")
        expect(stage().getByText("Break · round 1 of 4")).toBeTruthy()
        expect(nextText()).toBe("Next · Study 25 min · done at 15:45")
    })

    it("says so on the last step", async () => {
        await begin({ steps: [["study", 25]], rounds: 1 })
        expect(nextText()).toBe("Last step · done at 14:25")
    })

    it("logs the study on Stop & log and goes to the Study page", async () => {
        ui.view = "week"
        await begin()
        await tickFor(12 * MIN + 30_000)
        fireEvent.click(stage().getByRole("button", { name: "Stop & log" }))
        await settle()
        expect(focus.active()).toBe(false)
        expect(fake.data.study_sessions.at(-1)).toMatchObject({ courseId: "anat", itemId: "e1", studyMinutes: 12, startedAt: T0 })
        expect(ui).toMatchObject({ focus: false, view: "study" })
        expect(screenEl()).toBeNull()
        expect(dock()).toBeNull()
        expect(document.documentElement.classList.contains("focusing")).toBe(false)
    })

    it("goes to the Study page when the flow ends, from wherever you are", async () => {
        await begin({ steps: [["study", 1]], rounds: 1 })
        act(() => leaveFocus())
        expect(ui.view).toBe("week")
        await tickFor(61_000)
        await settle()
        expect(fake.data.study_sessions.at(-1)).toMatchObject({ studyMinutes: 1, roundsDone: 1 })
        expect(ui).toMatchObject({ focus: false, view: "study" })
        expect(dock()).toBeNull()
    })

    it("titles the tab with the time and badges the Study icon, until the run is done", async () => {
        await begin()
        expect(document.title).toBe("25:00 · Study")
        expect(getStudyBadge()).toBe("25:00")
        await tickFor(90_000)
        expect(document.title).toBe("23:30 · Study")
        expect(getStudyBadge()).toBe("23:30")
        fireEvent.click(stage().getByRole("button", { name: "Stop & log" }))
        await settle()
        expect(document.title).toBe("Rounds")
        expect(getStudyBadge()).toBeNull()
    })
})

describe("leaving and coming back", () => {
    it("Leave and Esc go off the focus screen to the dock, and the dock's Focus comes back", async () => {
        await begin()
        fireEvent.click(stage().getByRole("button", { name: "Leave" }))
        expect(screenEl()).toBeNull()
        expect(document.documentElement.classList.contains("focusing")).toBe(false)
        /* the Study page would open the focus screen again, so you land on the week */
        expect(ui.view).toBe("week")
        expect(dock()).not.toBeNull()
        fireEvent.click(within(dock()!).getByRole("button", { name: "Focus" }))
        expect(screenEl()).not.toBeNull()
        expect(dock()).toBeNull()
        expect(key("Escape")).toBe(false)
        expect(screenEl()).toBeNull()
        expect(dock()).not.toBeNull()
    })

    it("a new Study step pulls you back in, unless a sheet is open", async () => {
        await begin({ steps: [["study", 1], ["break", 1]], rounds: 3 })
        await tickFor(61_000)
        act(() => leaveFocus())
        /* the break ends: back to the focus screen for the study */
        await tickFor(60_000)
        expect(focus.read()).toMatchObject({ kind: "study", round: 2 })
        expect(screenEl()).not.toBeNull()
        await tickFor(61_000)
        act(() => leaveFocus())
        act(() => openSheet({ kind: "course", id: null }))
        await tickFor(60_000)
        expect(focus.read()).toMatchObject({ kind: "study", round: 3 })
        expect(screenEl()).toBeNull()
        expect(ui.focus).toBe(false)
    })

    it("closes if the run is gone", async () => {
        await begin()
        act(() => { focus.reset(); notify() })
        expect(screenEl()).toBeNull()
        expect(ui.focus).toBe(false)
        expect(document.documentElement.classList.contains("focusing")).toBe(false)
    })
})

describe("the music", () => {
    it("▴ Music opens the side panel and ✕ shuts it; the pill makes way", async () => {
        await begin()
        fireEvent.click(stage().getByRole("button", { name: "▴ Music" }))
        expect(ui.focusMusic).toBe(true)
        expect(panel()).not.toBeNull()
        expect(stage().queryByRole("region", { name: "Music" })).toBeNull()
        /* the stage is still there beside it */
        expect(stage().getByRole("timer")).toBeTruthy()
        fireEvent.click(within(panel()!).getByRole("button", { name: "Close music" }))
        expect(ui.focusMusic).toBe(false)
        expect(panel()).toBeNull()
        expect(document.activeElement).toBe(screenEl())
    })

    it("M opens and shuts it, but not while typing in it", async () => {
        await begin()
        expect(key("m")).toBe(true)
        expect(panel()).not.toBeNull()
        const box = within(panel()!).queryByRole("searchbox") ?? within(panel()!).getAllByRole("textbox")[0]
        expect(key("m", box)).toBe(false)
        expect(panel()).not.toBeNull()
        expect(key("M")).toBe(true)
        expect(panel()).toBeNull()
    })

    it("/ opens the panel if it is shut and goes to the music's search box", async () => {
        await begin()
        expect(key("/")).toBe(true)
        expect(panel()).not.toBeNull()
        act(() => { vi.advanceTimersByTime(50) })     /* the next frame */
        expect(document.activeElement?.hasAttribute("data-music-search")).toBe(true)
    })

    it("Esc shuts the panel first, then leaves", async () => {
        await begin()
        key("m")
        key("Escape")
        expect(panel()).toBeNull()
        expect(screenEl()).not.toBeNull()
        expect(ui.focus).toBe(true)
        key("Escape")
        expect(screenEl()).toBeNull()
        expect(ui.focus).toBe(false)
    })

    it("stays open for the session: leaving and coming back finds it open", async () => {
        await begin()
        key("m")
        key("Escape")
        key("m")
        act(() => leaveFocus())
        fireEvent.click(within(dock()!).getByRole("button", { name: "Focus" }))
        expect(panel()).not.toBeNull()
    })

    it("is a side panel beside the stage, a bottom sheet on a phone, and slides only with motion", async () => {
        await begin()
        key("m")
        const cls = panel()!.className
        expect(cls).toContain("w-[38%]")
        expect(cls).toContain("max-[700px]:h-[70dvh]")
        expect(cls).toContain("animate-[focus-panel-in_.28s_ease-out]")
        expect(cls).toContain("motion-reduce:animate-none")
        expect(cls).toContain("motion-reduce:max-[700px]:animate-none")
    })
})

describe("keys", () => {
    it("Space pauses and resumes", async () => {
        await begin()
        expect(key(" ")).toBe(true)
        await settle()
        expect(focus.read()!.paused).toBe(true)
        key(" ")
        await settle()
        expect(focus.read()!.paused).toBe(false)
    })

    it("Space is left to a focused button, a box, an open sheet or the shortcuts panel", async () => {
        await begin()
        expect(key(" ", stage().getByRole("button", { name: "Skip" }))).toBe(false)
        key("m")
        const box = within(panel()!).queryByRole("searchbox") ?? within(panel()!).getAllByRole("textbox")[0]
        expect(key(" ", box)).toBe(false)
        act(() => openSheet({ kind: "course", id: null }))
        expect(key(" ")).toBe(false)
        expect(key("m")).toBe(false)
        act(() => closeSheet())
        act(() => openKeys())
        expect(key(" ")).toBe(false)
        act(() => closeKeys())
        await settle()
        expect(focus.read()!.paused).toBe(false)
    })

    it("the page's single keys do nothing on the focus screen", async () => {
        const actions = await import("@/data/actions")
        await begin()
        key("n")
        key("t")
        expect(actions.newItem).not.toHaveBeenCalled()
        expect(actions.goToday).not.toHaveBeenCalled()
    })
})

describe("motion", () => {
    it("flips the clock's cards as the seconds change", async () => {
        await begin()
        await tickFor(1000)
        expect(flip().querySelector(".fc-flipping")).not.toBeNull()
    })

    it("with reduced motion, the digits just change", async () => {
        stubMatchMedia({ reducedMotion: true })
        await begin()
        await tickFor(1000)
        expect(flip().querySelector(".fc-flipping")).toBeNull()
        expect(stage().getByRole("timer").textContent).toContain("24 minutes 59 seconds left")
    })
})
