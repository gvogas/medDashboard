import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// The class item card with the store, the overlay and the toast as fakes; the effective
// lists, the marks rules and the item rules are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown>,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    store: { saveMark: vi.fn(async () => {}), saveShared: vi.fn(async () => {}), removeShared: vi.fn(async () => {}) },
    overlay: { closeSheet: vi.fn(), openSheet: vi.fn(), replaceSheet: vi.fn(), beforeSheetClose: new Set<() => void>() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store, subscribe: () => () => {} }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ toast: fake.toast }))

import { ClassItemSheet } from "./class-item-sheet"

const SID = "sp0000000001", WEB = "c:" + SID, KEY = WEB + "/a1", HOUR = 3_600_000
const space = (role: string) => ({
    id: SID, scope: WEB, kind: "class", role, archived: false, name: "Web Services", parent: null, revision: 3,
    members: [{ userId: "u-me", name: "George", role }, { userId: "u-gab", name: "Gabriel", role: "owner" }],
})
const course = { scope: WEB, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "", term: "", archived: false, target: null, meetings: [] }
const row = () => ({
    scope: WEB, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15", start: "", end: "", where: "Lab 2",
    status: "todo", grade: null, weight: 20, notes: "Teams of 3", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "",
    completedAt: null, updatedBy: "u-gab", updatedAt: Date.now() - 2 * HOUR, assignees: [], completedBy: null, revision: 4,
})
const graded = { id: SID + ":a1", spaceId: SID, itemId: "a1", status: "graded", grade: 87, weight: 25, notes: "", checklist: [], completedAt: 1, hidden: false }

beforeEach(() => {
    Object.assign(fake.data, { spaces: [space("member")], shared_courses: [course], shared_items: [row()], marks: [], space_prefs: [], study_sessions: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("a class item, for a member", () => {
    it("shows the class's facts locked, with who changed them, and keeps your status in your mark", async () => {
        render(<ClassItemSheet itemKey={KEY} />)
        expect(screen.getByRole("heading", { name: "REST API Project" })).toBeTruthy()
        expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull()
        expect(screen.getByText("Edited by Gabriel · 2h ago")).toBeTruthy()
        expect(screen.getByText("Teams of 3")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Graded" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ id: SID + ":a1", status: "graded" })))
    })

    it("takes your own weight, and offers the class's back", async () => {
        fake.data.marks = [graded]
        render(<ClassItemSheet itemKey={KEY} />)
        expect(screen.getByText("The class weight is 20%.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Use class weight" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ weight: null })))
    })

    it("asks before hiding a graded item, then hides it", async () => {
        fake.data.marks = [graded]
        render(<ClassItemSheet itemKey={KEY} />)
        fireEvent.click(screen.getByRole("button", { name: "Not mine · hide it" }))
        expect(screen.getByText(/Your grade of 87% stops counting in Web Services/)).toBeTruthy()
        expect(fake.store.saveMark).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Hide it" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ hidden: true })))
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
    })
})

describe("a class item, for an editor", () => {
    beforeEach(() => { fake.data.spaces = [space("editor")] })

    it("changes the class's facts for everyone", async () => {
        render(<ClassItemSheet itemKey={KEY} />)
        expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy()
        fireEvent.change(screen.getByRole("spinbutton", { name: "Weight" }), { target: { value: "25" } })
        await waitFor(() => expect(fake.store.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({ scope: WEB, id: "a1", weight: 25 })))
    })

    it("deletes it for everyone, after asking", async () => {
        render(<ClassItemSheet itemKey={KEY} />)
        fireEvent.click(screen.getByRole("button", { name: "Delete for everyone" }))
        fireEvent.click(screen.getByRole("button", { name: "Delete it" }))
        await waitFor(() => expect(fake.store.removeShared).toHaveBeenCalledWith("shared_items", WEB, "a1"))
    })
})
