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

function mount(el: Element | null, node: ReactNode) {
    if (el) createRoot(el).render(<StrictMode>{node}</StrictMode>)
}

/* Inside static containers in index.html, whose own attributes stay with the legacy
   code: <header class="bar"> (hidden on the focus screen), <aside id="side"> (.on and
   inert on phones, from setSide) and #signin (shown and hidden by session.js). */
mount(document.querySelector("header.bar"), <TopBar />)
mount(document.getElementById("side"), <Sidebar />)
mount(document.getElementById("signin"), <SignIn />)

/* The toaster gets its own container at the end of <body>, outside #app, so a drawer
   that makes #app inert leaves the toast's buttons usable. */
const toaster = document.body.appendChild(document.createElement("div"))
toaster.id = "toaster"
mount(toaster, <Toaster />)
