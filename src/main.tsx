// The front end's entry. The legacy app boots as it always has; React components are
// mounted into the places they have taken over. See docs/superpowers/specs/
// 2026-09-27-react-foundation-design.md for the move, stage by stage.

import "./legacy/js/main.js"
// Listen to the store and sync from the start, before any component mounts.
import "./data/store"
import "./data/sync"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ViewDock } from "@/components/view-dock"
import { SignIn } from "@/components/sign-in"
import { Toaster } from "@/components/toaster"

const dock = document.getElementById("viewDock")
if (dock) {
    createRoot(dock).render(
        <StrictMode>
            <ViewDock />
        </StrictMode>
    )
}

/* ── sign-in and toasts ── */
// The sign-in form fills the static #signin, which session.js shows and hides. The
// toaster gets its own container at the end of <body>, outside #app, so a drawer that
// makes #app inert leaves the toast's buttons usable.
const signin = document.getElementById("signin")
if (signin) {
    createRoot(signin).render(
        <StrictMode>
            <SignIn />
        </StrictMode>
    )
}
const toaster = document.body.appendChild(document.createElement("div"))
toaster.id = "toaster"
createRoot(toaster).render(
    <StrictMode>
        <Toaster />
    </StrictMode>
)
