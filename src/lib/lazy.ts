// Pages and sheets that load on first use, so the first screen parses less code.
// Each one's `preload()` fetches it ahead of time: the saved view at once, and every
// one when the browser is idle after the app shows (src/data/session.ts).

import { createElement, use, type ComponentType } from "react"
import { MINUTE_MS } from "./time"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each page and sheet has its own props
type Any = ComponentType<any>

const all: Array<() => Promise<unknown>> = []

/**
 * A named export from a module loaded on first render, with `preload()`. Unlike
 * React.lazy, once the module is here it draws at once, without a suspended frame.
 * Render it inside <Suspense>. `idle: false` leaves it out of preloadAll: a page only some
 * people can open (Admin) loads when it is first shown, and not for everyone else.
 */
export function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K, { idle = true }: { idle?: boolean } = {}) {
    let mod: M | null = null
    let loading: Promise<M> | null = null
    const preload = () => (loading ||= load().then((m) => (mod = m), (e) => { loading = null; throw e }))
    function Lazy(props: object) {
        return createElement((mod ?? use(preload()))[name] as Any, props)
    }
    if (idle) all.push(preload)
    return Object.assign(Lazy, { preload }) as unknown as M[K] & { preload: () => Promise<M> }
}

/** Every page and sheet made with lazyNamed, loaded; the tests await it (src/test-setup.ts). */
export const preloadAll = () => Promise.all(all.map((load) => load()))

/** Fetch every page and sheet once the browser has nothing else to do. */
export function preloadIdle() {
    const run = () => { preloadAll().catch(() => {}) }
    if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 })
    else setTimeout(run, 1000)
}

/* A release's chunk can be gone when this page is older than the deploy and the
   service worker never cached it: load the new release instead, at most once a minute. */
if (typeof window !== "undefined") {
    window.addEventListener("vite:preloadError", (e) => {
        try {
            if (Date.now() - Number(sessionStorage.getItem("rounds.reloadedAt") || 0) < MINUTE_MS) return
            sessionStorage.setItem("rounds.reloadedAt", String(Date.now()))
        } catch { return }
        e.preventDefault()
        location.reload()
    })
}
