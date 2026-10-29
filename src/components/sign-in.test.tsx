import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SignIn } from "@/components/sign-in"
import { showApp, showSignInState } from "@/data/signin"
import { Page, SignInScreen } from "./shell"
import { stubMatchMedia } from "./test-media"

// session.ts opens the whole app; the form only needs its signIn(). The real
// one answers a failure by showing the form again with the reason, as this fake does.
const signIn = vi.hoisted(() => vi.fn())
vi.mock("@/data/session", () => ({ signIn }))
vi.mock("@/components/sign-in-check", () => ({
    SignInCheck: ({ onToken }: { onToken: (token: string) => void }) => (
        <button type="button" onClick={() => onToken("tok")}>Solve check</button>
    ),
}))

stubMatchMedia({ reducedMotion: false })

const show = (opts: { error?: string; username?: string } = {}) => act(() => showSignInState(opts))
const button = () => screen.getByRole("button") as HTMLButtonElement

afterEach(() => {
    cleanup()
    signIn.mockReset()
})

describe("sign-in", () => {
    it("shows the sign-in screen, hides the app, and focuses the username", () => {
        render(<><SignInScreen><SignIn /></SignInScreen><Page /></>)
        show()
        expect(document.getElementById("signin")!.hidden).toBe(false)
        expect(document.getElementById("app")!.hidden).toBe(true)
        expect(document.activeElement?.id).toBe("loginUser")
        expect(screen.queryByRole("alert")).toBeNull()
        /* the wordmark is plain serif text, with no picture */
        expect(screen.getByRole("heading").textContent).toBe("Term")
        expect(document.querySelector("img")).toBeNull()
    })

    it("keeps the username and focuses the password when one is given", () => {
        render(<SignIn />)
        show({ username: "maya" })
        expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("maya")
        expect(document.activeElement?.id).toBe("loginPass")
    })

    it.each([
        "Wrong username or password.",
        "Too many attempts. Try again in 3 min.",
        "You seem to be offline.",
        "Sign in from the app itself, not from another site.",
        "Sign-in failed (500).",
    ])("shows the error %s as an alert", (message) => {
        render(<SignIn />)
        show({ error: message, username: "maya" })
        expect(screen.getByRole("alert").textContent).toBe(message)
    })

    it("sends the fields, waits with the button disabled, and is ready again after a failure", async () => {
        let fail = () => {}
        signIn.mockImplementation(() => new Promise<void>((resolve) => { fail = () => { showSignInState({ error: "Wrong username or password.", username: "maya" }); resolve() } }))
        render(<SignIn />)
        show()
        fireEvent.change(screen.getByLabelText("Username"), { target: { value: "maya" } })
        fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } })
        fireEvent.click(button())
        expect(signIn).toHaveBeenCalledWith("maya", "secret")
        expect(button().disabled).toBe(true)
        expect(button().textContent).toBe("Signing in…")

        await act(async () => fail())
        expect(button().disabled).toBe(false)
        expect(button().textContent).toBe("Sign in")
        expect(screen.getByRole("alert").textContent).toBe("Wrong username or password.")
        expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("")
        expect(document.activeElement?.id).toBe("loginPass")
    })

    it("says how to recover a forgotten password", () => {
      render(<SignIn />)
      expect(screen.getByText("Forgot your password? Ask whoever runs Term to reset it.")).toBeTruthy()
    })
    it("a locked sign-in waits for the CAPTCHA token, then sends it with the login", () => {
        render(<SignIn />)
        act(() => showSignInState({ error: "locked", username: "maya", lockedUntil: Date.now() + 60_000, captchaSiteKey: "site-key" }))
        fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } })
        const submit = () => screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement
        expect(submit().disabled).toBe(true)
        fireEvent.click(screen.getByRole("button", { name: "Solve check" }))
        expect(submit().disabled).toBe(false)
        fireEvent.click(submit())
        expect(signIn).toHaveBeenCalledWith("maya", "secret", "tok")
    })

    it("drops the lock's message and its check when the lock ends", () => {
        vi.useFakeTimers()
        try {
            render(<SignIn />)
            act(() => showSignInState({ error: "Sign-in for maya is locked for 1 min. Complete the check below to try again now.", username: "maya", lockedUntil: Date.now() + 60_000, captchaSiteKey: "site-key" }))
            expect(screen.getByRole("alert").textContent).toMatch(/locked for 1 min/)
            expect(screen.getByRole("button", { name: "Solve check" })).toBeTruthy()
            act(() => { vi.advanceTimersByTime(60_200) })
            expect(screen.queryByRole("alert")).toBeNull()
            expect(screen.queryByRole("button", { name: "Solve check" })).toBeNull()
            fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } })
            expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe("the sign-in screen and the app", () => {
    it("switch as the session opens and ends", () => {
        render(<><SignInScreen><SignIn /></SignInScreen><Page><button>Today</button></Page></>)
        const signin = () => document.getElementById("signin")!, app = () => document.getElementById("app")!
        act(() => showApp())
        expect(signin().hidden).toBe(true)
        expect(app().hidden).toBe(false)
        show({ error: "Your session has ended. Sign in again." })
        expect(signin().hidden).toBe(false)
        expect(app().hidden).toBe(true)
        expect(screen.getByRole("alert").textContent).toBe("Your session has ended. Sign in again.")
    })
})
