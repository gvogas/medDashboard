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

const dock = document.getElementById("viewDock")
if (dock) {
    createRoot(dock).render(
        <StrictMode>
            <ViewDock />
        </StrictMode>
    )
}
