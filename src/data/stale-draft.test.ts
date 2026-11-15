// A sheet open while a sync moves its row on (another device's edit, or this device's last
// upload settling): Save writes only what the draft changed, onto the row as stored now, at
// its revision. Same rule as the course sheet (audit F1, F2).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u1" }, spaces: [] as unknown[], shared_courses: [] as unknown[],
        courses: [] as unknown[], items: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
        study_sessions: [] as unknown[], achievements: [] as unknown[],
    },
    saveStudySession: vi.fn(async () => {}), saveAchievement: vi.fn(async () => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, saveStudySession: fake.saveStudySession, saveAchievement: fake.saveAchievement, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi({ study: { courseId: null, itemId: null } }))
vi.mock("@/data/overlay", () => ({ closeSheet: vi.fn() }))

import { saveSession, sessionDraft } from "./session-edit"
import { achievementDraft, saveAchievementDraft } from "./achievement-edit"
import type { Achievement, StudySession } from "./types"

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12)) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { vi.clearAllMocks(); fake.data.study_sessions = []; fake.data.achievements = [] })

describe("a study session's sheet", () => {
    const opened: StudySession = { id: "s1", courseId: "bio", itemId: null, startedAt: new Date(2026, 9, 5, 10).getTime(), studyMinutes: 30, roundsDone: 2, note: "", manual: true, revision: 1 } as StudySession

    it("keeps another device's newer note and saves at the stored revision", async () => {
        const d = sessionDraft(opened)
        fake.data.study_sessions = [{ ...opened, note: "from my phone", revision: 2 }]
        await saveSession({ ...d, minutes: 45 })
        expect(fake.saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", studyMinutes: 45, note: "from my phone", revision: 2 }))
    })

    it("still saves the draft's own change to a field the other device also changed", async () => {
        const d = sessionDraft(opened)
        fake.data.study_sessions = [{ ...opened, note: "from my phone", revision: 2 }]
        await saveSession({ ...d, note: "mine" })
        expect(fake.saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ note: "mine", studyMinutes: 30, revision: 2 }))
    })

    it("saves the draft as it is when the row is gone from the store", async () => {
        const d = sessionDraft(opened)
        await saveSession({ ...d, minutes: 50 })
        expect(fake.saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", studyMinutes: 50, roundsDone: 2, revision: 1 }))
    })
})

describe("an achievement's sheet", () => {
    const opened = { id: "h1", name: "Bio hours", sticker: "data:image/png;base64,AA==", rule: "hours", courseId: "bio", itemId: null, target: 10, revision: 3 } as unknown as Achievement

    it("keeps another device's new name and saves at the stored revision", async () => {
        const d = achievementDraft(opened)
        fake.data.achievements = [{ ...opened, name: "Biology hours", revision: 4 }]
        await saveAchievementDraft({ ...d, target: 20 })
        expect(fake.saveAchievement).toHaveBeenCalledWith(expect.objectContaining({ name: "Biology hours", target: 20, revision: 4 }))
    })
})
