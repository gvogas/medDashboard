// Sign in with Apple in the app and on the website (worker/apple.js). The plugin shows Apple's
// own sheet in the app and Apple's popup on the web; either way we get an identity token that
// carries the nonce the Worker gave us, and the Worker checks it.
//
// The app signs in as its bundle id; the website as the Services ID in VITE_APPLE_WEB_CLIENT_ID.
// Without one, the website shows no Apple button.

import { NATIVE } from "@/core/native"
import { api } from "@/core/api"

const APP_ID = import.meta.env.VITE_APPLE_APP_ID || "net.vogas.term"
const WEB_ID = import.meta.env.VITE_APPLE_WEB_CLIENT_ID || ""

/** The client id this build signs in as, or "" when it has none. */
export const appleClientId = (): string => (NATIVE ? APP_ID : WEB_ID)
export const appleAvailable = (): boolean => !!appleClientId()

/** What the Worker needs from one Apple sign-in. */
export interface AppleCredential { idToken: string; nonce: string; authorizationCode: string; givenName: string | null; familyName: string | null }

/** Apple's sheet or popup: the credential, or null when the person cancelled. */
export async function appleCredential(): Promise<AppleCredential | null> {
    const [{ AppleSignIn, SignInScope }, { nonce }] = await Promise.all([import("@capawesome/capacitor-apple-sign-in"), api.appleNonce()])
    await AppleSignIn.initialize({ clientId: appleClientId() })
    try {
        const r = await AppleSignIn.signIn({ scopes: [SignInScope.Email, SignInScope.FullName], nonce, redirectUrl: NATIVE ? undefined : location.origin + "/" })
        return { idToken: r.idToken, nonce, authorizationCode: r.authorizationCode, givenName: r.givenName, familyName: r.familyName }
    } catch (e) {
        const err = e as { code?: string; error?: string; message?: string }
        if (err?.code === "SIGN_IN_CANCELED" || err?.error === "popup_closed_by_user" || /cancel/i.test(err?.message || "")) return null
        throw e
    }
}
