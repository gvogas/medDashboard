// Its own file: Framer Motion reads prefers-reduced-motion once per module load.
import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ViewDock } from "@/components/view-dock"
import { stubMatchMedia } from "./test-media"

vi.mock("@/legacy/js/state.js", () => ({ ui: { view: "week" } }))
vi.mock("@/legacy/js/study-controller.js", () => ({ setView: vi.fn() }))

stubMatchMedia({ reducedMotion: true })

it("does not magnify when reduced motion is asked for", async () => {
    render(<ViewDock />)
    const sizes = () => screen.getAllByRole("button").map((b) => b.style.width)
    expect(sizes()).toEqual(Array(5).fill("28px"))
    fireEvent.mouseMove(screen.getByRole("group", { name: "Views" }), { clientX: 0, clientY: 0 })
    await new Promise((r) => setTimeout(r, 150))
    expect(sizes()).toEqual(Array(5).fill("28px"))
})
