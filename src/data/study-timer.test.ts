import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StrictMode } from "react"
import { act, renderHook } from "@testing-library/react"

/* A store in memory: the device's meta store (where run.ts keeps the run), saved
   sessions, and a profile that saving replaces, as a reload does. run.ts and core/timer.ts
   are the real engine. */
const fake = vi.hoisted(() => ({
    meta: new Map<string, unknown>(),
    sessions: [] as Record<string, unknown>[],
    profileSaves: [] as Record<string, unknown>[],
    failSaves: false,
    data: {
        items: [] as unknown[],
        courses: [] as unknown[],
        study_sessions: [] as unknown[],
        profile: null as Record<string, unknown> | null,
    },
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    subscribe: () => () => {},
    meta: {
        get: async (key: string) => structuredClone(fake.meta.get(key) ?? null),
        set: async (key: string, value: unknown) => { fake.meta.set(key, structuredClone(value)) },
    },
    saveStudySession: async (s: Record<string, unknown>) => {
        if (fake.failSaves) throw new Error("save failed")
        fake.sessions.push(s)
    },
    saveProfile: async (patch: Record<string, unknown>) => {
        if (fake.failSaves) throw new Error("save failed")
        fake.profileSaves.push(patch)
        fake.data.profile = { ...fake.data.profile, ...structuredClone(patch) }
    },
}))
import * as focus from "@/data/run"
import { getStudyBadge, notify, subscribe } from "@/bridge"
import {
    addStep, applyPreset, clockTime, delStep, doneAt, escapeFocus, leaveFocus, openFocus, flowTotals, nextLine, pickFor, setRounds, setStepKind, setStepMinutes, skip, startRun,
    stopRun, stripSegments, tickTitle, timeText, todaySoFar, toggleMusic, togglePause, useFlow, useRun, type Run,
} from "./study-timer"
import { ui } from "./ui"
import type { Course, Flow, Item, StudySession } from "./types"

/* every redraw goes through the bridge */
const redraw = vi.fn()
subscribe(redraw)

const MIN = 60_000
const T0 = new Date(2026, 8, 28, 14, 0).getTime()
const CLASSIC: Flow = { steps: [["study", 25], ["break", 5]], rounds: 4 }
const TWELVE: Flow = { steps: Array.from({ length: 12 }, (_, i) => [i % 2 ? "break" : "study", 10] as ["study" | "break", number]), rounds: 12 }
const anat = { id: "anat", code: "ANAT", name: "Anatomy", archived: false } as Course
const old = { id: "old", code: "OLD", name: "Old", archived: true } as Course

/** A run as useRun gives it, `into` ms of flow time from the start (nothing paused or skipped). */
function runAt(flow: Flow, into: number, extra: Partial<Run> = {}): Run {
    const roundMs = flow.steps.reduce((a, [, m]) => a + m * MIN, 0), totalMs = roundMs * flow.rounds
    const at = Math.min(into, totalMs), roundsDone = Math.min(flow.rounds, Math.floor(at / roundMs))
    let left = at - Math.min(roundsDone, flow.rounds - 1) * roundMs, index = 0
    while (index < flow.steps.length - 1 && left >= flow.steps[index][1] * MIN) { left -= flow.steps[index][1] * MIN; index++ }
    const stepMs = flow.steps[index][1] * MIN
    return {
        round: Math.min(flow.rounds, roundsDone + 1), index, kind: flow.steps[index][0], leftMs: stepMs - Math.min(left, stepMs), stepMs,
        studyMs: 0, roundsDone, done: into >= totalMs, paused: false, leftInFlowMs: Math.max(0, totalMs - into),
        courseId: "anat", itemId: null, flow, startedAt: T0, at: T0 + into, ...extra,
    }
}

const session = (startedAt: number, studyMinutes: number): StudySession =>
    ({ id: String(startedAt), courseId: "anat", itemId: null, startedAt, studyMinutes, roundsDone: 0, note: "", manual: false })

/* promises inside run.ts (the meta store, the session save) settle */
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })

describe("the flow's totals", () => {
    it("adds the study and every step, times the rounds", () => {
        expect(flowTotals(CLASSIC)).toEqual({ study: 100, total: 120 })
        expect(flowTotals({ steps: [["study", 25]], rounds: 1 })).toEqual({ study: 25, total: 25 })
        expect(flowTotals(TWELVE)).toEqual({ study: 720, total: 1440 })
    })
})

