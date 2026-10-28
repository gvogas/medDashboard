import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionUndo, StudySession } from "./types"
import { stubMatchMedia } from "@/components/test-media"

/* A fake ui; the run, the timer and the fireworks are fakes. */
const fake = vi.hoisted(() => ({ ui: { view: "week", studyTab: "timer", hist: { undo: null as SessionUndo | null } } }))
vi.mock("@/core/store", () => {
    const data = { items: [], courses: [], study_sessions: [] as { id: string }[], achievements: [], profile: null }
    return { data, deleteStudySession: vi.fn(async (id: string) => { data.study_sessions = data.study_sessions.filter((s) => s.id !== id) }), subscribe: () => () => {} }
})
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/run", () => ({ active: () => false, onTick: vi.fn() }))
vi.mock("@/data/query", () => ({ termStart: () => null, schoolCal: () => null }))
vi.mock("@/data/study-timer", () => ({ openFocus: vi.fn() }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))

import { data, deleteStudySession } from "@/core/store"
import { shownSessions, undoSessionDelete } from "./study"
import { deleteWithUndo, showAchievement } from "./study-controller"
import { TOAST_MS } from "./toast"

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.innerHTML = ""
    Object.assign(fake.ui, { view: "week", studyTab: "timer" })
    fake.ui.hist.undo = null
    data.study_sessions = []
    vi.mocked(deleteStudySession).mockClear()
})

describe("an achievement toast's See", () => {
    it("opens the Study page on its Achievements tab, and brings the medal into view with a pop", () => {
        stubMatchMedia({ reducedMotion: true })
        vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0 })
        const medal = document.createElement("li")
        medal.id = "ach-hours-1"
        medal.scrollIntoView = vi.fn()
        document.body.append(medal)
        showAchievement("hours-1")
        expect(fake.ui).toMatchObject({ view: "study", studyTab: "achievements" })
        expect(medal.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" })
        expect(medal.classList.contains("pop")).toBe(true)
    })

    it("opens the Achievements tab from another Study tab too", () => {
        stubMatchMedia({ reducedMotion: false })
        vi.stubGlobal("requestAnimationFrame", () => 0)
        Object.assign(fake.ui, { view: "study", studyTab: "history" })
        showAchievement("days-first")
        expect(fake.ui.studyTab).toBe("achievements")
    })
})

describe("deleting two study sessions in a row", () => {
    it("keeps the first until its own Undo window ends, and Undo takes back the second", () => {
        vi.useFakeTimers()
        const a = { id: "a", studyMinutes: 30 } as StudySession, b = { id: "b", studyMinutes: 20 } as StudySession
        data.study_sessions.push(a, b)
        deleteWithUndo("a")
        vi.advanceTimersByTime(2000)
        deleteWithUndo("b")
        expect(deleteStudySession).not.toHaveBeenCalled()
        expect(shownSessions(data.study_sessions as StudySession[], fake.ui.hist.undo)).toEqual([])
        vi.advanceTimersByTime(TOAST_MS - 2000 - 1)   /* A's window: just short of its end */
        expect(deleteStudySession).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)                     /* A's window ends: A is final, once */
        expect(deleteStudySession).toHaveBeenCalledTimes(1)
        expect(deleteStudySession).toHaveBeenCalledWith("a")
        expect(fake.ui.hist.undo?.session).toBe(b)    /* B still waits, with its Undo */
        expect(shownSessions(data.study_sessions as StudySession[], fake.ui.hist.undo)).toEqual([])
        undoSessionDelete()                           /* Undo takes back B */
        expect(shownSessions(data.study_sessions as StudySession[], fake.ui.hist.undo)).toEqual([b])
        vi.advanceTimersByTime(60_000)
        expect(deleteStudySession).toHaveBeenCalledTimes(1)
        expect(data.study_sessions).toEqual([b])
    })
})
