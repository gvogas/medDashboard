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
        spaces: { create: vi.fn(), get: vi.fn(), activity: vi.fn(), deleteProject: vi.fn(), leave: vi.fn(), archive: vi.fn(), link: vi.fn(), remove: vi.fn() },
        invites: { accept: vi.fn(), decline: vi.fn() },
        inbox: { get: vi.fn(), seen: vi.fn() },
        join: vi.fn(),
    },
    next: null as null | (() => void),
    syncNow: vi.fn(async () => true),
    saved: [] as Record<string, unknown>[],
}))
/* the store's shared writes: the row lands in data.shared_items (a new array, as a reload makes) */
vi.mock("@/core/store", async () => {
    const { notify } = await import("@/bridge")
    type Row = Record<string, unknown>
    const other = (scope: unknown, id: unknown) => (r: unknown) => (r as Row).scope !== scope || (r as Row).id !== id
    return {
        data: fake.data, subscribe: () => () => {}, pendingCount: () => 0,
        saveShared: vi.fn(async (_store: string, row: Row) => {
            fake.saved.push(row)
            fake.data.shared_items = [...fake.data.shared_items.filter(other(row.scope, row.id)), row]
            notify()
            return row
        }),
        removeShared: vi.fn(async (_store: string, scope: string, id: string) => {
            fake.data.shared_items = fake.data.shared_items.filter(other(scope, id))
            notify()
        }),
    }
})
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
    await import("./project-sheet")
})
beforeEach(() => {
    Object.assign(fake.data, {
        profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [klass], shared_courses: [{ scope: "c:" + CID, id: "web", name: "Web Services" }],
        shared_items: [{ scope: "c:" + CID, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15" }], marks: [], space_prefs: [],
    })
    fake.syncNow.mockImplementation(async () => { arrives(); return true })
})
afterEach(() => { act(() => closeSheet()); cleanup(); vi.clearAllMocks(); fake.saved = [] })

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
        expect(await screen.findByRole("heading", { name: "Fire Response API" })).toBeTruthy()
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

    it("Enter in Name makes the project", async () => {
        fake.api.spaces.create.mockResolvedValue(summary)
        render(<Sheet />)
        await act(async () => { openSheet({ kind: "new-project", parent: null }) })
        const name = await screen.findByLabelText("Name")
        fireEvent.change(name, { target: { value: "Fire Response API" } })
        await act(async () => { fireEvent.keyDown(name, { key: "Enter" }) })
        expect(fake.api.spaces.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", title: "Fire Response API" }))
    })
})

/* ── the project sheet ── */

const task = (id: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
    scope: "p:" + PID, id, type: "task", title: id, date: "2026-10-10", status: "todo", completedAt: null, assignees, ...extra,
})
const seed = (role: "owner" | "editor" | "member", tasks: unknown[] = [], more: Record<string, unknown> = {}) => {
    fake.data.spaces = [klass, { ...project, role, members: [{ userId: "u-me", name: "You", role }, { userId: "u-sam", name: "Sam", role: "editor" }], ...more }]
    fake.data.shared_items = [...fake.data.shared_items, projectItem, ...tasks]
}
const show = async (tab: "tasks" | "members" | "activity" = "tasks") => {
    render(<Sheet />)
    await act(async () => { openSheet({ kind: "project", spaceId: PID, tab }) })
}

