import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// The import preview with a target: the store, the API, sync, the overlay and the toast as
// fakes (as in classes.test.tsx), the real planners, and the commits as fakes.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    api: {
        spaces: { create: vi.fn(), get: vi.fn(), invite: vi.fn(), revokeInvite: vi.fn(), setRole: vi.fn(), transfer: vi.fn(), makeCode: vi.fn(), dropCode: vi.fn() },
        invites: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
        join: vi.fn(),
    },
    syncNow: vi.fn(async () => true),
    overlay: { openSheet: vi.fn(), replaceSheet: vi.fn(), closeSheet: vi.fn() },
    toast: vi.fn(),
}))
const fakeImport = vi.hoisted(() => ({
    commitToClass: vi.fn(async (..._: unknown[]) => "Added 1 item to Web Services."),
    commitNewClass: vi.fn(async (..._: unknown[]) => "Made Web Services with 2 items. Invite people from Members."),
    commitImport: vi.fn(async (..._: unknown[]) => "Imported 0 classes and 2 items."),
    readOutlineFile: vi.fn(async (..._: unknown[]) => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {} }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ toast: fake.toast }))
vi.mock("@/data/class-import", async (real) => ({ ...(await real<typeof import("@/data/class-import")>()), commitToClass: fakeImport.commitToClass, commitNewClass: fakeImport.commitNewClass }))
vi.mock("@/data/import-edit", async (real) => ({ ...(await real<typeof import("@/data/import-edit")>()), commitImport: fakeImport.commitImport, readOutlineFile: fakeImport.readOutlineFile }))

import { ApiError } from "@/core/api"
import { NotDownloaded, planForClass, planMine } from "@/data/class-import"
import type { Outline } from "@/core/importers/plan"
import { ImportSheet } from "./import-sheet"
import { NewClassSheet } from "./new-class-sheet"
import { ui } from "@/data/ui"

const SID = "sp0000000001", SCOPE = "c:" + SID
const space = (role = "owner") => ({
    id: SID, scope: SCOPE, kind: "class", role, name: "Web Services", archived: false, parent: null, revision: 9,
    members: [{ userId: "u-me", name: "George", role: "owner" }],
})
const course = { scope: SCOPE, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "Dr. Okafor", term: "Fall 2026", archived: false, target: null, meetings: [] }
const pref = { id: SID, spaceId: SID, color: "#17B3AE", target: null, term: "", archived: false, revision: 2 }
const quiz1 = { scope: SCOPE, id: "q1", type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-09-30", start: "", end: "", where: "", weight: 10 }
const CAL = { name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] }

beforeEach(() => {
    Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [], marks: [], space_prefs: [] })
    fake.syncNow.mockImplementation(async () => true)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const checkbox = (title: string) => screen.getByRole("checkbox", { name: "Import " + title }) as HTMLInputElement
const pick = (value: string) => fireEvent.change(screen.getByRole("combobox", { name: "Import into" }), { target: { value } })
const importButton = () => screen.getByRole("button", { name: /^Import \d+$/ })

