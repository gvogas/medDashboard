import { afterEach, describe, expect, it, vi } from "vitest"
import { stubMatchMedia } from "@/components/test-media"

/* A fake ui; the run, the timer and the fireworks are fakes. */
const fake = vi.hoisted(() => ({ ui: { view: "week", studyTab: "timer", hist: { undo: null } } }))
vi.mock("@/core/store", () => ({ data: { items: [], courses: [], study_sessions: [], achievements: [], profile: null }, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/run", () => ({ active: () => false }))
vi.mock("@/data/study-timer", () => ({ openFocus: vi.fn() }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))

import { showAchievement } from "./study-controller"

afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ""
    Object.assign(fake.ui, { view: "week", studyTab: "timer" })
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
