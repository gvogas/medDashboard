import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const profile = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }))
vi.mock("@/data/store", () => ({ useProfile: () => profile.value }))
const ui = vi.hoisted(() => ({ view: "week" }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ sideOpen: () => false, setSide: vi.fn() }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("@/data/toast", () => ({ toast }))
const admin = vi.hoisted(() => ({
    accounts: vi.fn(), create: vi.fn(), resetPassword: vi.fn(), revoke: vi.fn(), setAdmin: vi.fn(), remove: vi.fn(), unlock: vi.fn(),
    errors: vi.fn(), audit: vi.fn(), traffic: vi.fn(), health: vi.fn(), announcement: vi.fn(), announce: vi.fn(), unannounce: vi.fn(),
    maintenance: vi.fn(), setMaintenance: vi.fn(),
}))
vi.mock("@/core/api", async (orig) => ({ ...(await orig<typeof import("@/core/api")>()), api: { admin } }))

import { SideNav } from "@/components/side-nav"
import { AdminPage } from "./admin-page"
import { AnnouncementBanner } from "./announcement-banner"
import { lastHours } from "./overview"
import { ApiError } from "@/core/api"

const george = { id: "u-george", username: "george", isAdmin: true }
const accounts = [
    { id: "u-george", username: "george", displayName: "George", admin: true, lastSeen: null, createdAt: 1, feed: false, leaderboard: true, spotify: true, courses: 4, items: 30, studyMinutes: 125 },
    { id: "u-sam", username: "sam", displayName: "", admin: false, lastSeen: null, createdAt: 1, feed: true, leaderboard: false, spotify: false, courses: 1, items: 2, studyMinutes: 0 },
]

beforeEach(() => {
    try { localStorage.clear() } catch {}
    admin.accounts.mockResolvedValue({ accounts, locks: [{ key: "sam", username: "sam", device: false, fails: 6, lockedUntil: Date.now() + 60_000 }] })
    admin.traffic.mockResolvedValue({ configured: false, free: {} })
    admin.health.mockResolvedValue({ migrations: { ok: true, latest: "0001_schema.sql", applied: "0001_schema.sql" }, cronLastRun: Date.now(), secrets: { SESSION_SECRET: true }, ai: true, accounts: 2, errors24h: 0 })
})
afterEach(() => {
    cleanup()
    profile.value = null
    vi.clearAllMocks()
})

describe("who sees the Admin page", () => {
    it("lists Admin in the sidebar for admins only", () => {
        profile.value = { id: "u-sam", isAdmin: false }
        const { unmount } = render(<SideNav />)
        expect(screen.queryByRole("button", { name: "Admin" })).toBeNull()
        unmount()
        profile.value = george
        render(<SideNav />)
        expect(screen.getByRole("button", { name: "Admin" })).toBeTruthy()
    })

    it("shows nothing of the page to someone else, and asks the server nothing", () => {
        profile.value = { id: "u-sam", isAdmin: false }
        render(<AdminPage />)
        expect(screen.getByText("Admins only")).toBeTruthy()
        expect(admin.traffic).not.toHaveBeenCalled()
    })
})

describe("the Admin page", () => {
    beforeEach(() => { profile.value = george })

    it("opens on the overview, which explains how to set up traffic", async () => {
        render(<AdminPage />)
        expect(await screen.findByText("Traffic isn't set up yet.")).toBeTruthy()
        expect(await screen.findByText(/Up to date/)).toBeTruthy()
    })

    it("lists accounts with what they hold, and the locked names", async () => {
        render(<AdminPage />)
        fireEvent.click(screen.getByRole("tab", { name: "Accounts" }))
        const table = await screen.findByRole("table")
        expect(within(table).getByText("sam")).toBeTruthy()
        expect(screen.getByText("2.1 h")).toBeTruthy()
        expect(screen.getByText("Spotify, Leaderboard")).toBeTruthy()
        /* no delete or demote on your own row */
        expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1)
        expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy()
    })

    it("creates an account and says why one was refused", async () => {
        admin.create.mockRejectedValueOnce(new ApiError(409, { error: "taken", field: "username" }))
        admin.create.mockResolvedValueOnce({ id: "u-new", username: "newbie" })
        render(<AdminPage />)
        fireEvent.click(screen.getByRole("tab", { name: "Accounts" }))
        fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "newbie" } })
        fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long enough" } })
        fireEvent.click(screen.getByRole("button", { name: "Create account" }))
        expect(await screen.findByText("That username is taken.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Create account" }))
        expect(await screen.findByText(/Created newbie/)).toBeTruthy()
        expect(admin.create).toHaveBeenLastCalledWith({ username: "newbie", displayName: "", password: "long enough", admin: false })
    })

    it("deletes only once the username is typed", async () => {
        admin.remove.mockResolvedValue(null)
        render(<AdminPage />)
        fireEvent.click(screen.getByRole("tab", { name: "Accounts" }))
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
        const go = screen.getByRole("button", { name: "Delete forever" }) as HTMLButtonElement
        expect(go.disabled).toBe(true)
        fireEvent.change(screen.getByLabelText(/to delete the account/), { target: { value: "sam" } })
        expect(go.disabled).toBe(false)
        fireEvent.click(go)
        await waitFor(() => expect(admin.remove).toHaveBeenCalledWith("u-sam", "sam"))
    })

    it("switches features into maintenance with a message, and says which are on", async () => {
        admin.maintenance.mockResolvedValue({ maintenance: { features: ["week"], message: "", updatedAt: Date.now() - 60_000, updatedBy: "george" } })
        render(<AdminPage />)
        fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }))
        expect(await screen.findByText(/On now: Week/)).toBeTruthy()
        expect((screen.getByRole("switch", { name: "Week" }) as HTMLInputElement).checked).toBe(true)
        expect((screen.getByRole("switch", { name: "Month" }) as HTMLInputElement).checked).toBe(false)
        const labels = screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label") || (s as HTMLInputElement).labels?.[0]?.textContent)
        expect(labels).toEqual(["Whole app", "Week", "Month", "All items", "Study", "Music", "Import with AI", "Shared classes & projects"])
        fireEvent.click(screen.getByRole("switch", { name: "Music" }))
        fireEvent.click(screen.getByRole("switch", { name: "Week" }))
        fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Back by 9 pm." } })
        admin.setMaintenance.mockResolvedValueOnce({ maintenance: { features: ["spotify"], message: "Back by 9 pm.", updatedAt: Date.now(), updatedBy: "george" } })
        admin.maintenance.mockResolvedValue({ maintenance: { features: ["spotify"], message: "Back by 9 pm.", updatedAt: Date.now(), updatedBy: "george" } })
        fireEvent.click(screen.getByRole("button", { name: "Save" }))
        await waitFor(() => expect(admin.setMaintenance).toHaveBeenCalledWith(["spotify"], "Back by 9 pm."))
        expect(await screen.findByText(/On now: Music/)).toBeTruthy()
        expect(toast).toHaveBeenCalledWith(expect.stringMatching(/next sync/))
    })

    it("says when nothing is in maintenance, and why a save was refused", async () => {
        admin.maintenance.mockResolvedValue({ maintenance: { features: [], message: "", updatedAt: null, updatedBy: "" } })
        admin.setMaintenance.mockRejectedValueOnce(new ApiError(400, { error: "invalid", field: "message" }))
        render(<AdminPage />)
        fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }))
        expect(await screen.findByText("Nothing is in maintenance.")).toBeTruthy()
        fireEvent.click(screen.getByRole("switch", { name: "Whole app" }))
        fireEvent.click(screen.getByRole("button", { name: "Save" }))
        expect(await screen.findByRole("alert")).toBeTruthy()
        expect(screen.getByRole("alert").textContent).toMatch(/280 characters/)
    })
})

