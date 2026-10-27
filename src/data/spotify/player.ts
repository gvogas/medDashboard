// Polls the Worker for what is playing on the signed-in user's Spotify and sends
// the controls. Owns one timer and the last state; the badge and the views only render it.

import { api, ApiError, retryDelayMs } from "@/core/api"
import * as web from "./web-player"
import { changed } from "./signal"
import { ui } from "@/data/ui"
import { subscribe as onUi } from "@/bridge"
import type { PlayerState } from "./types"

export const state: PlayerState = {
    connected: false, playing: false, track: null, device: null, deviceId: null,
    volume: null, supportsVolume: false, shuffle: false, repeat: "off",
    stale: false, error: null, loaded: false,
}

/** What a poll answers: /api/spotify/status or /api/spotify/player. */
type Answer = Partial<Omit<PlayerState, "stale" | "error" | "loaded">>
/** "state" when something changed, "tick" when only the progress moved on. */
export type StateKind = "state" | "tick"
export type Control = "play" | "pause" | "next" | "previous" | "restart"

const ERROR_SHOWN_MS = 4000
const AFTER_CONTROL_MS = 300

let active = false
let timer: ReturnType<typeof setTimeout> | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let errorTimer: ReturnType<typeof setTimeout> | null = null
let polledAt = 0
let baseProgress = 0
let listener: (s: PlayerState, kind: StateKind) => void = () => {}
let onSignedOut = () => {}
let wired = false
let generation = 0

/** 10 s while playing (the progress line ticks locally between polls), 20 s when
    connected but quiet, null when not connected. Each poll is a D1 write, so with the music
    out of sight (only the sidebar's player shows) it is 30 s and 60 s, and while playing it
    asks again just after the track should end, for the next one's title. */
export function nextDelayMs(s: { connected: boolean; playing?: boolean; track?: { progressMs: number; durationMs: number } | null }, shown = true): number | null {
    if (!s.connected) return null
    if (shown) return s.playing ? 10000 : 20000
    if (!s.playing) return 60000
    const left = s.track ? s.track.durationMs - s.track.progressMs + 1500 : Infinity
    return Math.max(5000, Math.min(30000, left))
}

/** The Music page or the focus screen's music panel is up. */
const musicShown = () => ui.view === "spotify" || ui.focusMusic

/** boot.ts's one callback; React reads through useSpotify(). */
export function onState(fn: (s: PlayerState, kind: StateKind) => void) { listener = fn }
export function onUnauthenticated(fn: () => void) { onSignedOut = fn }

function emit(kind: StateKind) {
    listener(state, kind)
    changed(kind === "tick")
}

function canPoll() {
    return active && document.visibilityState === "visible" && navigator.onLine !== false
}

function schedule(ms: number | null) {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (ms == null || !active) return
    timer = setTimeout(poll, ms)
}

function apply(s: Answer) {
    state.connected = !!s.connected
    state.playing = !!s.playing
    state.track = s.track || null
    state.device = s.device || null
    state.deviceId = s.deviceId || null
    state.volume = typeof s.volume === "number" ? s.volume : null
    state.supportsVolume = !!s.supportsVolume
    state.shuffle = !!s.shuffle
    state.repeat = s.repeat || "off"
    state.stale = false
    state.loaded = true
    polledAt = Date.now()
    baseProgress = state.track ? state.track.progressMs : 0
}

export async function poll() {
    if (timer !== null) clearTimeout(timer)
    if (!canPoll()) return
    const started = generation
    try {
        if (!state.loaded) {
            const connection = await api.spotifyStatus()
            if (started !== generation || !active) return
            apply(connection)
            emit("state")
            if (!connection.connected) { schedule(null); return }
        }
        const result = await api.spotifyPlayer()
        if (started !== generation || !active) return
        apply(result)
        emit("state")
        schedule(nextDelayMs(state, musicShown()))
    } catch (e) {
        if (started !== generation || !active) return
        if (e instanceof ApiError && e.status === 401) { stop(); onSignedOut(); return }
        state.stale = true
        emit("state")
        schedule(retryDelayMs(e))
    }
}

