// The sidebar on narrow screens slides over the page. Closed, it is inert, so Tab does not
// wander through it off-screen; open, it takes focus, the page behind is inert, and the
// scrim shows (unless the sheet, which owns the scrim while open, is up). Escape (keyboard.ts),
// the scrim and a click outside close it.

import { notify } from "@/bridge"
import { getSheet } from "./overlay"

const QUERY = "(max-width:900px)"
export const narrow = () => typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null
const isNarrow = () => !!narrow()?.matches
const el = (id: string) => document.getElementById(id)

export function setSide(open: boolean) {
    const side = el("side"), btn = el("menuBtn")
    if (!side) return
    side.classList.toggle("on", open)
    side.inert = isNarrow() && !open
    const content = document.querySelector<HTMLElement>(".content")
    if (content) content.inert = isNarrow() && open
    if (!getSheet()) el("scrim")?.classList.toggle("on", isNarrow() && open)
    notify()   /* the top bar's menu button reads .on for aria-expanded */
    if (open) side.querySelector<HTMLElement>("button, input")?.focus()
    else if (side.contains(document.activeElement)) btn?.focus()
}

export const sideOpen = () => !!el("side")?.classList.contains("on")

/** At boot: closed, closed again when the width crosses the line, and closed by the scrim. */
export function watchSidebar() {
    narrow()?.addEventListener("change", () => setSide(false))
    setSide(false)
    /* the sheet takes its own scrim clicks first */
    el("scrim")?.addEventListener("click", () => { if (sideOpen()) setSide(false) })
}
