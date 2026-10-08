/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** "1" in the iPhone/Mac build (npm run build:ios). */
    readonly VITE_NATIVE?: string
    /** The Worker the app talks to; the live site by default. */
    readonly VITE_API_BASE?: string
    /** The app's version, from package.json at build time. */
    readonly VITE_APP_VERSION?: string
    /** RevenueCat's public iOS SDK key (it is meant to ship in the app). */
    readonly VITE_REVENUECAT_IOS_KEY?: string
    /** Sign in with Apple in the app: its bundle id, from app.config.json; unset, no Apple button. */
    readonly VITE_APPLE_APP_ID?: string
    /** Sign in with Apple on the website: the Services ID. Unset, the website has no Apple button. */
    readonly VITE_APPLE_WEB_CLIENT_ID?: string
}
