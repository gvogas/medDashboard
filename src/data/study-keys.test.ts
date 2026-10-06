import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u1", isAdmin: true }, spaces: [{ id: "abcdefghij12", scope: "c:abcdefghij12" }], shared_courses: [{ scope: "c:abcdefghij12", id: "web" }],
        courses: [] as unknown[], items: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    saveStudySession: vi.fn(async () => {}), saveAchievement: vi.fn(async () => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, saveStudySession: fake.saveStudySession, saveAchievement: fake.saveAchievement, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi({ study: { courseId: null, itemId: null } }))
vi.mock("@/data/overlay", () => ({ closeSheet: vi.fn() }))

import { firstReviews, nextReview } from "@/core/reviews"
import { saveSession, sessionDraft } from "./session-edit"
import { achievementDraft, saveAchievementDraft } from "./achievement-edit"
import { todayOf } from "./study"
import { keyedCourses, keyedItems, keyedSessions } from "./refs"
import type { Course, Item } from "./types"

const SID = "abcdefghij12", WEB = "c:" + SID
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12)) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { vi.clearAllMocks() })

describe("lecture reviews of a class's lectures", () => {
    it("are yours, filed under the class, and the next step stays there", () => {
        const web = { id: "web", code: "WEB", archived: false, term: "", spaceId: SID, meetings: [{ id: "m1", kind: "Lecture", weekday: 1, start: "09:00", end: "10:00", room: "" }] }
        const [first] = firstReviews([web], [], "2026-10-05", "2026-10-05")
        expect(first).toMatchObject({ courseId: null, classId: SID, title: "Review 1/4 · WEB Lecture Mon 5 Oct" })
        expect(nextReview(first, "2026-10-07")).toMatchObject({ courseId: null, classId: SID })
        const [own] = firstReviews([{ ...web, spaceId: undefined, id: "bio", code: "BIO" }], [], "2026-10-05", "2026-10-05")
        expect(own).toMatchObject({ courseId: "bio", classId: null })
    })
})

describe("a study session on a class", () => {
    it("is edited in keys and saved as the class's ids with its space", async () => {
        const d = sessionDraft({ id: "s1", courseId: "web", itemId: "a1", spaceId: SID, startedAt: new Date(2026, 9, 5, 10).getTime(), studyMinutes: 30, roundsDone: 0, note: "", manual: true })
        expect([d.courseId, d.itemId]).toEqual([WEB + "/web", WEB + "/a1"])
        await saveSession({ ...d, minutes: 45 })
        expect(fake.saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", courseId: "web", itemId: "a1", spaceId: SID, studyMinutes: 45 }))
    })

    it("shows on Today with the class's course and item", () => {
        const sessions = keyedSessions([{ id: "s1", courseId: "web", itemId: "a1", spaceId: SID, startedAt: new Date(2026, 9, 6, 10).getTime(), studyMinutes: 30, roundsDone: 0, note: "", manual: false }])
        const items = keyedItems([{ id: "a1", key: WEB + "/a1", courseKey: WEB + "/web", title: "REST API Project", courseId: "web" }] as unknown as Item[])
        const courses = keyedCourses([{ id: "web", key: WEB + "/web", name: "Web Services", color: "#17B3AE" }] as unknown as Course[])
        expect(todayOf(sessions, items, courses, 0, "2026-10-06").rows[0]).toMatchObject({ what: "REST API Project", color: "#17B3AE" })
    })
})

describe("an achievement on a class", () => {
    it("is edited in keys and saved with its space", async () => {
        const d = achievementDraft({ id: "h1", name: "Web hours", sticker: "data:image/png;base64,AA==", rule: "hours", courseId: "web", itemId: null, spaceId: SID, target: 10 })
        expect(d.courseId).toBe(WEB + "/web")
        await saveAchievementDraft(d)
        expect(fake.saveAchievement).toHaveBeenCalledWith(expect.objectContaining({ courseId: "web", itemId: null, spaceId: SID }))
    })
})
