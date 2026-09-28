import { describe, expect, it, vi } from "vitest"

/* A store with a live course; the Study view (for its duration format) and the redraw are fakes. */
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [{ id: "anat", code: "ANAT", name: "Anatomy", archived: false }], study_sessions: [] as unknown[], achievements: [] as unknown[], profile: null },
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, saveStudySession: vi.fn(), saveAchievement: vi.fn() }))
vi.mock("@/legacy/js/views/render.js", () => ({ render: vi.fn() }))
vi.mock("@/legacy/js/state.js", () => ({ ui: { study: { courseId: null, itemId: null } } }))

import { impact, newSession, sessionDraft, startedAtOf, validSession, type SessionDraft } from "./session-edit"
import { footHint, newAchievement, standing, switchRule, validAchievement, type AchievementDraft } from "./achievement-edit"
import type { Course, Item, StudySession } from "./types"

const TODAY = "2026-09-23"
const prefs = { goal: 60, dayMin: 15, rest: [], celebrate: true }
const draft = (d: Partial<SessionDraft> = {}): SessionDraft => ({
    isNew: true, base: null, id: "new", date: TODAY, time: "09:00", minutes: 30, courseId: "anat", itemId: null, note: "", ...d,
})
const at = (day: string, minutes: number, id = day): StudySession => ({
    id, courseId: "anat", itemId: null, startedAt: new Date(day + "T10:00").getTime(), studyMinutes: minutes, roundsDone: 0, note: "", manual: true,
})

describe("a session logged by hand", () => {
    it("needs 1 to 720 whole minutes, a day up to today and a time", () => {
        expect(validSession(draft(), TODAY)).toBe(true)
        expect(validSession(draft({ minutes: 0 }), TODAY)).toBe(false)
        expect(validSession(draft({ minutes: 721 }), TODAY)).toBe(false)
        expect(validSession(draft({ minutes: 720 }), TODAY)).toBe(true)
        expect(validSession(draft({ minutes: 12.5 }), TODAY)).toBe(false)
        expect(validSession(draft({ date: "2026-09-24" }), TODAY)).toBe(false)
        expect(validSession(draft({ date: "" }), TODAY)).toBe(false)
        expect(validSession(draft({ time: "later" }), TODAY)).toBe(false)
    })

    it("starts at the typed day and time", () => {
        expect(startedAtOf({ date: "2026-09-20", time: "14:05" })).toBe(new Date(2026, 8, 20, 14, 5).getTime())
        expect(startedAtOf({ date: "2026-09-20", time: "830" })).toBe(new Date(2026, 8, 20, 8, 30).getTime())
    })

    it("starts new for the last half hour, and edits keep the stored day, time and length", () => {
        const now = new Date(2026, 8, 23, 12, 10)
        expect(newSession(null, now)).toMatchObject({ isNew: true, date: TODAY, time: "11:40", minutes: 30, courseId: "anat" })
        expect(newSession("path", now).courseId).toBe("path")
        const s = { ...at("2026-09-21", 50, "s1"), note: "Anki" }
        expect(sessionDraft(s)).toMatchObject({ isNew: false, id: "s1", date: "2026-09-21", time: "10:00", minutes: 50, note: "Anki", base: s })
    })

    it("says what it does to today's goal and the streak", () => {
        expect(impact(draft(), [], prefs, TODAY)).toBe("Today goes to 30m of 1h 00m. Your streak goes to 1 day.")
        expect(impact(draft({ date: "2026-09-24" }), [], prefs, TODAY)).toBe("Pick a day up to today.")
        expect(impact(draft({ minutes: 0 }), [], prefs, TODAY)).toBe("Enter a day, a start time and 1 to 720 minutes.")
    })

    it("names another day, and says a streak it does not change is safe", () => {
        const logged = [at("2026-09-22", 60), at(TODAY, 60)]
        expect(impact(draft({ date: "2026-09-10" }), logged, prefs, TODAY)).toBe("Thu 10 Sep goes to 30m. Your 2-day streak is safe.")
        /* the day before yesterday joins the run */
        expect(impact(draft({ date: "2026-09-21" }), logged, prefs, TODAY)).toBe("Mon 21 Sep goes to 30m. Your streak goes to 3 days.")
    })

    it("counts an edited session once, not on top of itself", () => {
        const s = at(TODAY, 30, "s1")
        expect(impact(draft({ id: "s1", minutes: 45 }), [s], prefs, TODAY)).toMatch(/^Today goes to 45m of 1h 00m\./)
    })
})

