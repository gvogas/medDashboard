// The front end's entry. The legacy app boots as it always has; React components are
// mounted into the places they have taken over. See docs/superpowers/specs/
// 2026-09-27-react-foundation-design.md for the move, stage by stage.

import "./legacy/js/main.js"
// Listen to the store and sync from the start, before any component mounts.
import "./data/store"
import "./data/sync"
import { StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { TopBar } from "@/components/top-bar"
import { Sidebar } from "@/components/sidebar"
import { SignIn } from "@/components/sign-in"
import { Toaster } from "@/components/toaster"
import { Stats } from "@/components/views/stats"
import { Views } from "@/components/views/views"
import { Sheet } from "@/components/sheet/sheet"
import { Overlays } from "@/components/overlays"

function mount(el: Element | null, node: ReactNode) {
    if (el) createRoot(el).render(<StrictMode>{node}</StrictMode>)
}

/* Inside static containers in index.html, whose own attributes stay with the legacy
   code: <header class="bar"> (hidden on the focus screen), <aside id="side"> (.on and
   inert on phones, from setSide) and #signin (shown and hidden by session.js). */
mount(document.querySelector("header.bar"), <TopBar />)
mount(document.getElementById("side"), <Sidebar />)
mount(document.getElementById("signin"), <SignIn />)
/* #stats and #views: the stat tiles and the week, month or table (hidden otherwise). */
mount(document.getElementById("stats"), <Stats />)
mount(document.getElementById("views"), <Views />)
/* #sheet: the item and course sheet, beside the legacy #drawer (outside #app, which is inert while it is open) */
mount(document.getElementById("sheet"), <Sheet />)

/* The shortcuts panel and the busy card: over everything, outside #app and #sheet, which
   they make inert while up. */
const overlays = document.body.appendChild(document.createElement("div"))
overlays.id = "overlays"
mount(overlays, <Overlays />)

/* The toaster gets its own container at the end of <body>, outside #app, so a drawer
   that makes #app inert leaves the toast's buttons usable. */
const toaster = document.body.appendChild(document.createElement("div"))
toaster.id = "toaster"
mount(toaster, <Toaster />)
