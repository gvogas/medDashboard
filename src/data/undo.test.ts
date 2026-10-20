// Undo after a delete that had none: a quote, a type of your own, the school calendar.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u1", types: [] as unknown[], schoolCalendar: null as unknown },
        items: [] as unknown[], courses: [] as unknown[], quotes: [] as { id: string; text: string }[],
        study_sessions: [], achievements: [], marks: [], space_prefs: [], shared_courses: [], shared_items: [], removed_items: [], spaces: [],
    },
    hidden: new Set<string>(),
    cal: null as unknown,
    ui: { view: "week", bg: "cs", course: "all", search: "", quoteIx: 0, hist: { undo: null }, schoolNote: null as unknown },
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    subscribe: () => () => {},
    saveProfile: vi.fn(async (patch: Record<string, unknown>) => {
        Object.assign(fake.data.profile, patch)
        if ("schoolCalendar" in patch) fake.cal = patch.schoolCalendar && Object.keys(patch.schoolCalendar as object).length ? patch.schoolCalendar : null
    }),
    hide: vi.fn(async (key: string, on = true) => { if (on) fake.hidden.add(key); else fake.hidden.delete(key) }),
    deleteQuote: vi.fn(async (id: string) => { fake.data.quotes = fake.data.quotes.filter((q) => q.id !== id) }),
    deleteStudySession: vi.fn(async () => {}),
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, typeOn: () => true, termStart: () => null }))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {}, syncNow: vi.fn() }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))
vi.mock("@/core/api", () => ({ api: {}, spotifyRetryAt: () => 0 }))

import * as store from "@/core/store"
import { useTypePrefs } from "@/core/model"
import { addType, deleteType, itemTypes, removeQuote } from "./actions"
import { removeSchool } from "./school-edit"
import { finishDelete } from "./study-controller"
import { runToastAction, hideToast } from "./toast"

beforeEach(() => {
    useTypePrefs(() => fake.data.profile.types as never)
    fake.data.profile.types = []
    fake.data.quotes = [{ id: "q1", text: "Treat the patient." }, { id: "q2", text: "Listen." }]
    fake.cal = null
    fake.hidden.clear()
})
afterEach(() => { hideToast(); vi.clearAllMocks() })

describe("undo", () => {
    it("brings a quote back: it is only hidden until the toast goes", async () => {
        await removeQuote("q1")
        expect(store.hide).toHaveBeenCalledWith("quotes:q1")
        expect(store.deleteQuote).not.toHaveBeenCalled()
        runToastAction()
        await vi.waitFor(() => expect(fake.hidden.has("quotes:q1")).toBe(false))
        await finishDelete()
        expect(store.deleteQuote).not.toHaveBeenCalled()

        await removeQuote("q2")
        await finishDelete()
        expect(store.deleteQuote).toHaveBeenCalledWith("q2")
    })

    it("puts a deleted type of your own back where it was", async () => {
        await addType("Clinic", "#4F74D9", "event")
        const ids = itemTypes().map((t) => t.id), own = ids.find((id) => !["exam", "quiz", "assignment", "lab", "tutoring", "office", "task", "project"].includes(id))!
        await deleteType(own)
        expect(itemTypes().map((t) => t.id)).not.toContain(own)
        runToastAction()
        await vi.waitFor(() => expect(itemTypes().map((t) => t.id)).toEqual(ids))
    })

    it("restores the school calendar, unless another was saved meanwhile", async () => {
        const cal = { name: "Fall", terms: [{ name: "Fall", start: "2026-09-01", end: "2026-12-18" }], days: [] }
        fake.cal = cal
        await removeSchool()
        expect(fake.cal).toBe(null)
        runToastAction()
        await vi.waitFor(() => expect(fake.cal).toEqual(cal))

        await removeSchool()
        fake.cal = { name: "Other", terms: [], days: [] }
        runToastAction()
        await Promise.resolve()
        expect((fake.cal as { name: string }).name).toBe("Other")
    })
})
