// The Music page's way to the focus screen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const timer = vi.hoisted(() => ({
    run: null as object | null,
    startRun: vi.fn(async () => true),
    openFocus: vi.fn(),
}))
vi.mock("@/data/study-timer", () => ({
    useRun: () => timer.run,
    startRun: timer.startRun,
    openFocus: timer.openFocus,
}))
const go = vi.hoisted(() => ({ setView: vi.fn(), setStudyTab: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ setView: go.setView }))
vi.mock("@/data/study", () => ({ setStudyTab: go.setStudyTab }))

import { FocusButton } from "./focus-button"

beforeEach(() => {
    timer.run = null
    timer.startRun.mockReset().mockResolvedValue(true)
    timer.openFocus.mockReset()
    go.setView.mockReset()
    go.setStudyTab.mockReset()
})
afterEach(cleanup)

describe("the Music page's focus button", () => {
    it("starts a run on the saved flow", async () => {
        render(<FocusButton />)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start focus" })) })
        expect(timer.startRun).toHaveBeenCalledOnce()
        expect(go.setView).not.toHaveBeenCalled()
    })

    it("opens the Study page's Timer when nothing is picked to study", async () => {
        timer.startRun.mockResolvedValue(false)
        render(<FocusButton />)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start focus" })) })
        expect(go.setStudyTab).toHaveBeenCalledWith("timer")
        expect(go.setView).toHaveBeenCalledWith("study")
    })

    it("goes back to the focus screen during a run", () => {
        timer.run = {}
        render(<FocusButton />)
        fireEvent.click(screen.getByRole("button", { name: "Back to focus" }))
        expect(timer.openFocus).toHaveBeenCalledOnce()
        expect(timer.startRun).not.toHaveBeenCalled()
    })
})
