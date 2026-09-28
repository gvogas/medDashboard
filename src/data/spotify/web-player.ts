// The Rounds tab as a Spotify device, through Spotify's Web Playback SDK. The SDK is
// loaded once the user is connected and asks the Worker for a short-lived token; the
// refresh token never reaches the page. Rounds only plays here after a click.
// See docs/superpowers/specs/2026-09-22-spotify-web-playback-design.md.

import { api } from "@/core/api"
import { changed } from "./signal"
import type { WebState, WebStatus } from "./types"

const SDK = "https://sdk.scdn.co/spotify-player.js"
const NAME = "Rounds"

/* The little of the SDK this file uses. */
interface SdkPlayer {
    addListener(event: string, fn: (e: { device_id: string }) => void): void
    connect(): void
    disconnect(): void
    activateElement?: () => void
}
interface SdkWindow {
    Spotify?: { Player: new (options: { name: string; volume: number; getOAuthToken: (give: (token: string) => void) => void }) => SdkPlayer }
    onSpotifyWebPlaybackSDKReady?: () => void
}
const sdkWindow = () => window as unknown as SdkWindow

/** status: off, loading, ready, unsupported, needs_reconnect or no_premium. */
export const state: WebState = { status: "off", deviceId: null }

let player: SdkPlayer | null = null
let listener: (s: WebState) => void = () => {}

/** boot.ts's one callback; React reads through useSpotify(). */
export function onChange(fn: (s: WebState) => void) { listener = fn }

function set(status: WebStatus, deviceId: string | null = null) {
    if (state.status === status && state.deviceId === deviceId) return
    state.status = status
    state.deviceId = deviceId
    listener(state)
    changed()
}

/**
 * Where a click should send music: 'here' when the Rounds device is ready and nothing
 * else is active, 'offer' when music is on another device, null otherwise.
 */
export function playTarget(poller: { deviceId: string | null }, web: WebState | null | undefined): "here" | "offer" | null {
    if (!web || web.status !== "ready" || !web.deviceId) return null
    if (!poller.deviceId) return "here"
    return poller.deviceId === web.deviceId ? null : "offer"
}

/* Spotify does not support the SDK in phone browsers. */
function isPhone() {
    const data = (navigator as Navigator & { userAgentData?: { mobile?: unknown } }).userAgentData
    if (data && typeof data.mobile === "boolean") return data.mobile
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")
}

function create() {
    const w = sdkWindow()
    if (state.status !== "loading" || player || !w.Spotify) return
    player = new w.Spotify.Player({
        name: NAME,
        volume: 0.8,
        getOAuthToken: (give) => { api.spotifyToken().then((t: { token: string }) => give(t.token)).catch(() => {}) },
    })
    player.addListener("ready", ({ device_id }) => set("ready", device_id))
    player.addListener("not_ready", () => set("loading"))
    player.addListener("initialization_error", () => set("unsupported"))
    player.addListener("authentication_error", () => set("needs_reconnect"))
    player.addListener("account_error", () => set("no_premium"))
    player.connect()
}

/** Load the SDK and register the device. Safe to call again; does nothing once started. */
export function start() {
    if (state.status !== "off") return
    if (isPhone()) { set("unsupported"); return }
    set("loading")
    const w = sdkWindow()
    if (w.Spotify) { create(); return }
    w.onSpotifyWebPlaybackSDKReady = create
    if (document.querySelector(`script[src="${SDK}"]`)) return
    const s = document.createElement("script")
    s.src = SDK
    s.async = true
    s.onerror = () => { s.remove(); if (state.status === "loading") set("unsupported") }
    document.head.appendChild(s)
}

/** Call inside a click, before any await, so the browser lets the tab make sound. */
export function activate() {
    try { if (player && player.activateElement) player.activateElement() } catch {}
}

/** On sign-out or disconnect: drop the device. */
export function stop() {
    if (player) { try { player.disconnect() } catch {} player = null }
    set("off")
}
