// The front end's entry. The legacy app boots as it always has; React components are
// mounted into the places they have taken over. See docs/superpowers/specs/
// 2026-09-27-react-foundation-design.md for the move, stage by stage.

import "./legacy/js/main.js"
// Listen to the store and sync from the start, before any component mounts.
import "./data/store"
import "./data/sync"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TopBar } from "@/components/top-bar"

/* ── the top bar (with the view dock), inside <header class="bar"> ── */
const bar = document.querySelector("header.bar")
if (bar) {
    createRoot(bar).render(
        <StrictMode>
            <TopBar />
        </StrictMode>
    )
}
