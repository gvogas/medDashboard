// The keyboard shortcuts panel: opened by ? and Settings' button, closed by ?, Esc, ✕ or a
// click outside. <Overlays> draws it; while it is up, cover() keeps everything else inert,
// and when it goes, focus goes back to where it was (or its successor after a redraw).

import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { refind } from "@/lib/dom"
import { createEmitter } from "@/lib/store"
import { cover } from "./overlay"

let open = false
let back: Element | null = null
const { subscribe, emit } = createEmitter()

export const keysOpen = () => open
export const useKeys = () => useSyncExternalStore(subscribe, keysOpen)

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
