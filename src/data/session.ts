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
import { resetRoom } from "./room"
import { resetRecords } from "./record"
import { toast, TOAST_LONG_MS } from "./toast"
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
    sync.setOnUnread(setUnread)
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

/* Spotify's consent page sends the browser back to /#spotify=connected, =error or =denied. */
function spotifyReturn(): "connected" | "error" | "denied" | null {
    const m = location.hash.match(/^#spotify=(connected|error|denied)$/)
    if (!m) return null
    history.replaceState(null, "", location.pathname + location.search)
    return m[1] as "connected" | "error" | "denied"
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
    if (evt.type === "signed-out") { sync.stop(); spotify.stop(); web.stop(); resetRequests(); forgetReads(); resetFriends(); resetRoom(); resetRecords(); location.reload() }
    if (evt.type === "remote" && data.profile) refreshAfterSync()
    if ((evt.type === "synced" || evt.type === "remote") && data.profile) celebrateAchievements({ quiet: true })
}

/* Another tab signed in as someone else, or out: this one starts over. */
export function onStorage(event: StorageEvent) {
    if (event.key !== "rounds.session" || !data.profile) return
    let id: string | undefined
    try { id = JSON.parse(event.newValue || "null")?.id } catch {}
    if (id !== data.profile.id) {
        sync.stop(); spotify.stop(); web.stop(); resetRequests(); forgetReads(); resetFriends(); resetRoom(); resetRecords()
        store.close().finally(() => location.reload())
    }
}

export function showSignIn(error = "", username = "", lockedUntil = 0, captchaSiteKey = "") {
    showSignInState({ error, username, lockedUntil, captchaSiteKey })
}

/* With unsynced edits or saved copies on this device, the first press asks in Settings;
   the second (`force`) erases them. */
export async function signOut({ everywhere = false, force = false }: { everywhere?: boolean; force?: boolean } = {}) {
    await commitUndo()
    await finishDelete()
    await store.reload()
    const unsynced = Boolean(store.pendingCount() || store.conflicts.length), timer = run.active()
    if (!force && (unsynced || timer)) { ui.signoutAsk = { everywhere, unsynced, timer }; notify(); return }
    ui.signoutAsk = null
    /* a run in progress is saved, and its session uploaded, while the account still works: after the revoke nothing can be sent, and the wipe takes the local copy. A sign-out that then fails keeps the saved session. */
    await run.stop()
    await sync.syncNow()
    /* the timer prompt never said its time would be erased: if anything is still unsynced after the upload (it failed, or maintenance holds an edit), ask again before the revoke */
    if (!unsynced && (store.pendingCount() || store.conflicts.length)) { ui.signoutAsk = { everywhere, unsynced: true, timer: false }; notify(); return }
    sync.stop()
    spotify.stop()
    resetRequests()
    /* the morning digest belongs to the account, not to whoever signs in next */
    await forgetDevice()
    try { await (everywhere ? api.revokeAll() : api.signOut()) }
    catch {
        sync.init()
        spotify.start()
        toast("Sign-out failed. Check your connection and try again.", { error: true, ms: TOAST_LONG_MS })
        return
    }
    run.reset()
    const id = data.profile?.id
    spotify.stop()
    web.stop()
    closeSheet()
    forgetReads(); resetFriends(); resetRoom(); resetRecords()
    if (id) {
        try { await store.wipe(id) }
        catch {
            toast("You are signed out, but this device still holds this account's data. It will be cleared on your next visit.", { error: true, ms: TOAST_LONG_MS })
            setTimeout(() => location.reload(), TOAST_LONG_MS)
            return
        }
    } else await store.close()
    location.reload() // Clear every in-memory account cache at the session boundary.
}

/* The worker says how many tries are left once they are few (worker/throttle.js). */
function badLogin(triesLeft: unknown): string {
    if (triesLeft === 0) return "Wrong username or password. Sign-in is locked for a short time now."
    if (typeof triesLeft === "number") return "Wrong username or password. " + triesLeft + (triesLeft === 1 ? " try" : " tries") + " left before sign-in locks for a short time."
    return "Wrong username or password."
}

/** The sign-in form's submit (src/components/sign-in.tsx). Success reloads the page;
 * a failure shows the form again with the reason. `captcha` is the Turnstile token, sent only
 * while the name is locked (worker/throttle.js). */
export async function signIn(username: string, password: string, captcha?: string) {
    username = username.trim()
    try {
        sync.stop()
        spotify.stop()
        resetRequests()
        await api.login(username, password, captcha)
        location.reload()
    } catch (err) {
        if (!(err instanceof ApiError)) showSignIn(navigator.onLine === false ? "You seem to be offline." : "Term could not be reached. Try again in a moment.", username)
        else if (err.status === 401) showSignIn(badLogin(err.body?.triesLeft), username)
        else if (err.status === 429) {
            const secs = Number(err.body?.retryAfter) || 60
            const siteKey = typeof err.body?.captchaSiteKey === "string" ? err.body.captchaSiteKey : ""
            const wait = "Sign-in for " + username + " is locked for " + Math.max(1, Math.ceil(secs / 60)) + " min. "
            showSignIn(siteKey ? wait + "Complete the check below to try again now." : wait + "The correct password will not work until then.", username, Date.now() + secs * 1000, siteKey)
        }
        else if (err.status === 403) showSignIn("Sign in from the app itself, not from another site.", username)
        else showSignIn("Sign-in failed (" + (err.body?.error || err.status) + ").", username)
    }
}
