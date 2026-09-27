// The legacy UI state (legacy/js/state.js) is one object changed in place, with no events.
// Everything that changes it then redraws, and every redraw calls the bridge's notify(),
// whose counter is the snapshot here.

import { useSyncExternalStore } from "react"
import { ui as legacyUi } from "@/legacy/js/state.js"
import { getVersion, subscribe } from "@/bridge"
import type { Ui } from "./types"

export const ui = legacyUi as unknown as Ui

/** Read from the UI state; the component redraws after every legacy redraw. */
export function useUi<T>(select: (ui: Ui) => T): T {
    useSyncExternalStore(subscribe, getVersion)
    return select(ui)
}
