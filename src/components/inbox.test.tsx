import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// The bell in the top bar and the inbox sheet it opens, with the store, the API, sync and the
// top bar's actions as fakes; the overlay, the inbox's data (data/inbox.ts) and the class
// rules (data/classes.ts) are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: false } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    meta: new Map<string, unknown>(),
    api: {
        inbox: { get: vi.fn(), seen: vi.fn(async () => null) },
        invites: { accept: vi.fn(), decline: vi.fn() },
        spaces: { get: vi.fn(), activity: vi.fn() },
        join: vi.fn(),
    },
    syncNow: vi.fn(async () => true),
    ui: { view: "table", anchor: "2026-10-15", search: "" },
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    subscribe: () => () => {},
    meta: { get: async (k: string) => fake.meta.get(k), set: async (k: string, v: unknown) => { fake.meta.set(k, v) } },
}))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow, status: { state: "idle", pending: 0, message: "" }, onStatus: () => {} }))
vi.mock("@/data/actions", () => ({
    goToday: vi.fn(), step: vi.fn(), setSearch: vi.fn(), newItem: vi.fn(), showSidebar: vi.fn(), openAiImport: vi.fn(), openItem: vi.fn(), openCourse: vi.fn(),
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/spotify/player", () => ({ state: { loaded: true, connected: false } }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))
vi.mock("@/data/effective", () => ({ itemByKey: () => null }))

import { closeSheet, getSheet } from "@/data/overlay"
import { setUnread } from "@/data/inbox"
import { TopBar } from "./top-bar"
import { Sheet } from "./sheet/sheet"

const SID = "abcdefabcdef"
const invite = { spaceId: SID, kind: "class", name: "Web Services", role: "member", from: "Gabriel", createdAt: 0, expiresAt: 9e15, expired: false }
const news = {
    seq: 7, spaceId: SID, space: "Web Services", kind: "class", verb: "item.date", subject: "a1", actor: "u-g", subjectUser: "",
    about: false, old: "2026-10-15||", new: "2026-10-18||", detail: { by: "Gabriel", title: "REST API" }, n: 1, at: 0,
}
const summary = { id: SID, scope: "c:" + SID, kind: "class" as const, name: "Web Services", role: "member" as const, members: 3 }
const bell = (name: string | RegExp) => screen.getByRole("button", { name })

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 15, 12))
    /* the inbox sheet loads on first use (lib/lazy.ts): fetched here, so opening it draws in time */
    await import("./sheet/inbox-sheet")
    await import("./sheet/join-sheet")
})
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
    fake.data.profile = { id: "u-me", isAdmin: false }
    fake.data.spaces = []
    news.at = Date.now() - 5 * 60e3
    fake.api.inbox.get.mockResolvedValue({ invites: [invite], items: [news], seen: 0 })
})
afterEach(() => { act(() => closeSheet()); cleanup(); vi.clearAllMocks(); act(() => setUnread(0)) })

