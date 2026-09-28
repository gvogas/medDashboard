// Which screen shows, the sign-in form or the app, and what the form shows: the last
// error and the username to keep. session.ts decides; nothing shows until boot has found
// out whether an account is signed in. <SignIn /> reads the form's part.

import { useSyncExternalStore } from "react"

export type Screen = "none" | "signin" | "app"

export interface SignInState {
    screen: Screen
    error: string
    username: string
    /** Bumped each time the screen is shown, so the form resets and takes focus again. */
    shown: number
}

let state: SignInState = { screen: "none", error: "", username: "", shown: 0 }
const listeners = new Set<() => void>()

function set(next: SignInState) {
    state = next
    /* the containers in index.html, until the app renders them from this */
    const signin = document.getElementById("signin"), app = document.getElementById("app")
    if (signin) signin.hidden = state.screen !== "signin"
    if (app) app.hidden = state.screen !== "app"
    for (const fn of listeners) fn()
}

/** Show the sign-in form, with a reason and the username to keep. */
export function showSignInState({ error = "", username = "" }: { error?: string; username?: string } = {}) {
    set({ screen: "signin", error, username, shown: state.shown + 1 })
}

/** Signed in: the app shows. */
export function showApp() {
    set({ ...state, screen: "app" })
}

export const getScreen = () => state.screen

function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

export function useSignInState(): SignInState {
    return useSyncExternalStore(subscribe, () => state)
}