describe("importing an outline", () => {
    const outline = { code: "WEB", name: "Web Services", classes: [], assessments: [{ type: "quiz", title: "Quiz 1", date: "2026-10-01", start: "", end: "", weight: 10 }, { type: "exam", title: "Midterm", date: "2026-10-30", start: "", end: "", weight: 30 }] } as Outline

    it("offers your classes as targets, and shows Already there and Changed against the one picked", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.data.shared_items = [quiz1]
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        pick("class:" + SID)
        expect(screen.getByText(/changed · was Wed 30 Sept?/)).toBeTruthy()
        expect(checkbox("Quiz 1").checked).toBe(false)
        expect(checkbox("Midterm").checked).toBe(true)
        fireEvent.click(importButton())
        await waitFor(() => expect(fakeImport.commitToClass).toHaveBeenCalledWith(expect.anything(), SID))
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
        expect(fake.toast).toHaveBeenCalledWith("Added 1 item to Web Services.", { error: false })
    })

    it("plans again from the outline when the target changes", () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.data.shared_items = [quiz1]
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        fireEvent.click(checkbox("Midterm"))
        pick("class:" + SID)
        expect(checkbox("Midterm").checked).toBe(true)
        pick("mine")
        expect(screen.queryByText(/changed/)).toBeNull()
        expect(checkbox("Quiz 1").checked).toBe(true)
        expect(checkbox("Midterm").checked).toBe(true)
    })

    it("against a class, week 1 leaves a row the class has unticked, and a new target keeps week 1", () => {
        const weeks = { ...outline, assessments: [{ type: "quiz", title: "Quiz 1", week: 4, start: "", end: "", weight: 10 }, { type: "exam", title: "Midterm", week: 8, start: "", end: "", weight: 30 }] } as Outline
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.data.shared_items = [{ ...quiz1, date: "2026-09-28" }]
        render(<ImportSheet plan={planMine(weeks)} name="web.pdf" />)
        pick("class:" + SID)
        fireEvent.change(screen.getByLabelText("Week 1 starts"), { target: { value: "2026-09-07" } })
        expect(checkbox("Quiz 1").checked).toBe(false)
        expect(screen.getByText("already there")).toBeTruthy()
        expect(checkbox("Midterm").checked).toBe(true)
        pick("mine")
        expect((screen.getByLabelText("Week 1 starts") as HTMLInputElement).value).toBe("2026-09-07")
        expect(checkbox("Quiz 1").checked).toBe(true)
        expect(screen.queryByText("already there")).toBeNull()
    })

    it("shows the semester picker for your courses only", () => {
        fake.data.profile = { id: "u-me", isAdmin: true, schoolCalendar: CAL }
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        expect(screen.getByRole("group", { name: /Semester for/ })).toBeTruthy()
        pick("class:" + SID)
        expect(screen.queryByRole("group", { name: /Semester for/ })).toBeNull()
    })

    it("a member sees no target picker", () => {
        fake.data.spaces = [space("member")]
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        expect(screen.queryByRole("combobox", { name: "Import into" })).toBeNull()
    })

    it("offers no class while classes are switched off, unless you are an admin", () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        expect(screen.queryByRole("combobox", { name: "Import into" })).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        pick("class:" + SID)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
    })

    it("a new class from an outline imports through commitNewClass", async () => {
        render(<ImportSheet plan={planForClass(outline, null, [])} name="web.pdf" target={{ kind: "new-class" }} />)
        expect(screen.getByText(/A new shared class/)).toBeTruthy()
        expect(screen.queryByRole("combobox", { name: "Import into" })).toBeNull()
        fireEvent.click(importButton())
        await waitFor(() => expect(fakeImport.commitNewClass).toHaveBeenCalled())
        expect(fake.overlay.closeSheet).not.toHaveBeenCalled()
        expect(fake.toast).toHaveBeenCalledWith("Made Web Services with 2 items. Invite people from Members.", { error: false })
    })

    it("a new class gets the maintenance page while classes are switched off", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<ImportSheet plan={planForClass(outline, null, [])} name="web.pdf" target={{ kind: "new-class" }} />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByRole("button", { name: /^Import \d+$/ })).toBeNull()
    })

    it("keeps the preview when the new class hasn't downloaded, and imports into it once it has", async () => {
        fakeImport.commitNewClass.mockRejectedValueOnce(new NotDownloaded({ id: SID, name: "Web Services" }))
        render(<ImportSheet plan={planForClass(outline, null, [])} name="web.pdf" target={{ kind: "new-class" }} />)
        fireEvent.click(importButton())
        expect(await screen.findByText(/is made, but hasn't downloaded yet/)).toBeTruthy()
        expect(fake.overlay.closeSheet).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Import 2" })).toBeTruthy()
        /* still not here: says so, and stays */
        fireEvent.click(importButton())
        expect(await screen.findByText(/still hasn't downloaded/)).toBeTruthy()
        expect(fakeImport.commitToClass).not.toHaveBeenCalled()
        /* here now */
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.data.space_prefs = [pref]
        fireEvent.click(importButton())
        await waitFor(() => expect(fakeImport.commitToClass).toHaveBeenCalledWith(expect.anything(), SID))
        expect(fakeImport.commitNewClass).toHaveBeenCalledTimes(1)
        /* its Members, as a class made in one go opens */
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "members" })
        expect(fake.overlay.closeSheet).not.toHaveBeenCalled()
    })

    it("keeps the preview when the new class can't be made, to try again", async () => {
        fakeImport.commitNewClass.mockRejectedValueOnce(new ApiError(429, { error: "limit" }))
        render(<ImportSheet plan={planForClass(outline, null, [])} name="web.pdf" target={{ kind: "new-class" }} />)
        fireEvent.click(importButton())
        expect(await screen.findByText("You're in 20 classes and projects, the most anyone can be in.")).toBeTruthy()
        expect((importButton() as HTMLButtonElement).disabled).toBe(false)
        expect(fake.overlay.closeSheet).not.toHaveBeenCalled()
        fireEvent.click(importButton())
        await waitFor(() => expect(fakeImport.commitNewClass).toHaveBeenCalledTimes(2))
    })

    it("shows the semester picker for a new class", () => {
        fake.data.profile = { id: "u-me", isAdmin: true, schoolCalendar: CAL }
        render(<ImportSheet plan={planForClass(outline, null, [])} name="web.pdf" target={{ kind: "new-class" }} />)
        expect(screen.getByRole("group", { name: /Semester for/ })).toBeTruthy()
    })

    it("offers no class that hasn't downloaded yet", () => {
        fake.data.spaces = [space("owner")]
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        expect(screen.queryByRole("combobox", { name: "Import into" })).toBeNull()
    })

    it("says what went wrong importing into a class, and closes", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fakeImport.commitToClass.mockRejectedValueOnce(new Error("the class isn't on this device yet"))
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        pick("class:" + SID)
        fireEvent.click(importButton())
        await waitFor(() => expect(fake.toast).toHaveBeenCalledWith("the class isn't on this device yet", { error: true }))
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
        cleanup()
        fakeImport.commitToClass.mockRejectedValueOnce(new ApiError(403, { error: "forbidden" }))
        render(<ImportSheet plan={planMine(outline)} name="web.pdf" />)
        pick("class:" + SID)
        fireEvent.click(importButton())
        await waitFor(() => expect(fake.toast).toHaveBeenLastCalledWith("Only the class's owner can do that.", { error: true }))
    })

    it("My courses imports through commitImport", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        const plan = planMine(outline)
        render(<ImportSheet plan={plan} name="web.pdf" />)
        fireEvent.click(importButton())
        await waitFor(() => expect(fakeImport.commitImport).toHaveBeenCalledWith(plan))
        expect(fakeImport.commitToClass).not.toHaveBeenCalled()
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
        expect(fake.toast).toHaveBeenCalledWith("Imported 0 classes and 2 items.", { error: false })
    })
})