describe("the bell and the inbox (spec §12, §15)", () => {
    it("shows the unread count, and none at zero", () => {
        render(<TopBar />)
        act(() => setUnread(0))
        expect(bell("Inbox").textContent).toBe("")
        act(() => setUnread(3))
        expect(bell("Inbox, 3 unread").textContent).toBe("3")
        expect(bell("Inbox, 3 unread").getAttribute("aria-haspopup")).toBe("dialog")
        act(() => setUnread(98))
        expect(bell("Inbox, 98 unread").textContent).toBe("98")
        /* the server counts no higher than 99: that means 99 or more */
        act(() => setUnread(99))
        expect(bell("Inbox, 99 or more unread").textContent).toBe("99+")
    })

    it("lists invites and news, marks them read, and accepts an invite", async () => {
        fake.api.invites.accept.mockResolvedValue(summary)
        render(<><TopBar /><Sheet /></>)
        act(() => setUnread(2))
        await act(async () => { fireEvent.click(bell("Inbox, 2 unread")) })
        expect(getSheet()).toEqual({ kind: "inbox" })
        expect(await screen.findByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
        expect(screen.getByText(/invited you to the shared class/)).toBeTruthy()
        expect(screen.getByText("Web Services · 5 min ago")).toBeTruthy()
        /* read once fetched: the server hears, and the count falls to the invite still waiting */
        await waitFor(() => expect(fake.api.inbox.seen).toHaveBeenCalledWith(7))
        expect(bell("Inbox, 1 unread")).toBeTruthy()
        /* the row that was new keeps saying so while the sheet is open */
        expect(screen.getByText("New:")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Accept the invite to Web Services" }))
        await waitFor(() => expect(getSheet()).toEqual({ kind: "join", code: "", space: summary }))
        expect(fake.api.invites.accept).toHaveBeenCalledWith(SID)
        expect(bell("Inbox")).toBeTruthy()
    })

    it("offline, shows the copy kept from last time and says so", async () => {
        render(<><TopBar /><Sheet /></>)
        await act(async () => { fireEvent.click(bell(/^Inbox/)) })
        expect(await screen.findByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
        expect(screen.queryByText(/You're offline/)).toBeNull()
        act(() => closeSheet())
        /* slid out: the sheet lets go of what it showed */
        fireEvent.transitionEnd(document.querySelector('[role="dialog"]')!)
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("Failed to fetch"))
        await act(async () => { fireEvent.click(bell(/^Inbox/)) })
        expect(await screen.findByText("You're offline. This is what the inbox held last time.")).toBeTruthy()
        expect(screen.getByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
        expect((screen.getByRole("button", { name: "Accept the invite to Web Services" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("offline, marks nothing read: the bell keeps its count", async () => {
        render(<><TopBar /><Sheet /></>)
        /* a first open whose marking does not reach the server: the list stays unread, the count with it */
        fake.api.inbox.seen.mockRejectedValueOnce(new TypeError("Failed to fetch"))
        act(() => setUnread(2))
        await act(async () => { fireEvent.click(bell("Inbox, 2 unread")) })
        expect(await screen.findByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
        await waitFor(() => expect(fake.api.inbox.seen).toHaveBeenCalledWith(7))
        await waitFor(() => expect(bell("Inbox, 2 unread")).toBeTruthy())
        act(() => closeSheet())
        fireEvent.transitionEnd(document.querySelector('[role="dialog"]')!)
        /* then offline: the copy kept (read up to 0, one row) shows, and nothing is marked */
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("Failed to fetch"))
        await act(async () => { fireEvent.click(bell("Inbox, 2 unread")) })
        expect(await screen.findByText("You're offline. This is what the inbox held last time.")).toBeTruthy()
        expect(bell("Inbox, 2 unread")).toBeTruthy()
        expect(fake.api.inbox.seen).toHaveBeenCalledTimes(1)
    })

    it("lets a row open what it is about only while that is here", async () => {
        render(<><TopBar /><Sheet /></>)
        await act(async () => { fireEvent.click(bell(/^Inbox/)) })
        /* not in that class on this device, the item not here: the row only reads */
        expect(await screen.findByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
        expect(screen.queryByRole("button", { name: /Gabriel moved REST API/ })).toBeNull()
        act(() => closeSheet())
        fireEvent.transitionEnd(document.querySelector('[role="dialog"]')!)
        fake.data.spaces = [{ id: SID }]
        await act(async () => { fireEvent.click(bell(/^Inbox/)) })
        expect(await screen.findByRole("button", { name: /Gabriel moved REST API/ })).toBeTruthy()
    })

    it("while classes are switched off, shows no count and opens the maintenance page", async () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<><TopBar /><Sheet /></>)
        act(() => setUnread(4))
        await act(async () => { fireEvent.click(bell("Inbox")) })
        expect(await screen.findByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(fake.api.inbox.get).not.toHaveBeenCalled()
    })

    it("gives an admin the inbox under the maintenance bar", async () => {
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<><TopBar /><Sheet /></>)
        act(() => setUnread(2))
        await act(async () => { fireEvent.click(bell("Inbox, 2 unread")) })
        expect(await screen.findByText(/only admins see this/)).toBeTruthy()
        expect(await screen.findByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
    })

    it("says so when there is nothing", async () => {
        fake.api.inbox.get.mockResolvedValue({ invites: [], items: [], seen: 0 })
        render(<><TopBar /><Sheet /></>)
        await act(async () => { fireEvent.click(bell("Inbox")) })
        expect(await screen.findByText("Nothing new. News from your classes shows here.")).toBeTruthy()
    })
})
