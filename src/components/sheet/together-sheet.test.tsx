import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    data: { profile: null as Record<string, unknown> | null },
}))

vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {} }))
vi.mock("@/data/overlay", () => ({ closeSheet: vi.fn() }))
vi.mock("@/data/friends", () => ({ friendsStale: () => false, loadFriends: vi.fn(), useFriends: () => ({ list: { friends: [] }, offline: false, error: "" }) }))
vi.mock("@/data/room", () => ({ ROOM_INVITES: 7 }))
vi.mock("@/data/study-timer", () => {
    const flow = { steps: [["study", 25], ["break", 5]], rounds: 4 }
    return {
        flowTotals: () => ({ study: 100, total: 120 }), pickCourse: vi.fn(), pickItem: vi.fn(), presetsFor: () => [],
        sameFlow: () => true, startRoomRun: vi.fn(), useFlow: () => flow, useRun: () => null,
        useStudyPick: () => ({ courses: [], items: [], courseId: null, itemId: null }),
    }
})

import { TogetherSheet } from "./together-sheet"

afterEach(cleanup)

describe("the Study together sheet", () => {
    it("gives the maintenance page to someone who is not an admin while friends are off, and an admin the bar", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["friends"], message: "" } }
        render(<TogetherSheet invite={[]} />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByText(/One shared timer/)).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["friends"], message: "" } }
        render(<TogetherSheet invite={[]} />)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
        expect(screen.getByText(/One shared timer/)).toBeTruthy()
    })

    it("shows no bar while friends are on", () => {
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: [], message: "" } }
        render(<TogetherSheet invite={[]} />)
        expect(screen.getByText(/One shared timer/)).toBeTruthy()
        expect(screen.queryByText(/only admins see this/)).toBeNull()
    })
})
