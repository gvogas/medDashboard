// The keyboard: single-key shortcuts, Escape closing whatever is on top, and / for the
// search box.

import { isTyping } from "@/lib/dom"
import { getSheet, requestCloseSheet } from "./overlay"
import { setSide, sideOpen } from "./sidebar"
import { openKeys, closeKeys, keysOpen } from "./keys"
import { getBusy } from "./ai-read"
import { getScreen } from "./signin"
import { setView } from "./study-controller"
import { escapeFocus } from "./study-timer"
import { newItem, goToday, step } from "./actions"
import { ui } from "./ui"
import type { View } from "./types"
import { activeBuddy } from "./buddy"
import { maintenanceState } from "./maintenance"

/* Single keys, when nothing is being typed and no drawer or the focus screen is up:
   the list is components/overlays.tsx. Each does what its top-bar button does; a number shows a view. */
const VIEW_KEYS: Record<string, View> = { 1: "week", 2: "month", 3: "table", 4: "study", 5: "spotify", 6: "buddy" }
/* 6 opens the Buddy page only while gameplay is on (and the buddy is not switched off) */
const viewKey = (k: string): View | null => (k === "6" && !(activeBuddy() && maintenanceState("buddy") !== "blocked") ? null : VIEW_KEYS[k] ?? null)
function shortcut(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null
    /* a part of the page that used the key keeps it: the flashcard review's 1, 2 and 3 grade a card, they don't switch pages */
    if (e.defaultPrevented) return false
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(target) || target?.isContentEditable) return false
    if (getBusy()) return false
    if (e.key === "?") { if (keysOpen()) closeKeys(); else openKeys(); e.preventDefault(); return true }
    if (keysOpen() || ui.focus || getSheet() || getScreen() !== "app") return false
    const run = (fn: () => void) => { e.preventDefault(); fn(); return true }
    if (e.key === "n") return run(newItem)
    if (e.key === "t") return run(goToday)
    if ((e.key === "[" || e.key === "]") && (ui.view === "week" || ui.view === "month")) return run(() => step(e.key === "[" ? -1 : 1))
    { const v = viewKey(e.key); if (v) return run(() => setView(v)) }
    return false
}

export async function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        if (e.defaultPrevented) return   /* a field used it, like the time picker closing its list */
        /* a file being read: Escape cancels it wherever focus is (the card takes it itself when focus is inside) */
        const busy = getBusy()
        if (busy) { busy.cancel(); return }
        if (keysOpen()) { closeKeys(); return }
        if (sideOpen()) { setSide(false); return }
        /* the sheet takes Escape itself when focus is inside it; this is for when it is not */
        if (getSheet()) { requestCloseSheet(); return }
        if (ui.focus) escapeFocus()          /* the music panel first, then the focus screen */
        return
    }
    if (shortcut(e)) return
    /* The focus screen takes Space, M and / itself (components/focus/focus-screen.tsx). */
    if (ui.focus) return
    const tag = (e.target as Element | null)?.tagName ?? ""
    if (e.key === "/" && !e.defaultPrevented && !/input|textarea|select/i.test(tag)) {
        e.preventDefault(); document.getElementById("search")?.focus(); return   /* the top bar's search box */
    }
}