describe("the project sheet (spec §10, §15)", () => {
    beforeEach(() => { fake.syncNow.mockImplementation(async () => true) })

    it("says the project is still downloading until it is on this device", async () => {
        await show()
        expect(await screen.findByText(/isn't on this device yet/)).toBeTruthy()
        act(() => arrives())
        expect(await screen.findByRole("heading", { name: "Fire Response API" })).toBeTruthy()
    })

    it("an editor adds a task, assigns it, and completes it", async () => {
        seed("editor")
        await show()
        fireEvent.change(await screen.findByLabelText("New task"), { target: { value: "Create incidents endpoint" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add" })) })
        const row = await screen.findByRole("listitem", { name: /Create incidents endpoint/ })
        expect(within(row).getByText("Nobody yet")).toBeTruthy()
        expect((screen.getByLabelText("New task") as HTMLInputElement).value).toBe("")
        fireEvent.click(within(row).getByRole("button", { name: "Edit Create incidents endpoint" }))
        fireEvent.click(within(row).getByRole("checkbox", { name: "Sam" }))
        await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Save" })) })
        expect(await within(row).findByText("Sam")).toBeTruthy()
        await act(async () => { fireEvent.click(within(row).getByRole("checkbox", { name: "Done: Create incidents endpoint" })) })
        const last = fake.saved.at(-1)!
        expect(last).toMatchObject({ title: "Create incidents endpoint", status: "done", assignees: ["u-sam"] })
        expect(typeof last.completedAt).toBe("number")
    })

    it("a member claims an unassigned task, completes their own, and cannot edit", async () => {
        seed("member", [task("t1", []), task("t2", ["u-me"]), task("t3", ["u-sam"])])
        await show()
        const t1 = await screen.findByRole("listitem", { name: /t1/ })
        await act(async () => { fireEvent.click(within(t1).getByRole("button", { name: "Claim" })) })
        expect(await within(t1).findByText("You")).toBeTruthy()
        expect(fake.saved.at(-1)).toMatchObject({ id: "t1", assignees: ["u-me"] })
        expect(within(screen.getByRole("listitem", { name: /t3/ })).getByRole("checkbox")).toHaveProperty("disabled", true)
        expect(within(screen.getByRole("listitem", { name: /t2/ })).getByRole("checkbox")).toHaveProperty("disabled", false)
        expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull()
        expect(screen.queryByLabelText("New task")).toBeNull()
        expect(screen.getByRole("button", { name: "Leave the project…" })).toBeTruthy()
    })

    it("the owner deletes it only by typing its name", async () => {
        seed("owner")
        fake.api.spaces.deleteProject.mockImplementation(async () => { fake.data.spaces = [klass] })
        await show()
        fireEvent.click(await screen.findByRole("button", { name: "Delete the project…" }))
        const go = screen.getByRole("button", { name: "Delete for everyone" })
        expect(go).toHaveProperty("disabled", true)
        fireEvent.change(screen.getByLabelText("Type Fire Response API to confirm"), { target: { value: " Fire Response API " } })
        expect(go).toHaveProperty("disabled", false)
        await act(async () => { fireEvent.click(go) })
        expect(fake.api.spaces.deleteProject).toHaveBeenCalledWith(PID, "Fire Response API")
        await waitFor(() => expect(getSheet()).toBeNull())
    })

    it("says what a refused change means for a project", async () => {
        seed("owner")
        const { ApiError } = await import("@/core/api")
        fake.api.spaces.archive.mockRejectedValue(new ApiError(403, { error: "forbidden" }))
        await show()
        await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Archive the project" })) })
        expect(await screen.findByText("Only the project's owner can do that.")).toBeTruthy()
    })

    it("opens for a member who is no longer an admin, and says why it isn't in the sidebar", async () => {
        fake.data.profile = { id: "u-me", isAdmin: false }
        seed("editor", [task("t1", [])])
        await show()
        expect(await screen.findByRole("heading", { name: "Fire Response API" })).toBeTruthy()
        expect(screen.getByText(/open to admins only for now/)).toBeTruthy()
        expect(screen.getByLabelText("New task")).toBeTruthy()
    })

    it("an archived project is read-only", async () => {
        seed("editor", [task("t1", [])], { archived: true })
        await show()
        const t1 = await screen.findByRole("listitem", { name: /t1/ })
        expect(within(t1).getByRole("checkbox")).toHaveProperty("disabled", true)
        expect(within(t1).queryByRole("button", { name: "Claim" })).toBeNull()
        expect(screen.queryByLabelText("New task")).toBeNull()
    })

    it("removing a member from a project says nothing is copied", async () => {
        seed("owner")
        fake.api.spaces.get.mockResolvedValue({
            id: PID, scope: "p:" + PID, kind: "project", role: "owner", archived: false, invites: [], code: null, schoolCalendar: null,
            members: [{ userId: "u-me", username: "me", name: "You", role: "owner", joinedAt: 1 }, { userId: "u-sam", username: "sam", name: "Sam", role: "editor", joinedAt: 1 }],
        })
        await show("members")
        fireEvent.click(await screen.findByRole("button", { name: "Remove Sam" }))
        expect(screen.getByText(/Their tasks become unassigned; nothing is copied/)).toBeTruthy()
        expect(screen.getByRole("button", { name: "Remove Sam from the project" })).toBeTruthy()
        expect(screen.getByRole("heading", { name: "Hand the project on" })).toBeTruthy()
    })
})
