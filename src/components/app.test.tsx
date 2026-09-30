import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { showApp, showSignInState } from "@/data/signin"
import { App } from "./app"
import { stubMatchMedia } from "./test-media"

// The whole page with nothing signed in and no data: what styles/shell.css and the inert
// rules rely on is the order of the containers and which of them show.
stubMatchMedia({ reducedMotion: true })

afterEach(() => cleanup())

describe("<App>", () => {
    it("draws the containers in the page's order", () => {
        const { container } = render(<App />)
        expect([...container.children].map((el) => el.id)).toEqual(["signin", "app", "scrim", "sheet", "overlays", "toaster"])
        const app = container.querySelector("#app")!
        expect([...app.children].map((el) => el.id || el.className)).toEqual(["side", "content", "study-dock", "focus"])
        expect([...app.querySelector(".content")!.children].map((el) => el.id || el.tagName.toLowerCase())).toEqual(["header", "scroll"])
        expect(container.querySelector("#scroll > #stats + #views")).toBeTruthy()
        expect(container.querySelector("#sheet")!.hasAttribute("inert")).toBe(true)
        /* the sync state's live region is outside #app, which the sidebar and the sheet make inert */
        expect(container.querySelector("#toaster [role=status]")).toBeTruthy()
        expect(container.querySelector("#app [role=status]")).toBeNull()
    })

    it("shows the sign-in screen or the app, never both", () => {
        const { container } = render(<App />)
        const hidden = () => [container.querySelector<HTMLElement>("#signin")!.hidden, container.querySelector<HTMLElement>("#app")!.hidden]
        act(() => showSignInState({}))
        expect(hidden()).toEqual([false, true])
        act(() => showApp())
        expect(hidden()).toEqual([true, false])
    })
})
