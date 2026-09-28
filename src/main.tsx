// The front end's entry. boot() wires the controllers and opens the account; React
// components are mounted into index.html's containers. See docs/superpowers/specs/
// 2026-09-27-react-foundation-design.md for the move, stage by stage.

import { boot } from "./boot"
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
import { StudyDock } from "@/components/study/study-dock"
import { Focus } from "@/components/focus/focus-screen"

boot()

function mount(el: Element | null, node: ReactNode) {
    if (el) createRoot(el).render(<StrictMode>{node}</StrictMode>)
}

/* Inside static containers in index.html, whose own attributes are set from
   src/data/: <header class="bar"> (hidden on the focus screen), <aside id="side"> (.on and
   inert on phones, from setSide) and #signin (shown and hidden by signin.ts). */
mount(document.querySelector("header.bar"), <TopBar />)
mount(document.getElementById("side"), <Sidebar />)
mount(document.getElementById("signin"), <SignIn />)
/* #stats and #views: the stat tiles and the week, month, table or Study page (hidden otherwise). */
mount(document.getElementById("stats"), <Stats />)
mount(document.getElementById("views"), <Views />)
/* #sheet: the sheet, for an item, a course, Settings, a study session or an achievement (outside #app, which is inert while it is open) */
mount(document.getElementById("sheet"), <Sheet />)
/* #study-dock: the corner dock during a run, off the focus screen; #focus: the focus screen */
mount(document.getElementById("study-dock"), <StudyDock />)
mount(document.getElementById("focus"), <Focus />)

/* The shortcuts panel and the busy card: over everything, outside #app and #sheet, which
   they make inert while up. */
const overlays = document.body.appendChild(document.createElement("div"))
overlays.id = "overlays"
mount(overlays, <Overlays />)

/* The toaster gets its own container at the end of <body>, outside #app, so the sheet
   that makes #app inert leaves the toast's buttons usable. */
const toaster = document.body.appendChild(document.createElement("div"))
toaster.id = "toaster"
mount(toaster, <Toaster />)