describe("an achievement of your own", () => {
    const courses = fake.data.courses as Course[]
    const ready = (d: Partial<AchievementDraft> = {}): AchievementDraft => ({ ...newAchievement(courses), name: "20 hours on Anatomy", sticker: "data:image/png;base64,x", ...d })

    it("starts on hours on the first live course", () => {
        expect(newAchievement(courses)).toMatchObject({ isNew: true, rule: "hours", courseId: "anat", target: 10, name: "", sticker: "" })
    })

    it("needs a name, a sticker, a target in range and what it is on, and no crop in progress", () => {
        expect(validAchievement(ready())).toBe(true)
        expect(validAchievement(ready(), true)).toBe(false)
        expect(validAchievement(ready({ name: "  " }))).toBe(false)
        expect(validAchievement(ready({ sticker: "" }))).toBe(false)
        expect(validAchievement(ready({ target: 1001 }))).toBe(false)
        expect(validAchievement(ready({ target: 0 }))).toBe(false)
        expect(validAchievement(ready({ courseId: null }))).toBe(false)
        expect(validAchievement(ready({ rule: "grade", target: 101, itemId: "e1" }))).toBe(false)
        expect(validAchievement(ready({ rule: "grade", target: 90, itemId: null }))).toBe(false)
        expect(validAchievement(ready({ rule: "grade", target: 90, itemId: "e1" }))).toBe(true)
    })

    it("says what is missing, first things first", () => {
        expect(footHint(ready(), true)).toBe("Finish the crop first")
        expect(footHint(ready({ sticker: "", name: "" }))).toBe("Upload a sticker")
        expect(footHint(ready({ name: "" }))).toBe("Give it a name")
        expect(footHint(ready())).toBe("Ready to add")
        expect(footHint(ready({ isNew: false }))).toBe("Unsaved changes")
        expect(footHint(ready({ target: 0 }))).toBe("Not ready yet")
    })

    it("starts the target over when what earns it changes, and hours get a course", () => {
        const grade = switchRule(ready({ courseId: null }), "grade", courses)
        expect(grade).toMatchObject({ rule: "grade", target: 90, courseId: null })
        expect(switchRule(grade, "hours", courses)).toMatchObject({ rule: "hours", target: 10, courseId: "anat" })
        const same = ready()
        expect(switchRule(same, "hours", courses)).toBe(same)
    })

    it("says where it stands", () => {
        const sessions = [at("2026-09-20", 90), at("2026-09-21", 60)]
        expect(standing(ready({ courseId: null }), sessions, [], courses)).toBe("Pick a course.")
        expect(standing(ready({ rule: "grade", itemId: null }), sessions, [], courses)).toBe("Pick an exam or quiz.")
        expect(standing(ready(), sessions, [], courses)).toBe("2.5 / 10 h so far.")
        expect(standing(ready({ target: 2 }), sessions, [], courses)).toBe("Already earned, on 21 Sep. It goes on straight away.")
        const exam = { id: "e1", type: "exam", title: "Midterm", status: "graded", grade: 93, date: "2026-09-18", completedAt: null } as unknown as Item
        expect(standing(ready({ rule: "grade", itemId: "e1", target: 90 }), [], [exam], courses)).toMatch(/^Already earned/)
        expect(standing(ready({ rule: "grade", itemId: "e1", target: 95 }), [], [exam], courses)).toBe("Got 93, need 95 so far.")
    })
})
