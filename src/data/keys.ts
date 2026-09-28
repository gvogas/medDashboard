// The keyboard shortcuts panel: opened by ? and Settings' button, closed by ?, Esc, ✕ or a
// click outside. <Overlays> draws it; while it is up, cover() keeps everything else inert,
// and when it goes, focus goes back to where it was (or its successor after a redraw).

import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { refind } from "@/lib/dom"
import { cover } from "./overlay"

let open = false
let back: Element | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }

export const keysOpen = () => open
export const useKeys = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, keysOpen)

export function openKeys() {
    if (open) return
    back = document.activeElement
    open = true
    cover(true)
    emit()
}

export function closeKeys() {
    if (!open) return
    /* drawn now, so the page is no longer inert when focus goes back into it */
    flushSync(() => {
        open = false
        cover(false)
        emit()
    })
    ;(refind(back) as HTMLElement | null)?.focus()
    back = null
}
