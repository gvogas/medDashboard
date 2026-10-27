// The small external store the data modules share: a listener set (createEmitter) and, over it,
// a value that is replaced whole (createStore). Each snapshot is the value itself, so it
// stays the same object until set() or patch() puts in a new one.

import { useSyncExternalStore } from "react"

/** A listener set: subscribe() for useSyncExternalStore, emit() after the module's data has moved. */
export function createEmitter() {
    const listeners = new Set<() => void>()
    return {
        subscribe(fn: () => void) {
            listeners.add(fn)
            return () => { listeners.delete(fn) }
        },
        emit() { for (const fn of listeners) fn() },
    }
}

/** A value with subscribers: set() replaces it, patch() replaces it with a copy that has the changes. */
export function createStore<T extends object>(initial: T) {
    let value = initial
    const { subscribe, emit } = createEmitter()
    const get = () => value
    const set = (next: T) => { value = next; emit() }
    return {
        get,
        set,
        patch: (changes: Partial<T>) => set({ ...value, ...changes }),
        subscribe,
        /** Redraws when the value is replaced. */
        use: () => useSyncExternalStore(subscribe, get),
    }
}
