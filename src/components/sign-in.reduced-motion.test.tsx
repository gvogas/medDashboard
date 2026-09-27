// Its own file: Framer Motion reads prefers-reduced-motion once per module load.
import { expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SignIn } from "@/components/sign-in"
import { stubMatchMedia } from "./test-media"

vi.mock("@/legacy/js/session.js", () => ({ signIn: vi.fn() }))

stubMatchMedia({ reducedMotion: true })

it("shows the wordmark as plain text, with no GIF, when reduced motion is asked for", () => {
    render(<SignIn />)
    expect(screen.getByRole("heading").textContent).toBe("Rounds")
    expect(document.querySelector("img")).toBeNull()
})