describe("the round strip", () => {
    it("is all to come before a run, one row per round and one segment per step", () => {
        const rows = stripSegments(CLASSIC, null)
        expect(rows).toHaveLength(4)
        expect(rows[0]).toEqual([{ kind: "study", minutes: 25, fill: 0, now: false }, { kind: "break", minutes: 5, fill: 0, now: false }])
        expect(rows.flat().every((s) => s.fill === 0 && !s.now)).toBe(true)
    })

    it("fills the steps done, part of the one running, and none of those to come", () => {
        /* round 2, ten minutes into its study */
        const rows = stripSegments(CLASSIC, runAt(CLASSIC, 40 * MIN))
        expect(rows[0].map((s) => s.fill)).toEqual([1, 1])
        expect(rows[1][0]).toEqual({ kind: "study", minutes: 25, fill: 0.4, now: true })
        expect(rows[1][1].fill).toBe(0)
        expect(rows.slice(2).flat().every((s) => s.fill === 0)).toBe(true)
    })

    it("is full at the end, and has twelve rows of twelve for the biggest flow", () => {
        expect(stripSegments(CLASSIC, runAt(CLASSIC, 120 * MIN)).flat().every((s) => s.fill === 1)).toBe(true)
        const rows = stripSegments(TWELVE, runAt(TWELVE, 735 * MIN))
        expect(rows).toHaveLength(12)
        expect(rows.every((r) => r.length === 12)).toBe(true)
        /* round 7 (720 min in), its second step half done */
        expect(rows[6][0].fill).toBe(1)
        expect(rows[6][1]).toMatchObject({ fill: 0.5, now: true })
        expect(rows[5].every((s) => s.fill === 1)).toBe(true)
        expect(rows[6].slice(2).every((s) => s.fill === 0)).toBe(true)
    })

    it("has one segment for a one-step flow", () => {
        const f: Flow = { steps: [["study", 50]], rounds: 1 }
        expect(stripSegments(f, runAt(f, 5 * MIN))).toEqual([[{ kind: "study", minutes: 50, fill: 0.1, now: true }]])
    })
})

describe("what comes next", () => {
    it("names the next step, in this round or the next", () => {
        expect(nextLine(runAt(CLASSIC, 0))).toEqual({ last: false, kind: "break", minutes: 5, round: 1 })
        expect(nextLine(runAt(CLASSIC, 27 * MIN))).toEqual({ last: false, kind: "study", minutes: 25, round: 2 })
    })

    it("says the last step is the last", () => {
        expect(nextLine(runAt(CLASSIC, 117 * MIN))).toEqual({ last: true })
        expect(nextLine(runAt({ steps: [["study", 25]], rounds: 1 }, 0))).toEqual({ last: true })
        expect(nextLine(runAt({ steps: [["study", 25]], rounds: 3 }, 0))).toEqual({ last: false, kind: "study", minutes: 25, round: 2 })
        expect(nextLine(runAt(TWELVE, 1435 * MIN))).toEqual({ last: true })
    })
})

describe("when the run is done", () => {
    it("is fixed while the run goes, whatever the time now", () => {
        const r = runAt(CLASSIC, 10 * MIN)
        expect(doneAt(r, r.at)).toBe(T0 + 120 * MIN)
        expect(doneAt(r, r.at + 900)).toBe(T0 + 120 * MIN)
    })

    it("moves on with the clock while paused", () => {
        const r = runAt(CLASSIC, 10 * MIN, { paused: true })
        expect(doneAt(r, r.at)).toBe(T0 + 120 * MIN)
        expect(doneAt(r, r.at + 7 * MIN)).toBe(T0 + 127 * MIN)
    })
})

describe("today so far", () => {
    const TODAY = "2026-09-28"
    const logged = [session(new Date(2026, 8, 28, 9).getTime(), 40), session(new Date(2026, 8, 27, 20).getTime(), 90)]

    it("counts today's sessions and this run's whole minutes of study", () => {
        expect(todaySoFar(logged, null, TODAY)).toBe(40)
        expect(todaySoFar(logged, runAt(CLASSIC, 0, { studyMs: 12.9 * MIN }), TODAY)).toBe(52)
        expect(todaySoFar([], runAt(CLASSIC, 0, { studyMs: 59_999 }), TODAY)).toBe(0)
    })

    it("counts a run begun before midnight toward that day, where it will be logged", () => {
        const late = runAt(CLASSIC, 0, { startedAt: new Date(2026, 8, 27, 23, 30).getTime(), studyMs: 45 * MIN })
        expect(todaySoFar(logged, late, TODAY)).toBe(40)
        expect(todaySoFar(logged, late, "2026-09-27")).toBe(135)
    })
})

