import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SyncStatus } from "@/components/sync-status"

// The app is not booted: the button reads core/sync's status, a fake here, through
// data/sync.ts, and syncs through the actions, a fake too.
const fake = vi.hoisted(() => {
    const statusListeners = new Set<(s: unknown) => void>()
    return {
        status: { state: "idle", pending: 0, message: "" },
        statusListeners,
        setStatus(s: { state: string; pending?: number; message?: string }) {
            Object.assign(this.status, { pending: 0, message: "", ...s })
            for (const fn of statusListeners) fn(this.status)
        },
    }
})
const syncNow = vi.hoisted(() => vi.fn())
vi.mock("@/data/actions", () => ({ syncNow }))
vi.mock("@/core/sync", () => ({
    status: fake.status,
    onStatus: (fn: (s: unknown) => void) => fake.statusListeners.add(fn),
}))

afterEach(() => {
    cleanup()
    syncNow.mockClear()
    act(() => fake.setStatus({ state: "idle" }))
})

describe("the sync button", () => {
    it("shows the sync state and syncs on click", () => {
        render(<SyncStatus />)
        const cases: [Parameters<typeof fake.setStatus>[0], string][] = [
            [{ state: "idle" }, "Synced"],
            [{ state: "pending" }, "Saving…"],
            [{ state: "syncing" }, "Syncing…"],
            [{ state: "offline", pending: 3 }, "Offline · 3"],
            [{ state: "error", message: "Server said no" }, "Sync problem"],
            [{ state: "signed-out" }, "Signed out"],
        ]
        for (const [status, label] of cases) {
            act(() => fake.setStatus(status))
            expect(screen.getByRole("button", { name: label })).toBeTruthy()
        }
        const pill = screen.getByRole("button", { name: "Signed out" })
        act(() => fake.setStatus({ state: "error", message: "Server said no" }))
        expect(pill.title).toBe("Server said no")
        expect(screen.getByRole("status").textContent).toBe("Sync problem. Server said no")
        fireEvent.click(pill)
        expect(syncNow).toHaveBeenCalledOnce()
    })
})
