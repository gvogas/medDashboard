// What the sign-in screen shows: the last error and the username to keep. session.js
// decides when the screen appears (legacy/js/views/signin.js); <SignIn /> reads this.

import { useSyncExternalStore } from "react"

export interface SignInState {
    error: string
    username: string
    /** Bumped each time the screen is shown, so the form resets and takes focus again. */
    shown: number
}

let state: SignInState = { error: "", username: "", shown: 0 }
const listeners = new Set<() => void>()

export function showSignInState({ error = "", username = "" }: { error?: string; username?: string } = {}) {
    state = { error, username, shown: state.shown + 1 }
    for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

export function useSignInState(): SignInState {
    return useSyncExternalStore(subscribe, () => state)
}