describe("the time as text", () => {
    it("rounds up to the second, as MM:SS", () => {
        expect(timeText(25 * MIN)).toBe("25:00")
        expect(timeText(200)).toBe("00:01")
        expect(timeText(61_001)).toBe("01:02")
        expect(timeText(0)).toBe("00:00")
        expect(timeText(-5000)).toBe("00:00")
        expect(timeText(180 * MIN)).toBe("99:00")
    })

    it("titles the tab with the time and phase, or the app's name", () => {
        expect(tickTitle(runAt(CLASSIC, 60_500))).toBe("24:00 · Study")
        expect(tickTitle(runAt(CLASSIC, 26 * MIN))).toBe("04:00 · Break")
        expect(tickTitle(null)).toBe("Term")
    })
})

describe("what a run is logged against", () => {
    const items = [
        { id: "i1", courseId: "anat", status: "todo" },
        { id: "i2", courseId: "anat", status: "done" },
        { id: "i3", courseId: "phys", status: "todo" },
    ] as Item[]

    it("keeps a live course and an open item of it", () => {
        expect(pickFor([anat], items, { courseId: "anat", itemId: "i1" })).toEqual({ courseId: "anat", itemId: "i1" })
    })

    it("falls back to the first live course, and drops an item that is closed or of another course", () => {
        expect(pickFor([old, anat], items, { courseId: "old", itemId: null })).toEqual({ courseId: "anat", itemId: null })
        expect(pickFor([anat], items, { courseId: "anat", itemId: "i2" }).itemId).toBeNull()
        expect(pickFor([anat], items, { courseId: "anat", itemId: "i3" }).itemId).toBeNull()
        expect(pickFor([old], items, { courseId: "old", itemId: null })).toEqual({ courseId: null, itemId: null })
    })
})

describe("editing the flow", () => {
    const flow = () => fake.data.profile!.studyFlow as Flow
    const set = (f: Flow) => { fake.data.profile = { id: "me", studyFlow: structuredClone(f) } }
    beforeEach(() => { set(CLASSIC); fake.profileSaves = []; redraw.mockClear() })

    it("switches a step between Study and Break, and saves it", async () => {
        expect(await setStepKind(1)).toBe(true)
        expect(flow().steps).toEqual([["study", 25], ["study", 5]])
        expect(redraw).toHaveBeenCalled()
        expect(await setStepKind(0)).toBe(true)
        expect(flow().steps).toEqual([["break", 25], ["study", 5]])
    })

    it("never switches away the only Study step", async () => {
        expect(await setStepKind(0)).toBe(false)
        set({ steps: [["study", 25]], rounds: 1 })
        expect(await setStepKind(0)).toBe(false)
        expect(await setStepKind(5)).toBe(false)
        expect(fake.profileSaves).toEqual([])
    })

    it("keeps a step's minutes within 1 to 180, whole", async () => {
        expect(await setStepMinutes(0, 0)).toBe(true)
        expect(flow().steps[0]).toEqual(["study", 1])
        expect(await setStepMinutes(0, 500)).toBe(true)
        expect(flow().steps[0]).toEqual(["study", 180])
        expect(await setStepMinutes(1, 12.6)).toBe(true)
        expect(flow().steps[1]).toEqual(["break", 13])
        expect(await setStepMinutes(1, NaN)).toBe(false)
        expect(await setStepMinutes(1, 13)).toBe(false)
        expect(await setStepMinutes(4, 10)).toBe(false)
        expect(fake.profileSaves).toHaveLength(3)
    })

    it("adds up to twelve steps: 25 minutes of study or a 5-minute break", async () => {
        expect(await addStep("study")).toBe(true)
        expect(await addStep("break")).toBe(true)
        expect(flow().steps.slice(2)).toEqual([["study", 25], ["break", 5]])
        set(TWELVE)
        expect(await addStep("study")).toBe(false)
        expect(flow().steps).toHaveLength(12)
    })

    it("removes a step, but never the last one or the only Study step", async () => {
        expect(await delStep(0)).toBe(false)
        expect(await delStep(1)).toBe(true)
        expect(flow().steps).toEqual([["study", 25]])
        expect(await delStep(0)).toBe(false)
        set({ steps: [["study", 25], ["break", 5], ["study", 40]], rounds: 2 })
        expect(await delStep(0)).toBe(true)
        expect(flow().steps).toEqual([["break", 5], ["study", 40]])
        expect(await delStep(9)).toBe(false)
    })

    it("says a flow that could not be saved was not", async () => {
        fake.failSaves = true
        try {
            await expect(setRounds(3)).resolves.toBe(false)
        } finally { fake.failSaves = false }
    })

    it("repeats 1 to 12 rounds", async () => {
        expect(await setRounds(0)).toBe(true)
        expect(flow().rounds).toBe(1)
        expect(await setRounds(40)).toBe(true)
        expect(flow().rounds).toBe(12)
        expect(await setRounds(12)).toBe(false)
        expect(await setRounds(NaN)).toBe(false)
    })

    it("applies a Quick start preset, and ignores one that does not exist", async () => {
        expect(await applyPreset(1)).toBe(true)
        expect(flow()).toEqual({ steps: [["study", 50], ["break", 10]], rounds: 3 })
        expect(await applyPreset(9)).toBe(false)
    })

    it("reads a damaged saved flow as the default", () => {
        fake.data.profile = { id: "me", studyFlow: { steps: [["break", 5]], rounds: 2 } }
        const { result } = renderHook(() => useFlow())
        expect(result.current).toEqual(CLASSIC)
    })
})