describe("the announcement banner", () => {
    it("shows a live announcement until it is closed, and a new one again", () => {
        profile.value = { id: "u-sam", announcement: { id: 1, text: "Down tonight", until: Date.now() + 60_000 } }
        const { rerender } = render(<AnnouncementBanner />)
        expect(screen.getByText("Down tonight")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Close the announcement" }))
        expect(screen.queryByText("Down tonight")).toBeNull()
        profile.value = { id: "u-sam", announcement: { id: 2, text: "Back up", until: Date.now() + 60_000 } }
        rerender(<AnnouncementBanner />)
        expect(screen.getByText("Back up")).toBeTruthy()
    })

    it("shows nothing once it has ended", () => {
        profile.value = { id: "u-sam", announcement: { id: 3, text: "Old news", until: Date.now() - 1 } }
        render(<AnnouncementBanner />)
        expect(screen.queryByText("Old news")).toBeNull()
    })
})

describe("the traffic chart's hours", () => {
    it("fills the hours with no traffic as zero, oldest first", () => {
        const now = Date.UTC(2026, 9, 1, 3, 30)
        const hours = lastHours([{ hour: "2026-10-01T02:00:00Z", requests: 5, errors: 1 }], 3, now)
        expect(hours).toEqual([
            { hour: "2026-10-01T01:00:00Z", requests: 0, errors: 0 },
            { hour: "2026-10-01T02:00:00Z", requests: 5, errors: 1 },
            { hour: "2026-10-01T03:00:00Z", requests: 0, errors: 0 },
        ])
    })
})
