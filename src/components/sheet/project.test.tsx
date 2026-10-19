import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// Team projects (spec §10, §15): the + menu, the Projects group, the New team project sheet and
// joining a project, with the store, the API and sync as fakes; the overlay, the store's hooks
// and the project rules (data/projects.ts) are the real ones. A sync brings the next page.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    api: {
        spaces: { create: vi.fn(), get: vi.fn(), activity: vi.fn() },
        invites: { accept: vi.fn(), decline: vi.fn() },
        inbox: { get: vi.fn(), seen: vi.fn() },
        join: vi.fn(),
    },
    next: null as null | (() => void),
    syncNow: vi.fn(async () => true),
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
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow, status: { state: "idle", pending: 0, message: "" }, onStatus: () => {} }))
vi.mock("@/data/actions", () => ({ openCourse: vi.fn() }))
vi.mock("@/data/effective", () => ({ itemByKey: () => null }))

import { notify } from "@/bridge"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import { NewMenu } from "../sidebar-classes"
import { ProjectsGroup } from "../sidebar-projects"
import { Sheet } from "./sheet"

const CID = "webs00000001", PID = "fire00000001"
const klass = { id: CID, scope: "c:" + CID, kind: "class", role: "member", name: "Web Services", archived: false, parent: null, revision: 3, members: [] }
const project = { id: PID, scope: "p:" + PID, kind: "project", role: "owner", name: "Fire Response API", archived: false, parent: { space: CID, item: "a1" }, revision: 4, members: [] }
const summary = { id: PID, scope: "p:" + PID, kind: "project" as const, name: "Fire Response API", role: "owner" as const, members: 1 }
const projectItem = { scope: "p:" + PID, id: "project", type: "project", title: "Fire Response API", date: "2026-10-15", assignees: [] }

/* the next sync brings the project, its own item and your prefs for it */
const arrives = () => {
    fake.data.spaces = [...fake.data.spaces, project]
    fake.data.shared_items = [...fake.data.shared_items, projectItem]
    fake.data.space_prefs = [...fake.data.space_prefs, { id: PID, spaceId: PID, color: "#17B3AE", target: null, term: "", archived: false, revision: 1 }]
    notify()
}

/* the project sheets load on first use (lib/lazy.ts): fetched here, so opening one draws in time */
beforeAll(async () => {
    await import("./new-project-sheet")
    await import("./join-sheet")
})
beforeEach(() => {
    Object.assign(fake.data, {
        profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [klass], shared_courses: [{ scope: "c:" + CID, id: "web", name: "Web Services" }],
        shared_items: [{ scope: "c:" + CID, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15" }], marks: [], space_prefs: [],
    })
    fake.syncNow.mockImplementation(async () => { arrives(); return true })
})
afterEach(() => { act(() => closeSheet()); cleanup(); vi.clearAllMocks() })

describe("team projects (spec §10, §15)", () => {
    it("+ New offers a team project to admins, and the sheet makes one under an assignment", async () => {
        fake.api.spaces.create.mockResolvedValue({ id: PID, scope: "p:" + PID, kind: "project", name: "Fire Response API", role: "owner", members: 1 })
        render(<><NewMenu /><ProjectsGroup /><Sheet /></>)
        expect(screen.queryByRole("region", { name: "Projects" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "+ New" }))
        await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /New team project/ })) })
        expect(getSheet()).toEqual({ kind: "new-project", parent: null })
        fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Fire Response API" } })
        fireEvent.change(screen.getByLabelText("Belongs to"), { target: { value: CID + "/a1" } })
        expect((screen.getByLabelText("Due") as HTMLInputElement).value).toBe("2026-10-15")
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make the project" })) })
        expect(fake.api.spaces.create).toHaveBeenCalledWith({ kind: "project", title: "Fire Response API", date: "2026-10-15", parent: { space: CID, item: "a1" } })
        await waitFor(() => expect(getSheet()).toEqual({ kind: "project", spaceId: PID, tab: "tasks" }))
        // Task 6: expect(await screen.findByRole("heading", { name: "Fire Response API" })).toBeTruthy()
        expect(within(screen.getByRole("region", { name: "Projects" })).getByRole("button", { name: /Fire Response API/ })).toBeTruthy()
    })

    it("asks for a name, and starts on the assignment it was opened from", async () => {
        render(<Sheet />)
        await act(async () => { openSheet({ kind: "new-project", parent: { space: CID, item: "a1" } }) })
        expect(((await screen.findByLabelText("Belongs to")) as HTMLSelectElement).value).toBe(CID + "/a1")
        expect((screen.getByLabelText("Due") as HTMLInputElement).value).toBe("2026-10-15")
        fireEvent.click(screen.getByRole("button", { name: "Make the project" }))
        expect(screen.getByText("Give it a name.")).toBeTruthy()
        expect(fake.api.spaces.create).not.toHaveBeenCalled()
    })

    it("hides it all from someone who is not an admin", () => {
        fake.data.profile = { id: "u-me", isAdmin: false }
        fake.data.spaces = [klass, project]
        render(<><NewMenu /><ProjectsGroup /></>)
        fireEvent.click(screen.getByRole("button", { name: "+ New" }))
        expect(screen.getByRole("menuitem", { name: /New shared class/ })).toBeTruthy()
        expect(screen.queryByRole("menuitem", { name: /New team project/ })).toBeNull()
        expect(screen.queryByRole("region", { name: "Projects" })).toBeNull()
    })

    it("joining a project downloads it and offers to open it, with no semester or colour", async () => {
        render(<Sheet />)
        await act(async () => { openSheet({ kind: "join", code: "", space: summary }) })
        expect(await screen.findByRole("heading", { name: "You're in Fire Response API" })).toBeTruthy()
        expect(screen.queryByText(/Your semester|Your colour/)).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Open the project" }))
        expect(getSheet()).toEqual({ kind: "project", spaceId: PID, tab: "tasks" })
    })
})