describe("a run", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(T0)
        fake.meta.clear()
        fake.sessions = []
        fake.data.courses = [anat]
        fake.data.items = []
        fake.data.profile = { id: "me", studyFlow: structuredClone(CLASSIC) }
        ui.study = { courseId: "anat", itemId: null }
    })
    afterEach(async () => {
        focus.reset()
        act(() => notify())
        vi.useRealTimers()
    })

    const begin = async (flow: Flow) => {
        fake.data.profile = { id: "me", studyFlow: structuredClone(flow) }
        let ok = false
        await act(async () => { ok = await startRun() })
        return ok
    }
    const tickFor = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    /* hours at once: the clock moves on, then one tick reads it (as after a throttled tab) */
    const jump = async (ms: number) => { vi.setSystemTime(Date.now() + ms - 250); await tickFor(250) }

    it("is none until one starts", () => {
        const { result } = renderHook(() => useRun())
        expect(result.current).toBeNull()
    })

    it("needs a live course to start, and starts once", async () => {
        fake.data.courses = [old]
        ui.study = { courseId: "old", itemId: null }
        expect(await begin(CLASSIC)).toBe(false)
        expect(focus.active()).toBe(false)
        fake.data.courses = [anat]
        expect(await begin(CLASSIC)).toBe(true)
        expect(ui.study.courseId).toBe("anat")
        expect(await begin(CLASSIC)).toBe(false)
    })

    it("starts on the saved flow and redraws as it ticks, keeping one snapshot within a second", async () => {
        const { result } = renderHook(() => useRun(), { wrapper: StrictMode })
        await begin(CLASSIC)
        expect(result.current).toMatchObject({ round: 1, index: 0, kind: "study", leftMs: 25 * MIN, paused: false, courseId: "anat", startedAt: T0 })
        const first = result.current
        await tickFor(250)
        expect(result.current).toBe(first)
        await tickFor(1000)
        expect(result.current).not.toBe(first)
        expect(timeText(result.current!.leftMs)).toBe("24:59")
    })

    it("pauses across a step's end, then goes on into the break", async () => {
        const { result } = renderHook(() => useRun())
        await begin({ steps: [["study", 1], ["break", 1]], rounds: 1 })
        await tickFor(50_000)
        await act(() => togglePause())
        expect(result.current).toMatchObject({ paused: true, kind: "study", leftMs: 10_000 })
        const end = doneAt(result.current!, Date.now())
        await tickFor(5 * MIN)
        expect(result.current).toMatchObject({ paused: true, kind: "study", leftMs: 10_000, studyMs: 50_000 })
        expect(doneAt(result.current!, Date.now())).toBe(end + 5 * MIN)
        await act(() => togglePause())
        await tickFor(11_000)
        expect(result.current).toMatchObject({ paused: false, kind: "break", index: 1, studyMs: 60_000 })
        expect(nextLine(result.current!)).toEqual({ last: true })
    })

    it("skips to the next step without counting the study skipped", async () => {
        const { result } = renderHook(() => useRun())
        await begin(CLASSIC)
        await tickFor(3 * MIN)
        await act(() => skip())
        expect(result.current).toMatchObject({ kind: "break", index: 1, leftMs: 5 * MIN, studyMs: 3 * MIN })
    })

    it("asks for full screen inside the Start click, before any wait, and not without a course", async () => {
        const fullscreen = vi.fn(() => Promise.resolve())
        document.documentElement.requestFullscreen = fullscreen
        fake.data.courses = []
        await act(async () => { await startRun() })
        expect(fullscreen).not.toHaveBeenCalled()
        fake.data.courses = [anat]
        let started: Promise<boolean> = Promise.resolve(false)
        act(() => { started = startRun() })
        expect(fullscreen).toHaveBeenCalledOnce()      /* before startRun's first await settles */
        await act(async () => { await started })
        expect(focus.active()).toBe(true)
    })

    it("keeps a run it could not log, paused where it stopped, for the next load", async () => {
        const { result } = renderHook(() => useRun())
        await begin(CLASSIC)
        await tickFor(3 * MIN)
        fake.failSaves = true
        try { await act(() => stopRun()) } finally { fake.failSaves = false }
        expect(result.current).toBeNull()
        expect(fake.sessions).toEqual([])
        expect(fake.meta.get("studyRun")).toMatchObject({ pausedAt: T0 + 3 * MIN })
        await tickFor(10 * MIN)                        /* time away adds nothing */
        await act(() => focus.load())
        expect(result.current).toMatchObject({ paused: true, studyMs: 3 * MIN })
        await act(() => stopRun())
        expect(fake.sessions).toEqual([expect.objectContaining({ studyMinutes: 3 })])
        expect(fake.meta.get("studyRun")).toBeNull()
    })

    it("logs the whole minutes studied on Stop & log, and is none after", async () => {
        const { result } = renderHook(() => useRun())
        await begin(CLASSIC)
        await tickFor(3 * MIN + 30_000)
        await act(() => stopRun())
        expect(result.current).toBeNull()
        expect(fake.sessions).toEqual([expect.objectContaining({ courseId: "anat", startedAt: T0, studyMinutes: 3, roundsDone: 0 })])
        expect(fake.meta.get("studyRun")).toBeNull()
    })

    it("ends and logs a run that finished while the tab was hidden, when it is seen again", async () => {
        const { result } = renderHook(() => useRun())
        await begin({ steps: [["study", 25], ["break", 5]], rounds: 1 })
        /* hidden: the page's timers never ran */
        vi.setSystemTime(T0 + 3 * 60 * MIN)
        document.dispatchEvent(new Event("visibilitychange"))
        await settle()
        expect(result.current).toBeNull()
        expect(fake.sessions).toEqual([expect.objectContaining({ studyMinutes: 25, roundsDone: 1 })])
    })

    it("runs the last step of a one-step flow to its end", async () => {
        const { result } = renderHook(() => useRun())
        await begin({ steps: [["study", 1]], rounds: 1 })
        expect(nextLine(result.current!)).toEqual({ last: true })
        await tickFor(59_000)
        expect(result.current).toMatchObject({ leftMs: 1000, done: false })
        await tickFor(1500)
        await settle()
        expect(result.current).toBeNull()
        expect(fake.sessions).toEqual([expect.objectContaining({ studyMinutes: 1, roundsDone: 1 })])
    })

    it("runs twelve rounds of twelve steps", async () => {
        const { result } = renderHook(() => useRun())
        await begin(TWELVE)
        await jump(735 * MIN)
        expect(result.current).toMatchObject({ round: 7, index: 1, kind: "break", roundsDone: 6, studyMs: 370 * MIN })
        await jump(705 * MIN)
        await settle()
        expect(result.current).toBeNull()
        expect(fake.sessions).toEqual([expect.objectContaining({ studyMinutes: 720, roundsDone: 12 })])
    })

    it("resumes a run kept on this device after a reload", async () => {
        fake.meta.set("studyRun", {
            flow: CLASSIC, startedAt: T0 - 30 * MIN - 2 * MIN, pausedAt: null, pausedMs: 2 * MIN, skippedMs: 0, skippedStudyMs: 0,
            id: "r1", courseId: "anat", itemId: null,
        })
        const { result } = renderHook(() => useRun())
        await act(() => focus.load())
        expect(result.current).toMatchObject({ round: 2, index: 0, kind: "study", leftMs: 25 * MIN, studyMs: 25 * MIN, paused: false })
        await tickFor(MIN)
        expect(result.current!.leftMs).toBe(24 * MIN)
    })

    it("logs a kept run that ended while the app was closed", async () => {
        fake.meta.set("studyRun", {
            flow: CLASSIC, startedAt: T0 - 5 * 60 * MIN, pausedAt: null, pausedMs: 0, skippedMs: 0, skippedStudyMs: 0,
            id: "r2", courseId: "anat", itemId: null,
        })
        const { result } = renderHook(() => useRun())
        await act(() => focus.load())
        await settle()
        expect(result.current).toBeNull()
        expect(fake.sessions).toEqual([expect.objectContaining({ id: "r2", studyMinutes: 100, roundsDone: 4 })])
    })

    it("titles the tab and badges the Study icon with the time left, and clears both at the end", async () => {
        await begin({ steps: [["study", 1], ["break", 1]], rounds: 1 })
        expect(document.title).toBe("01:00 · Study")
        expect(getStudyBadge()).toBe("01:00")
        await tickFor(61_000)
        expect(document.title).toBe("00:59 · Break")
        expect(getStudyBadge()).toBe("00:59")
        await act(() => stopRun())
        expect(document.title).toBe("Term")
        expect(getStudyBadge()).toBeNull()
    })

    it("opens the focus screen on Start, and goes to the Study page when it ends", async () => {
        ui.view = "week"
        ui.focus = false
        await begin(CLASSIC)
        expect(ui.focus).toBe(true)
        expect(redraw).toHaveBeenCalled()
        await act(() => stopRun())
        expect(ui).toMatchObject({ focus: false, view: "study" })
    })

    it("is gone after sign-out forgets it", async () => {
        const { result } = renderHook(() => useRun())
        await begin(CLASSIC)
        expect(result.current).not.toBeNull()
        focus.reset()
        act(() => notify())
        expect(result.current).toBeNull()
    })
})

