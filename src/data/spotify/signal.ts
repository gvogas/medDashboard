// One change signal for the whole engine: the poller, the Rounds device, the library and
// the commands call changed() whenever something they hold has moved, and useSpotify()
// redraws on it. The poller's onState and the device's onChange are for the legacy
// wiring in main.js (the Rounds device starting and stopping, the top bar and Settings).

const listeners = new Set<() => void>()
let version = 0

export function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

export function changed() {
    version++
    for (const fn of listeners) fn()
}

/** Bumped by every changed(), so a hook over the engine's objects has a snapshot. */
export const getVersion = () => version
