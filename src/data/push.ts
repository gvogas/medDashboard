// Push reminders on this device: the morning digest (worker/push.js). The browser holds the
// subscription; the Worker keeps only its endpoint and the device's time zone. Nothing here
// runs until someone turns it on in Settings, so a browser is never asked for notifications
// out of the blue.

import { api } from "@/core/api"
import { timeZone } from "./settings"

/** Where this device stands: no push here, push off on the server, blocked, on or off. */
export type PushState = "unsupported" | "ios-install" | "disabled" | "blocked" | "on" | "off"

const supported = () =>
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

/* An iPhone or iPad only gets push in the app added to the Home Screen. */
const iosBrowser = () =>
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent)
    && !(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone)

/* getRegistration, not .ready: .ready never settles when registering failed, and sign-out waits on this */
const subscription = async () => (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null

/** The VAPID key as the bytes pushManager.subscribe wants. */
export function keyBytes(key: string): Uint8Array {
    const b = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((key.length + 3) % 4))
    return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

/** What this device is doing now. */
export async function pushState(): Promise<PushState> {
    if (!supported()) return iosBrowser() ? "ios-install" : "unsupported"
    const { enabled } = await api.pushKey()
    if (!enabled) return "disabled"
    if (Notification.permission === "denied") return "blocked"
    return (await subscription()) ? "on" : "off"
}

/** Ask for notifications, subscribe and tell the Worker. Returns the state it ends in. */
export async function turnOn(): Promise<PushState> {
    const { enabled, key } = await api.pushKey()
    if (!enabled || !key) return "disabled"
    if (await Notification.requestPermission() !== "granted") return Notification.permission === "denied" ? "blocked" : "off"
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    /* one made with another key (the keys were changed) cannot be pushed to */
    const was = sub?.options.applicationServerKey
    if (sub && was && !sameBytes(new Uint8Array(was), keyBytes(key))) { await sub.unsubscribe(); sub = null }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource })
    await api.pushOn(sub.endpoint, timeZone() || "UTC")
    return "on"
}

/** Stop on this device: the Worker forgets it and the browser unsubscribes. */
export async function turnOff(): Promise<PushState> {
    const sub = await subscription()
    if (sub) {
        await api.pushOff(sub.endpoint)
        await sub.unsubscribe()
    }
    return "off"
}

/** A test push to this device now. */
export async function testPush(): Promise<"ok" | "gone" | "failed" | "off"> {
    const sub = await subscription()
    return sub ? (await api.pushTest(sub.endpoint)).result : "off"
}

/** Before signing out: this device's digest is the account's, so it stops here. Never throws. */
export async function forgetDevice() {
    try { if (supported()) await turnOff() } catch { /* offline: the next sign-in on this device moves it */ }
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
    return a.length === b.length && a.every((x, i) => x === b[i])
}
