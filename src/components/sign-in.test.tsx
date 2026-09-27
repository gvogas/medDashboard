import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SignIn } from "@/components/sign-in"
import { renderSignIn } from "@/legacy/js/views/signin.js"
import { stubMatchMedia } from "./test-media"

// session.js boots the whole legacy app; the form only needs its signIn(). The real
// one answers a failure by showing the form again with the reason, as this fake does.
const signIn = vi.hoisted(() => vi.fn())
vi.mock("@/legacy/js/session.js", () => ({ signIn }))

stubMatchMedia({ reducedMotion: false })
document.body.innerHTML = '<div id="signin" hidden></div><div id="app"></div>'

const show = (opts: { error?: string; username?: string } = {}) => act(() => renderSignIn(opts))
const button = () => screen.getByRole("button") as HTMLButtonElement

afterEach(() => {
    cleanup()
    signIn.mockReset()
})

describe("sign-in", () => {
    it("shows the page's container, hides the app, and focuses the username", () => {
        render(<SignIn />)
        show()
        expect(document.getElementById("signin")!.hidden).toBe(false)
        expect(document.getElementById("app")!.hidden).toBe(true)
        expect(document.activeElement?.id).toBe("loginUser")
        expect(screen.queryByRole("alert")).toBeNull()
        expect(document.querySelector('img[src="/wordmark.gif"]')).toBeTruthy()
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
        signIn.mockImplementation(() => new Promise<void>((resolve) => { fail = () => { renderSignIn({ error: "Wrong username or password.", username: "maya" }); resolve() } }))
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
})
