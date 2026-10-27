// The sidebar on narrow screens slides over the page. Closed, it is inert, so Tab does not
// wander through it off-screen; open, it takes focus, the page behind is inert, and the
// scrim shows (the sheet owns the scrim while it is open). Escape (keyboard.ts), the scrim
// and a click outside close it. <App> draws #side, .content and the scrim from useSide().

import { notify } from "@/bridge"
import { createStore } from "@/lib/store"

const QUERY = "(max-width:900px)"
const narrow = () => typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null
const isDrawer = () => !!narrow()?.matches

export interface SideState {
    open: boolean
    /** the screen was narrow when it last opened or closed: only then is anything inert */
    narrow: boolean
    /** where focus goes once it is drawn: into the sidebar, back to the menu button, or nowhere */
    focus: "side" | "menu" | null
    /** bumped by every setSide(), so a request to focus is seen even when `open` stays the same */
    turn: number
}

const store = createStore<SideState>({ open: false, narrow: false, focus: null, turn: 0 })

export function setSide(open: boolean) {
    const had = !!document.getElementById("side")?.contains(document.activeElement)
    store.set({ open, narrow: isDrawer(), focus: open ? "side" : had ? "menu" : null, turn: store.get().turn + 1 })
    notify()
}

export const sideOpen = () => store.get().open

export const useSide = store.use

/** Once the sidebar is drawn open or closed: focus its first control, or the menu button. */
export function focusAfterSide(s: SideState) {
    if (s.focus === "side") document.getElementById("side")?.querySelector<HTMLElement>("button, input")?.focus()
    else if (s.focus === "menu") document.getElementById("menuBtn")?.focus()
}

/** At boot: closed, and closed again when the width crosses the line. */
export function watchSidebar() {
    narrow()?.addEventListener("change", () => setSide(false))
    setSide(false)
}
