// A theme or background change asks the ornament (components/ornament.tsx) to redraw: its
// stroke colour and art come from <html>'s attributes and CSS, which React does not see
// change. setTheme and setBg call redrawOrnament(); the canvas redraws on useOrnamentTurn().

import { useSyncExternalStore } from "react"

let asked = 0
const listeners = new Set<() => void>()

/** Redraw the ornament. */
export function redrawOrnament() {
    asked++
    for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

/** Changes each time a redraw is asked for. */
export const useOrnamentTurn = () => useSyncExternalStore(subscribe, () => asked)
