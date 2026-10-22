import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    api: { friends: { get: vi.fn(), search: vi.fn(), ask: vi.fn(), answer: vi.fn(), remove: vi.fn(), settings: vi.fn() } },
    maintenance: null as null | "blocked" | "admin",
}))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error {} }))
vi.mock("@/core/sync", () => ({ syncNow: vi.fn(() => Promise.resolve()) }))
vi.mock("@/data/inbox", () => ({ dropFriendRequest: vi.fn() }))
vi.mock("@/data/maintenance", () => ({ useMaintenance: () => fake.maintenance, maintenanceState: () => fake.maintenance }))
vi.mock("@/components/maintenance", () => ({ MaintenancePage: () => <p>Maintenance</p>, MaintenanceBar: () => null }))
vi.mock("@/data/signin", () => ({ useScreen: () => "app" }))

import { FriendsCard } from "./friends"
import { resetFriends } from "@/data/friends"

const list = () => ({
    friends: [{ userId: "u-sam", username: "samo", name: "Sam Okoye", since: 1 }],
    incoming: [{ userId: "u-jo", username: "jordanlee", name: "Jordan Lee", at: 1 }],
    sent: [{ userId: "u-tk", username: "tkim", name: "Taylor Kim", at: 1 }],
    settings: { findable: true, showStudying: true },
})

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    resetFriends()
    fake.maintenance = null
    fake.api.friends.get.mockResolvedValue(list())
    vi.stubGlobal("navigator", { onLine: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

const show = async () => { render(<FriendsCard />); await act(async () => {}) }

describe("the Friends tab", () => {
    it("lists friends, requests to you and from you", async () => {
        await show()
        expect(within(screen.getByRole("region", { name: "Friends" })).getByText("Sam Okoye")).toBeTruthy()
        const req = screen.getByRole("region", { name: "Requests" })
        expect(within(req).getByRole("button", { name: "Accept Jordan Lee" })).toBeTruthy()
        expect(within(req).getByRole("button", { name: "Cancel the request to Taylor Kim" })).toBeTruthy()
    })

    it("accepts a request", async () => {
        fake.api.friends.answer.mockResolvedValue(null)
        await show()
        /* what the server will say once it has the accept */
        const l = list()
        fake.api.friends.get.mockResolvedValue({ ...l, incoming: [], friends: [...l.friends, { userId: "u-jo", username: "jordanlee", name: "Jordan Lee", since: 2 }] })
        fireEvent.click(screen.getByRole("button", { name: "Accept Jordan Lee" }))
        await act(async () => {})
        expect(fake.api.friends.answer).toHaveBeenCalledWith("u-jo", true)
        expect(within(screen.getByRole("region", { name: "Friends" })).getByText("Jordan Lee")).toBeTruthy()
    })

    it("searches after 2 letters and sends a request", async () => {
        fake.api.friends.search.mockResolvedValue({ people: [{ userId: "u-mo", username: "morgand", name: "Morgan Diaz", state: "none" }] })
        fake.api.friends.ask.mockResolvedValue({ userId: "u-mo", username: "morgand", name: "Morgan Diaz", state: "requested" })
        await show()
        const box = screen.getByRole("searchbox", { name: "Name or username" })
        fireEvent.change(box, { target: { value: "m" } })
        await act(async () => { vi.advanceTimersByTime(400) })
        expect(fake.api.friends.search).not.toHaveBeenCalled()
        fireEvent.change(box, { target: { value: "mor" } })
        await act(async () => { vi.advanceTimersByTime(400) })
        expect(fake.api.friends.search).toHaveBeenCalledWith("mor")
        fireEvent.click(screen.getByRole("button", { name: "Add Morgan Diaz" }))
        await act(async () => {})
        expect(fake.api.friends.ask).toHaveBeenCalledWith("morgand")
        expect(screen.getByText("Requested")).toBeTruthy()
    })

    it("saves the search switch", async () => {
        fake.api.friends.settings.mockResolvedValue(null)
        await show()
        fireEvent.click(screen.getByRole("checkbox", { name: /Let people find me in search/ }))
        await act(async () => {})
        expect(fake.api.friends.settings).toHaveBeenCalledWith({ findable: false, showStudying: true })
    })

    it("shows the maintenance page while friends are switched off", async () => {
        fake.maintenance = "blocked"
        await show()
        expect(screen.getByText("Maintenance")).toBeTruthy()
        expect(fake.api.friends.get).not.toHaveBeenCalled()
    })
})
