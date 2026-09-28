// What index.html's inline theme script leaves on window before the app loads: the theme
// and background remembered in this browser, and the function that applies a theme.
// Safari before 14.1 names the audio context with its prefix; the run's chime tries both.

export {}

declare global {
    interface Window {
        __roundsTheme?: string
        __roundsBg?: string
        __roundsApplyTheme?: (choice: string) => void
        webkitAudioContext?: typeof AudioContext
    }
}
