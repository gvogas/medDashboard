// Wires the controllers together and routes the page's events, once, before React mounts.
// The controllers beside the hooks in src/data/ (session, theme, sync-status,
// study-controller, keyboard) decide what happens; notify() tells React to redraw.

import * as store from "@/core/store"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { useTypePrefs } from "@/core/model"
import { notify } from "@/bridge"
import { setSide, sideOpen, watchSidebar } from "@/data/sidebar"
import { flush as flushTyping } from "@/data/item-edit"
import * as spotify from "@/data/spotify/player"
import * as web from "@/data/spotify/web-player"
import { followSystem } from "@/data/theme"
import { refreshAfterSync, runHeldRefresh, pointerPressed, pointerReleased, runReviews } from "@/data/sync-status"
import { boot as openSession, showSignIn, onStoreEvent, onStorage } from "@/data/session"
import { commitUndo, finishDelete } from "@/data/study-controller"
import { onKeydown } from "@/data/keyboard"
// Listen to the store and sync from the start, before any component mounts.
import "@/data/store"
import "@/data/sync"

let booted = false

/** Everything the page listens to, and then the account opens. Runs once. */
export function boot() {
    if (booted) return
    booted = true

    /* what is typed in the item sheet is saved before the page goes */
    window.addEventListener("pagehide", () => { flushTyping() })
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { flushTyping(); commitUndo(); finishDelete().catch(() => {}) } })

    /* ═════════ theme ═════════ */
    useTypePrefs(() => data.profile?.types || [])
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", followSystem)

    /* ═════════ sync ═════════ */
    /* The status shows in the top bar and Settings (src/data/sync.ts listens). */
    sync.onPulled(async () => {
        await runReviews()
        refreshAfterSync()
    })
    document.addEventListener("focusout", runHeldRefresh)
    document.addEventListener("pointerdown", pointerPressed, true)
    for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, pointerReleased, true)
    sync.onUnauthenticated(() => showSignIn("Your session has ended. Sign in again."))

    /* ═════════ Spotify ═════════ */
    /* The sidebar player, the Music page and the focus screen's music
       (components/spotify/, components/focus/) redraw through useSpotify(). */
    spotify.onState((s, kind) => {
        if (kind !== "state") return
        if (s.connected) web.start(); else if (s.loaded) web.stop()     /* the tab is a device only while connected */
        notify()   /* the top bar shows the device, Settings the connection */
    })
    web.onChange(() => {
        notify()   /* Settings says whether this tab is a device */
    })
    spotify.onUnauthenticated(() => showSignIn("Your session has ended. Sign in again."))

    /* ═════════ session ═════════ */
    store.subscribe(onStoreEvent)
    window.addEventListener("storage", onStorage)

    /* ═════════ events ═════════ */
    /* A click outside the phone sidebar closes it. */
    document.addEventListener("click", (e) => {
        const target = e.target as Element
        if (!target.closest("#side") && !target.closest("#menuBtn") && sideOpen()) setSide(false)
    })

    watchSidebar()

    document.addEventListener("keydown", onKeydown)

    openSession()
}
