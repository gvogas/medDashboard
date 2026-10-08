// The iPhone and Mac apps (Capacitor, docs/IOS.md). `npm run build:ios` builds the same front
// end with VITE_NATIVE=1: it is then served from the app's bundle, talks to the live Worker
// at API_BASE, and signs in with a token (worker/app.js) kept here instead of a cookie.

export const NATIVE = import.meta.env.VITE_NATIVE === "1"
export const API_BASE: string = NATIVE ? (import.meta.env.VITE_API_BASE || "https://rounds.termanitor07.workers.dev") : ""
/* sent as x-rounds-app, so the Worker can ask an old build to update */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || "1.0.0"

/* Connecting Spotify is a round trip through the browser: the app opens it on the website. */
export const SPOTIFY_CONNECT = API_BASE + "/api/spotify/connect"

const TOKEN = "rounds.token", DEVICE = "rounds.device"
const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string | null) => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch {}
}

/** The app's session token; null in the browser, which uses its cookie. */
export const sessionToken = (): string | null => (NATIVE ? read(TOKEN) : null)
export const setSessionToken = (token: string | null) => { if (NATIVE) write(TOKEN, token) }
/** The device mark the Worker gave this app at its first sign-in (worker/auth.js trustedMark). */
export const deviceMark = (): string | null => (NATIVE ? read(DEVICE) : null)
export const setDeviceMark = (mark: string) => { if (NATIVE) write(DEVICE, mark) }