describe("a new class from an outline", () => {
    afterEach(() => { ui.aiNote = null; ui.aiLeft = null })

    it("reads the file picked with AI, for a new class", () => {
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("radio", { name: /From a course outline/ }))
        expect(screen.getByRole("button", { name: "Choose the outline…" })).toBeTruthy()
        const file = new File(["%PDF"], "web.pdf", { type: "application/pdf" })
        fireEvent.change(screen.getByLabelText("Course outline file"), { target: { files: [file] } })
        expect(fakeImport.readOutlineFile).toHaveBeenCalledWith(file, "aiNote", { forNewClass: true })
    })

    it("says why a read failed", () => {
        ui.aiNote = { text: "You seem to be offline. Reading outlines needs a connection.", error: true }
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("radio", { name: /From a course outline/ }))
        expect(screen.getByText(/Reading outlines needs a connection/)).toBeTruthy()
    })

    it("shows the read's note only under the outline choice", () => {
        ui.aiNote = { text: "You seem to be offline. Reading outlines needs a connection.", error: true }
        render(<NewClassSheet />)
        expect(screen.queryByText(/Reading outlines needs a connection/)).toBeNull()
    })

    it("closes the outline choice when no AI reads are left today", () => {
        ui.aiLeft = 0
        render(<NewClassSheet />)
        expect((screen.getByRole("radio", { name: /From a course outline/ }) as HTMLInputElement).disabled).toBe(true)
        expect(screen.getByText(/No AI reads left today/)).toBeTruthy()
    })

    it("closes the outline choice while Import with AI is switched off for you", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["import"], message: "" } }
        render(<NewClassSheet />)
        expect((screen.getByRole("radio", { name: /From a course outline/ }) as HTMLInputElement).disabled).toBe(true)
        expect(screen.getByText("Import with AI is being worked on.")).toBeTruthy()
        expect((screen.getByRole("radio", { name: /Blank/ }) as HTMLInputElement).disabled).toBe(false)
    })
})