/* Between polls the progress line keeps moving on its own, while the tab is in sight: it
   is worked out from the last poll, so a tab that comes back shows the right place at once. */
function tick() {
    if (document.visibilityState === "hidden") return
    if (!state.playing || !state.track || state.stale) return
    state.track.progressMs = Math.min(state.track.durationMs, baseProgress + (Date.now() - polledAt))
    emit("tick")
}

function startTicker() {
    if (ticker === null) ticker = setInterval(tick, 1000)
}

function stopTicker() {
    if (ticker !== null) clearInterval(ticker)
    ticker = null
}

function wire() {
    if (wired) return
    wired = true
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { stopTicker(); return }
        if (active) { startTicker(); tick() }
        poll()
    })
    window.addEventListener("online", poll)
    /* the music coming into sight asks at once, rather than at the slower pace's next turn */
    let shown = musicShown()
    onUi(() => {
        const now = musicShown()
        if (now && !shown && state.connected) poll()
        shown = now
    })
}

export function start() {
    if (active) return
    active = true
    wire()
    stopTicker()
    if (document.visibilityState !== "hidden") startTicker()
    poll()
}

export function stop() {
    generation++
    active = false
    if (timer !== null) clearTimeout(timer)
    timer = null
    stopTicker()
    if (errorTimer !== null) clearTimeout(errorTimer)
    errorTimer = null
    Object.assign(state, { connected: false, playing: false, track: null, device: null, deviceId: null, volume: null, supportsVolume: false, shuffle: false, repeat: "off", stale: false, error: null, loaded: false })
    changed()
}

export function disconnected() {
    apply({ connected: false })
    emit("state")
    schedule(null)
}

function showError(code: string) {
    state.error = code
    emit("state")
    if (errorTimer !== null) clearTimeout(errorTimer)
    errorTimer = setTimeout(() => { state.error = null; emit("state") }, ERROR_SHOWN_MS)
}

const noDevice = (e: unknown) => e instanceof ApiError && e.status === 404 && e.body?.error === "no_device"

/**
 * Send a command with `send(deviceId)`. When Spotify has no active device and the
 * Rounds tab can play, send it once more to the Rounds device. `nothing` is the
 * error code for a second 404, when Rounds has nothing to play.
 */
export async function onRoundsIfIdle<T>(send: (deviceId: string | null) => Promise<T>, nothing = "no_device"): Promise<T> {
    try {
        return await send(null)
    } catch (e) {
        if (!noDevice(e) || web.state.status !== "ready" || !web.state.deviceId) throw e
    }
    try {
        return await send(web.state.deviceId)
    } catch (e) {
        throw e instanceof ApiError && e.status === 404 ? new ApiError(404, { error: nothing }) : e
    }
}

/* A command failed: sign out, forget the connection, or say why in the badge. False when there is nothing more to do. */
function failed(e: unknown) {
    if (e instanceof ApiError && e.status === 401) { stop(); onSignedOut(); return false }
    if (e instanceof ApiError && e.status === 409) { disconnected(); return false }
    showError(e instanceof ApiError ? (e.body?.error || "spotify_unavailable") : "offline")
    return true
}

/** One of play, pause, next, previous, restart. Never throws; failures show in the badge. */
export async function control(action: Control) {
    if (action === "play" || action === "pause") {          /* answer the click before Spotify does */
        state.playing = action === "play"
        polledAt = Date.now()
        baseProgress = state.track ? state.track.progressMs : 0
        emit("state")
    }
    try {
        await onRoundsIfIdle((deviceId) => api.spotifyControl(action, deviceId), "nothing_to_resume")
    } catch (e) {
        if (!failed(e)) return
    }
    schedule(AFTER_CONTROL_MS)
}

/** Move what is playing on another device into the Rounds tab. */
export async function playHere() {
    if (web.state.status !== "ready") return
    web.activate()
    try {
        await api.spotifyTransfer(web.state.deviceId)
    } catch (e) {
        if (!failed(e)) return
    }
    schedule(AFTER_CONTROL_MS)
}

/** Like the Spotify app: previous restarts the track once it is a few seconds in. */
export function previous() {
    return control(state.track && state.track.progressMs > 3000 ? "restart" : "previous")
}
