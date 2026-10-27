// One change signal for the whole engine: the poller, the Rounds device, the library and
// the commands call changed() whenever something they hold has moved, and useSpotify()
// redraws on it. The poller's onState and the device's onChange are for the
// wiring in boot.ts (the Rounds device starting and stopping, the top bar and Settings).

import { createEmitter } from "@/lib/store"

const { subscribe, emit } = createEmitter()
let version = 0
let steady = 0

export { subscribe }

/** `progressOnly`: the progress line moved and nothing else, so a snapshot can keep the rest. */
export function changed(progressOnly = false) {
    version++
    if (!progressOnly) steady++
    emit()
}

/** Bumped by every changed(), so a hook over the engine's objects has a snapshot. */
export const getVersion = () => version
/** Bumped by every changed() but a progress tick's. */
export const getSteady = () => steady