describe("the focus screen", () => {
    const fullscreen = vi.fn(() => Promise.resolve())
    beforeEach(() => {
        document.documentElement.requestFullscreen = fullscreen
        fullscreen.mockClear()
        Object.assign(ui, { focus: false, focusMusic: false, view: "week" })
    })

    it("opens in full screen, and leaving it keeps the view, but not the Study view", () => {
        openFocus()
        expect(ui.focus).toBe(true)
        expect(fullscreen).toHaveBeenCalledOnce()
        leaveFocus()
        expect(ui).toMatchObject({ focus: false, view: "week" })
        ui.view = "study"
        openFocus()
        leaveFocus()
        expect(ui).toMatchObject({ focus: false, view: "week" })
    })

    it("shuts the music panel on Esc before it is left", () => {
        openFocus()
        toggleMusic(true)
        escapeFocus()
        expect(ui).toMatchObject({ focus: true, focusMusic: false })
        escapeFocus()
        expect(ui.focus).toBe(false)
    })

    it("tells the time the run is done as the clock does", () => {
        expect(clockTime(new Date(2026, 8, 28, 15, 40, 59).getTime())).toBe("15:40")
        expect(clockTime(new Date(2026, 8, 29, 7, 5).getTime())).toBe("07:05")
    })
})

describe("the music panel", () => {
    it("opens and shuts, and tells React", () => {
        ui.focusMusic = false
        const heard = vi.fn()
        const off = subscribe(heard)
        toggleMusic()
        expect(ui.focusMusic).toBe(true)
        toggleMusic(true)
        expect(heard).toHaveBeenCalledTimes(1)
        toggleMusic()
        expect(ui.focusMusic).toBe(false)
        off()
    })
})
