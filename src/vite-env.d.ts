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
}
