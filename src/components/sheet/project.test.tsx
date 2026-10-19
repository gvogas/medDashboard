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
        saveProfile: vi.fn(async (patch: Row) => {
            fake.data.profile = { ...fake.data.profile, ...patch }
            notify()
        }),
        saveMark: vi.fn(async (mark: Row) => {
            fake.data.marks = [...fake.data.marks.filter((m) => (m as Row).id !== mark.id), mark]
            notify()
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
vi.mock("@/data/actions", async () => {
    const { openSheet } = await import("@/data/overlay")
    return { openCourse: vi.fn(), openItem: (id: string) => openSheet({ kind: "item", id }) }
})
vi.mock("@/data/effective", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/data/effective")>()), itemByKey: () => null }))

import { notify } from "@/bridge"
import * as store from "@/core/store"
import { addDays, iso } from "@/core/dates"
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
    await import("./task-sheet")
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
        expect(within(screen.getByRole("region", { name: "Projects" })).getByRole("button", { name: /^Fire Response API.*tasks done/ })).toBeTruthy()
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

    it("an editor's Edit takes the keyboard to the task and Cancel gives it back", async () => {
        seed("editor", [task("t1", [])])
        await show()
        const t1 = await screen.findByRole("listitem", { name: /t1/ })
        fireEvent.click(within(t1).getByRole("button", { name: "Edit t1" }))
        expect(document.activeElement).toBe(within(t1).getByLabelText("Task"))
        fireEvent.click(within(t1).getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(document.activeElement).toBe(within(t1).getByRole("button", { name: "Edit t1" })))
    })

    it("the editor goes when the project is archived under it", async () => {
        seed("editor", [task("t1", [])])
        await show()
        const t1 = await screen.findByRole("listitem", { name: /t1/ })
        fireEvent.click(within(t1).getByRole("button", { name: "Edit t1" }))
        expect(within(t1).getByLabelText("Task")).toBeTruthy()
        act(() => {
            fake.data.spaces = fake.data.spaces.map((s) => ((s as { id: string }).id === PID ? { ...(s as object), archived: true } : s))
            notify()
        })
        await waitFor(() => expect(within(t1).queryByLabelText("Task")).toBeNull())
        expect(within(t1).queryByRole("button", { name: "Edit t1" })).toBeNull()
    })

    it("fast adds keep each title apart: the box clears at once and Enter waits for the save", async () => {
        seed("editor")
        let finish = () => {}
        const save = vi.mocked(store.saveShared)
        const real = save.getMockImplementation()!
        save.mockImplementationOnce((...args) => new Promise((done) => { finish = () => done(real(...args)) }))
        await show()
        const box = (await screen.findByLabelText("New task")) as HTMLInputElement
        fireEvent.change(box, { target: { value: "Write tests" } })
        fireEvent.keyDown(box, { key: "Enter" })
        expect(box.value).toBe("")
        fireEvent.change(box, { target: { value: "Ship it" } })
        fireEvent.keyDown(box, { key: "Enter" })
        expect(box.value).toBe("Ship it")
        await act(async () => { finish() })
        expect(fake.saved.map((r) => r.title)).toEqual(["Write tests"])
        await act(async () => { fireEvent.keyDown(box, { key: "Enter" }) })
        expect(fake.saved.map((r) => r.title)).toEqual(["Write tests", "Ship it"])
        expect(box.value).toBe("")
    })

    it("a task that is not saved gives its title back", async () => {
        seed("editor")
        vi.mocked(store.saveShared).mockRejectedValueOnce(new Error("quota"))
        await show()
        const box = (await screen.findByLabelText("New task")) as HTMLInputElement
        fireEvent.change(box, { target: { value: "Write tests" } })
        await act(async () => { fireEvent.keyDown(box, { key: "Enter" }) })
        expect(box.value).toBe("Write tests")
    })

    it("a done task offers no Claim; an open one does", async () => {
        seed("member", [task("t1", []), task("t4", [], { status: "done", completedAt: 1 })])
        await show()
        expect(within(await screen.findByRole("listitem", { name: /t1/ })).getByRole("button", { name: "Claim" })).toBeTruthy()
        expect(within(screen.getByRole("listitem", { name: /t4/ })).queryByRole("button", { name: "Claim" })).toBeNull()
    })

    it("Add waits for a task's name", async () => {
        seed("editor")
        await show()
        expect(await screen.findByRole("button", { name: "Add" })).toHaveProperty("disabled", true)
        fireEvent.change(screen.getByLabelText("New task"), { target: { value: "Write tests" } })
        expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", false)
    })

    it("a delete the Worker refuses says why, and the sheet stays", async () => {
        seed("owner")
        const { ApiError } = await import("@/core/api")
        fake.api.spaces.deleteProject.mockRejectedValue(new ApiError(400, { error: "invalid", field: "confirm" }))
        await show()
        fireEvent.click(await screen.findByRole("button", { name: "Delete the project…" }))
        expect(document.activeElement).toBe(screen.getByLabelText("Type Fire Response API to confirm"))
        fireEvent.change(screen.getByLabelText("Type Fire Response API to confirm"), { target: { value: "Fire Response API" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete for everyone" })) })
        expect(await screen.findByText("Type the project's name exactly to delete it.")).toBeTruthy()
        expect(getSheet()).toEqual({ kind: "project", spaceId: PID, tab: "tasks" })
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete the project…" })))
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

    it("shows progress, the assignment's drift with Use this date, and workload in the picker", async () => {
        const soon = iso(addDays(new Date(), 3))
        seed("editor", [task("t1", ["u-me"], { status: "done", completedAt: 1 }), task("t2", ["u-sam"], { date: soon }), task("t3", [])])
        fake.data.shared_items = fake.data.shared_items.map((i) => ((i as { id: string }).id === "a1" ? { ...(i as object), date: "2026-10-18" } : i))
        await show()
        expect(await screen.findByText(/1 \/ 3 · 33%/)).toBeTruthy()
        expect(screen.getByText(/Assignment due 18 Oct/)).toBeTruthy()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use this date" })) })
        expect(fake.saved.at(-1)).toMatchObject({ id: "project", date: "2026-10-18", title: "Fire Response API" })
        const line = await screen.findByText(/For Web Services · REST API Project/)
        expect(screen.queryByRole("button", { name: "Use this date" })).toBeNull()
        /* the button went: the keyboard lands on the line it changed */
        expect(document.activeElement).toBe(line)
        fireEvent.click(screen.getAllByRole("button", { name: /^Edit / })[0])
        /* the name is the member's; the workload is its description */
        const said = (box: HTMLElement) => document.getElementById(box.getAttribute("aria-describedby") ?? "")?.textContent?.trim()
        expect(said(screen.getByRole("checkbox", { name: "Sam" }))).toBe("· 1 in the next 2 weeks")
        expect(said(screen.getByRole("checkbox", { name: "You" }))).toBe("· 0 in the next 2 weeks")
    })

    it("an archived class's assignment reads as removed, everywhere the owner looks", async () => {
        seed("owner")
        fake.data.spaces = fake.data.spaces.map((s) => ((s as { id: string }).id === CID ? { ...(s as object), archived: true } : s))
        fake.data.shared_items = [...fake.data.shared_items, { scope: "c:" + CID, id: "a2", type: "assignment", title: "Second Project", courseId: "web", date: "2026-10-20" }]
        await show()
        expect(await screen.findByText(/Linked assignment removed/)).toBeTruthy()
        const select = screen.getByLabelText("Belongs to") as HTMLSelectElement
        expect([...select.options].map((o) => o.text)).toEqual(["No class assignment", "Removed assignment"])
        expect(select.selectedOptions[0].text).toBe("Removed assignment")
    })

    it("offers Use this date only to those who can edit", async () => {
        seed("member")
        fake.data.shared_items = fake.data.shared_items.map((i) => ((i as { id: string }).id === "a1" ? { ...(i as object), date: "2026-10-18" } : i))
        await show()
        expect(await screen.findByText(/Assignment due 18 Oct/)).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Use this date" })).toBeNull()
    })

    it("says when the linked assignment is gone, and says nothing to someone without the class", async () => {
        seed("owner")
        fake.data.shared_items = fake.data.shared_items.filter((i) => (i as { id: string }).id !== "a1")
        await show()
        expect(await screen.findByText(/Linked assignment removed/)).toBeTruthy()
        cleanup()
        act(() => closeSheet())
        fake.data.spaces = fake.data.spaces.filter((s) => (s as { id: string }).id !== CID)
        await show()
        expect(await screen.findByRole("heading", { name: "Fire Response API" })).toBeTruthy()
        expect(screen.queryByText(/Linked assignment|For Web Services|Assignment due/)).toBeNull()
    })

    it("puts a ring and an eye on the sidebar's project row", async () => {
        seed("editor", [task("t1", ["u-me"], { status: "done", completedAt: 1 }), task("t2", ["u-sam"]), task("t3", [])])
        render(<ProjectsGroup />)
        const group = screen.getByRole("region", { name: "Projects" })
        expect(within(group).getByRole("button", { name: /^Fire Response API, 1 of 3 tasks done/ })).toBeTruthy()
        expect(within(group).queryByRole("img")).toBeNull()
        await act(async () => { fireEvent.click(within(group).getByRole("button", { name: "Hide Fire Response API on your calendar" })) })
        expect(fake.data.profile?.hiddenSources).toEqual(["space:" + PID])
        expect(within(group).getByRole("button", { name: "Show Fire Response API on your calendar" })).toBeTruthy()
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

    it("a task's title opens it in the card", async () => {
        seed("member", [task("t1", ["u-me"])])
        await show()
        fireEvent.click(await screen.findByRole("button", { name: "t1" }))
        expect(getSheet()).toEqual({ kind: "item", id: "p:" + PID + "/t1" })
        expect(await screen.findByRole("dialog", { name: "Team task" })).toBeTruthy()
    })
})

/* ── a task in the item card ── */

const card = async (key: string) => {
    render(<Sheet />)
    await act(async () => { openSheet({ kind: "item", id: key }) })
}

describe("a team task in the card (spec §15)", () => {
    beforeEach(() => { fake.syncNow.mockImplementation(async () => true) })
    const t1 = (more: Record<string, unknown> = {}) =>
        task("t1", ["u-me"], { title: "Create incidents endpoint", updatedBy: "u-sam", updatedAt: Date.now() - 2 * 3600_000, notes: "Use the v2 schema", checklist: [], links: [], ...more })

    it("opens a team task in the card: Team for the team, Yours for you", async () => {
        seed("member", [t1()])
        await card("p:" + PID + "/t1")
        expect(await screen.findByRole("heading", { name: "Create incidents endpoint" })).toBeTruthy()
        expect(screen.getByRole("dialog", { name: "Team task" })).toBeTruthy()
        expect(screen.getByText(/Edited by Sam · 2h ago/)).toBeTruthy()
        expect(screen.getByText("Use the v2 schema")).toBeTruthy()
        /* a member reads the team's facts */
        expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull()
        expect(screen.queryByRole("textbox", { name: "Team notes" })).toBeNull()
        expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull()
        /* but completes their own task */
        await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "Done" })) })
        expect(fake.saved.at(-1)).toMatchObject({ id: "t1", status: "done", completedBy: "u-me" })
        expect(typeof fake.saved.at(-1)!.completedAt).toBe("number")
        const notes = screen.getByRole("textbox", { name: "Your notes" })
        fireEvent.change(notes, { target: { value: "ask Sam about auth" } })
        await act(async () => { fireEvent.blur(notes) })
        expect(fake.data.marks).toEqual([expect.objectContaining({ id: PID + ":t1", spaceId: PID, itemId: "t1", notes: "ask Sam about auth" })])
    })

    it("a member cannot complete someone else's task, and claims an unassigned one", async () => {
        seed("member", [t1({ assignees: [] })])
        await card("p:" + PID + "/t1")
        expect(await screen.findByRole("checkbox", { name: "Done" })).toHaveProperty("disabled", true)
        expect(screen.getByText("Nobody yet")).toBeTruthy()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Claim" })) })
        expect(fake.saved.at(-1)).toMatchObject({ id: "t1", assignees: ["u-me"] })
        expect(screen.getByRole("checkbox", { name: "Done" })).toHaveProperty("disabled", false)
    })

    it("lets an editor change the team's facts and delete the task", async () => {
        seed("editor", [t1()])
        await card("p:" + PID + "/t1")
        const title = await screen.findByRole("textbox", { name: "Title" })
        fireEvent.change(title, { target: { value: "Incidents endpoint" } })
        await act(async () => { fireEvent.blur(title) })
        expect(fake.saved.at(-1)).toMatchObject({ id: "t1", title: "Incidents endpoint" })
        const notes = screen.getByRole("textbox", { name: "Team notes" })
        fireEvent.change(notes, { target: { value: "Use the v3 schema" } })
        await act(async () => { fireEvent.blur(notes) })
        expect(fake.saved.at(-1)).toMatchObject({ id: "t1", notes: "Use the v3 schema" })
        /* Delete asks first; Keep it goes back */
        fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
        expect(screen.getByText("Delete it for everyone in Fire Response API?")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Keep it" }))
        expect(store.removeShared).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete it" })) })
        expect(store.removeShared).toHaveBeenCalledWith("shared_items", "p:" + PID, "t1")
        expect(fake.data.shared_items.some((i) => (i as { id: string }).id === "t1")).toBe(false)
        await waitFor(() => expect(getSheet()).toBeNull())
    })

    it("hides it for you, and the project sheet shows it again", async () => {
        seed("member", [t1()])
        await card("p:" + PID + "/t1")
        await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /Not mine/ })) })
        expect(fake.data.marks).toEqual([expect.objectContaining({ id: PID + ":t1", hidden: true })])
        await waitFor(() => expect(getSheet()).toBeNull())
        cleanup()
        await show()
        const hidden = await screen.findByRole("list", { name: "Hidden from you" })
        await act(async () => { fireEvent.click(within(hidden).getByRole("button", { name: "Show Create incidents endpoint again" })) })
        expect(fake.data.marks).toEqual([expect.objectContaining({ id: PID + ":t1", hidden: false })])
    })

    it("reads a member's checklist aloud as done or to do, says No date, and says an archived project is read-only", async () => {
        seed("member", [t1({ date: "", checklist: [{ id: "c1", text: "Write schema", done: true }, { id: "c2", text: "Add tests", done: false }] })])
        await card("p:" + PID + "/t1")
        const list = await screen.findByRole("list", { name: "Checklist" })
        /* the glyphs are hidden; the words say it */
        list.querySelectorAll("[aria-hidden=true]").forEach((g) => g.remove())
        expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["done: Write schema", "to do: Add tests"])
        expect(screen.getByText("No date")).toBeTruthy()
        expect(screen.getByText("The project's owner and editors keep these.")).toBeTruthy()
        cleanup()
        act(() => closeSheet())
        fake.data.spaces = fake.data.spaces.map((s) => ((s as { id: string }).id === PID ? { ...(s as object), archived: true, role: "editor" } : s))
        await card("p:" + PID + "/t1")
        expect(await screen.findByText("This project is archived, so it is read-only.")).toBeTruthy()
        expect(screen.queryByText("The project's owner and editors keep these.")).toBeNull()
    })

    it("closes when the task is deleted under it", async () => {
        seed("member", [t1()])
        await card("p:" + PID + "/t1")
        expect(await screen.findByRole("heading", { name: "Create incidents endpoint" })).toBeTruthy()
        act(() => {
            fake.data.shared_items = fake.data.shared_items.filter((i) => (i as { id: string }).id !== "t1")
            notify()
        })
        await waitFor(() => expect(getSheet()).toBeNull())
    })
})
