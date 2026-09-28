// What the music asks Spotify to do: play, queue, shuffle, repeat, devices and volume.
// Shuffle, repeat and the volume answer the click before Spotify does; the state changes
// here and whoever draws it follows (React through useSpotify(), the legacy view through
// onControls).

import { api } from "@/legacy/js/api.js"
import { state as player, poll, onRoundsIfIdle } from "./player"
import { state as web } from "./web-player"
import { cache, rerender, say, explain, load, queueChanged, playFrom } from "./library"
import { changed } from "./signal"
import type { Device, Repeat } from "./types"

let legacySync = () => {}

/** The legacy view's one callback for shuffle and repeat changing without a poll. */
export function onControls(fn: () => void) { legacySync = fn }

function controlsChanged() {
    legacySync()
    changed()
}

/**
 * Play a track, a context, or a track within a list Spotify has no context for
 * (Liked Songs, recently played): then the loaded tracks from that one onward.
 */
export async function play(uri: string | null, contextUri?: string | null, list?: string | null) {
    let uris: string[] | null = null
    if (list && !contextUri) {
        const items = (list === "recent" ? cache.recent?.items : cache.tracks[list]?.items) || []
        uris = playFrom(items, uri)
    }
    try {
        await onRoundsIfIdle((deviceId) => api.spotifyPlay({
            uri: uri || null, contextUri: contextUri || null, ...(uris ? { uris } : {}), ...(deviceId ? { deviceId } : {}),
        }))
        say("Playing.", 1500, true)
        setTimeout(poll, 300)                       /* the badge catches up; Spotify lags a command */
    } catch (e) { say(explain(e)) }
}

/* Tracks just added to the queue, shown with a tick for a moment. */
const queued = new Set<string>()
export const justQueued = (uri: string) => queued.has(uri)

/** Add a track to the queue. True when Spotify took it. */
export async function queueAdd(uri: string): Promise<boolean> {
    try {
        await api.spotifyQueueAdd(uri)
        queued.add(uri)
        setTimeout(() => { queued.delete(uri); changed() }, 1500)
        changed()
        queueChanged()                              /* reloaded where it shows, else when it is opened */
        return true
    } catch (e) { say(explain(e)); return false }
}

export async function toggleShuffle() {
    const was = player.shuffle
    player.shuffle = !was
    controlsChanged()
    try {
        await api.spotifyShuffle(!was)
        setTimeout(poll, 300)
    } catch (e) { player.shuffle = was; controlsChanged(); say(explain(e)) }
}

const NEXT_REPEAT: Record<Repeat, Repeat> = { off: "context", context: "track", track: "off" }

/** Off, then the whole list, then the one track, then off again. */
export const nextRepeat = (r: string): Repeat => NEXT_REPEAT[r as Repeat] || "off"

export async function cycleRepeat() {
    const was = player.repeat, next = nextRepeat(was)
    player.repeat = next
    controlsChanged()
    try {
        await api.spotifyRepeat(next)
        setTimeout(poll, 300)
    } catch (e) { player.repeat = was; controlsChanged(); say(explain(e)) }
}

/** Open the device picker ("Play on"), or close it. */
export function toggleDevices() {
    if (cache.devices) { cache.devices = null; rerender(); return }
    cache.devices = []
    load("devices", async () => { cache.devices = ((await api.spotifyDevices()) as { devices: Device[] }).devices },
        () => { cache.devices = null; return false })
}

export const devicesOpen = () => !!cache.devices
export function closeDevices() { if (cache.devices) { cache.devices = null; rerender() } }

/** Move playback to a device, keeping it playing or paused as it was. */
export async function pickDevice(id: string) {
    const d = (cache.devices || []).find((x) => x.id === id)
    cache.devices = null
    rerender()
    if (!d || d.active) return
    try {
        await api.spotifyTransfer(id, player.playing)
        say("Moved to " + (id === web.deviceId ? "this tab" : d.name) + ".", 2000, true)
        setTimeout(poll, 500)
    } catch (e) { say(explain(e)) }
}

let volumeTimer: ReturnType<typeof setTimeout> | undefined
let volumePending: number | null = null
/** Debounced: the slider fires constantly while dragged; Spotify gets the last value. */
export function setVolume(percent: number) {
    volumePending = percent
    player.volume = percent
    changed()
    clearTimeout(volumeTimer)
    volumeTimer = setTimeout(async () => {
        const v = volumePending; volumePending = null
        try { await api.spotifyVolume(v) } catch (e) { say(explain(e)) }
    }, 250)
}

/** A volume is on its way to Spotify: a poll's older value must not move the slider back. */
export const volumeHeld = () => volumePending !== null

/** The volume the slider should show: the one being sent, else what Spotify said. */
export const shownVolume = () => volumePending ?? player.volume
