// Boot, sign-in and sign-out: opening the account's local store, starting sync and
// Spotify, and starting over when the account changes in another tab.

import { api, ApiError, resetRequests, bindAccount } from "@/core/api"
import * as store from "@/core/store"
import { data, type ServerProfile, type StoreEvent } from "@/core/store"
import * as sync from "@/core/sync"
import { notify } from "@/bridge"
import * as spotify from "./spotify/player"
import * as web from "./spotify/web-player"
import { closeSheet } from "./overlay"
import { forgetReads, keepReadsFor } from "./ai-cache"
import { resetFriends } from "./friends"
import { toast } from "./toast"
import { applyCoat } from "./settings"
import { openSettings } from "./actions"
import { showApp, showSignInState } from "./signin"
import * as run from "./run"
import { setTheme, setBg } from "./theme"
import { celebrateStudy, celebrateAchievements, finishDelete, commitUndo } from "./study-controller"
import { refreshAfterSync } from "./sync-status"
import { ui } from "./ui"
import { preloadIdle } from "@/lib/lazy"
import { openJoin } from "./classes"
import { setUnread } from "./inbox"
import { forgetDevice } from "./push"

function rememberedSession(): ServerProfile | null {
    try { return JSON.parse(localStorage.getItem("rounds.session") || "null") } catch { return null }
}

export async function boot() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {})
    const profile = await sync.startingProfile(rememberedSession())
    if (profile) { try { await start(profile) } catch (e) { showSignIn((e as Error).message) } } else showSignIn()
}

async function start(profile: ServerProfile) {
    bindAccount(profile.id)
    /* answers another account's reads left on this device go */
    keepReadsFor(profile.id)
    await store.open(profile)
    showApp()
    const p = data.profile!
    setTheme(p.theme || ui.theme, { persist: false })
    setBg(p.bg || ui.bg, { persist: false })
    applyCoat(p)
    ui.quoteIx = data.quotes.length ? Math.floor(Math.random() * data.quotes.length) : 0
    await run.load()
    if (run.active()) ui.focus = true       /* a run this device was in the middle of */
    notify()
    celebrateStudy()                             /* the first look only records where today stands */
    celebrateAchievements()
    sync.onUnread(setUnread)
    sync.init()
    sync.syncNow()
    spotify.start()
    preloadIdle()                                /* the other pages and the sheets */
    const back = spotifyReturn()
    if (back) { ui.spotifyNote = back; openSettings("spotifyGrp") }
    /* a join link's code */
    const join = joinReturn()
    if (join) openJoin(join)
}

/* Spotify's consent page sends the browser back to /#spotify=connected or =error. */
function spotifyReturn(): "connected" | "error" | null {
    const m = location.hash.match(/^#spotify=(connected|error)$/)
    if (!m) return null
    history.replaceState(null, "", location.pathname + location.search)
    return m[1] as "connected" | "error"
}

/* A join link, /#join=<code> (spec §11): read once and cleared, so the code stays out of the
   history and never reaches the server. The join sheet checks it. */
function joinReturn(): string | null {
    const m = location.hash.match(/^#join=(.{0,32})$/)
    if (!m) return null
    history.replaceState(null, "", location.pathname + location.search)
    return m[1]
}

/** What the store reports: a change, a failed save, a sign-out, another tab's edit. */
export function onStoreEvent(evt: StoreEvent) {
    if (evt.type === "change" && data.profile) { celebrateStudy(); celebrateAchievements() }
    if (evt.type === "save-error") toast("The change could not be saved on this device. " + evt.message, { error: true, ms: 10000 })
    if (evt.type === "signed-out") { sync.stop(); spotify.stop(); web.stop(); resetRequests(); forgetReads(); resetFriends(); location.reload() }
    if (evt.type === "remote" && data.profile) refreshAfterSync()
    if ((evt.type === "synced" || evt.type === "remote") && data.profile) celebrateAchievements({ quiet: true })
}

/* Another tab signed in as someone else, or out: this one starts over. */
export function onStorage(event: StorageEvent) {
    if (event.key !== "rounds.session" || !data.profile) return
    let id: string | undefined
    try { id = JSON.parse(event.newValue || "null")?.id } catch {}
    if (id !== data.profile.id) {
        sync.stop(); spotify.stop(); web.stop(); resetRequests(); forgetReads(); resetFriends()
        store.close().finally(() => location.reload())
    }
}

export function showSignIn(error = "", username = "") {
    showSignInState({ error, username })
}

/* With unsynced edits or saved copies on this device, the first press asks in Settings;
   the second (`force`) erases them. */
export async function signOut({ everywhere = false, force = false }: { everywhere?: boolean; force?: boolean } = {}) {
    await commitUndo()
    await finishDelete()
    await store.reload()
    if (!force && (store.pendingCount() || store.conflicts.length)) { ui.signoutAsk = { everywhere }; notify(); return }
    ui.signoutAsk = null
    sync.stop()
    spotify.stop()
    resetRequests()
    /* the morning digest belongs to the account, not to whoever signs in next */
    await forgetDevice()
    try { await (everywhere ? api.revokeAll() : api.signOut()) }
    catch {
        sync.init()
        spotify.start()
        toast("Sign-out failed. Check your connection and try again.", { error: true, ms: 8000 })
        return
    }
    await sync.drain()
    run.reset()
    const id = data.profile?.id
    spotify.stop()
    web.stop()
    closeSheet()
    forgetReads(); resetFriends()
    if (id) {
        try { await store.wipe(id) }
        catch (e) { alert("You are signed out, but local cleanup is still pending. " + (e as Error).message) }
    } else await store.close()
    location.reload() // Clear every in-memory account cache at the session boundary.
}

/** The sign-in form's submit (src/components/sign-in.tsx). Success reloads the page;
 * a failure shows the form again with the reason. */
export async function signIn(username: string, password: string) {
    username = username.trim()
    try {
        sync.stop()
        spotify.stop()
        resetRequests()
        await api.login(username, password)
        location.reload()
    } catch (err) {
        showSignIn(!(err instanceof ApiError) ? "You seem to be offline."
            : err.status === 401 ? "Wrong username or password."
            : err.status === 429 ? "Too many attempts. Try again in " + Math.max(1, Math.ceil((Number(err.body?.retryAfter) || 60) / 60)) + " min."
            : err.status === 403 ? "Sign in from the app itself, not from another site."
            : "Sign-in failed (" + (err.body?.error || err.status) + ").", username)
    }
}
