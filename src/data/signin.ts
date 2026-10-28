// Which screen shows, the sign-in form or the app, and what the form shows: the last
// error and the username to keep. session.ts decides; nothing shows until boot has found
// out whether an account is signed in. <App> shows one or the other from useScreen();
// <SignIn /> reads the form's part.

import { useSyncExternalStore } from "react"
import { createStore } from "@/lib/store"

export type Screen = "none" | "signin" | "app"

export interface SignInState {
    screen: Screen
    error: string
    username: string
    /** Epoch ms until which the form is locked after too many attempts; 0 when it is not. */
    lockedUntil: number
    /** The Turnstile site key, when a locked sign-in can be unlocked with a CAPTCHA; "" otherwise. */
    captchaSiteKey: string
    /** Bumped each time the screen is shown, so the form resets and takes focus again. */
    shown: number
}

const store = createStore<SignInState>({ screen: "none", error: "", username: "", lockedUntil: 0, captchaSiteKey: "", shown: 0 })
const { get, set } = store

/** Show the sign-in form, with a reason, the username to keep, any lock, and the CAPTCHA that can lift it. */
export function showSignInState({ error = "", username = "", lockedUntil = 0, captchaSiteKey = "" }: { error?: string; username?: string; lockedUntil?: number; captchaSiteKey?: string } = {}) {
    set({ screen: "signin", error, username, lockedUntil, captchaSiteKey, shown: get().shown + 1 })
}

/** Signed in: the app shows. */
export function showApp() {
    set({ ...get(), screen: "app" })
}

export const getScreen = () => get().screen

export function useScreen(): Screen {
    return useSyncExternalStore(store.subscribe, getScreen)
}

export const useSignInState = store.use
