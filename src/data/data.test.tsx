import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"

/* Fakes for the legacy modules: a store that emits events, sync with a status, a ui. */
const fake = vi.hoisted(() => {
    const storeListeners = new Set<(e: { type: string }) => void>()
    const statusListeners = new Set<(s: unknown) => void>()
    return {
        data: { items: [] as unknown[], courses: [] as unknown[], achievements: [] as unknown[], profile: null as unknown },
        storeListeners,
        emit: (type: string) => { for (const fn of storeListeners) fn({ type }) },
        status: { state: "idle", pending: 0, message: "" },
        statusListeners,
        setStatus(s: { state: string; pending?: number; message?: string }) {
            Object.assign(this.status, { pending: 0, message: "", ...s })
            for (const fn of statusListeners) fn(this.status)
        },
        ui: { view: "week", search: "" },
    }
})
vi.mock("@/legacy/js/store.js", () => ({
    data: fake.data,
    subscribe: (fn: (e: { type: string }) => void) => { fake.storeListeners.add(fn); return () => fake.storeListeners.delete(fn) },
}))
vi.mock("@/legacy/js/sync.js", () => ({
    status: fake.status,
    onStatus: (fn: (s: unknown) => void) => fake.statusListeners.add(fn),
}))
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))

import { notify } from "@/bridge"
import { useAchievements, useCourses, useItems } from "./store"
import { useUi } from "./ui"
import { useSyncAnnouncement, useSyncStatus, syncLabel } from "./sync"

afterEach(cleanup)

describe("store hooks", () => {
    it("redraw a component when its collection changes, and not one that reads another", () => {
        const renders = { items: 0, courses: 0 }
        function Items() { renders.items++; return <p>{useItems().length} items</p> }
        function Courses() { renders.courses++; return <p>{useCourses().length} courses</p> }
        render(<><Items /><Courses /></>)
        const before = { ...renders }

        act(() => { fake.data.items = [{ id: "a" }, { id: "b" }]; fake.emit("change") })
        expect(screen.getByText("2 items")).toBeTruthy()
        expect(renders.items).toBe(before.items + 1)
        expect(renders.courses).toBe(before.courses)
    })

    it("read your own achievements as the store reloads them", () => {
        function Mine() { return <p>{useAchievements().length} of your own</p> }
        render(<Mine />)
        expect(screen.getByText("0 of your own")).toBeTruthy()
        act(() => { fake.data.achievements = [{ id: "a1" }]; fake.emit("synced") })
        expect(screen.getByText("1 of your own")).toBeTruthy()
    })

    it("ignore a save error, which leaves the data as it was", () => {
        let renders = 0
        function Items() { renders++; return <p>{useItems().length}</p> }
        render(<Items />)
        const before = renders
        act(() => fake.emit("save-error"))
        expect(renders).toBe(before)
    })
})

describe("useUi", () => {
    it("reads the legacy ui again after a legacy redraw", () => {
        function View() { return <p>{useUi((u) => u.view)}</p> }
        render(<View />)
        expect(screen.getByText("week")).toBeTruthy()
        act(() => { fake.ui.view = "month"; notify() })
        expect(screen.getByText("month")).toBeTruthy()
    })
})

describe("sync status", () => {
    function Pill() {
        const s = useSyncStatus()
        return <><p data-testid="label">{syncLabel(s)}</p><p data-testid="said">{useSyncAnnouncement()}</p></>
    }

    it("shows each state, with the edits waiting when offline", () => {
        render(<Pill />)
        act(() => fake.setStatus({ state: "pending" }))
        expect(screen.getByTestId("label").textContent).toBe("Saving…")
        act(() => fake.setStatus({ state: "offline", pending: 3 }))
        expect(screen.getByTestId("label").textContent).toBe("Offline · 3")
    })

    it("announces trouble and its end, not every save", () => {
        render(<Pill />)
        act(() => fake.setStatus({ state: "idle" }))
        const quiet = screen.getByTestId("said").textContent
        act(() => fake.setStatus({ state: "syncing" }))
        act(() => fake.setStatus({ state: "pending" }))
        expect(screen.getByTestId("said").textContent).toBe(quiet)
        act(() => fake.setStatus({ state: "error", message: "Server said no" }))
        expect(screen.getByTestId("said").textContent).toBe("Sync problem. Server said no")
        act(() => fake.setStatus({ state: "idle" }))
        expect(screen.getByTestId("said").textContent).toBe("Synced again")
    })
})
