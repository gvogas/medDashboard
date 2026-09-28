// One change signal for the whole engine: the poller, the Rounds device, the library and
// the commands call changed() whenever something they hold has moved, and useSpotify()
// redraws on it. The legacy view keeps its own single callbacks (onState, onChange…),
// which each module calls as before; this is only for React.

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
