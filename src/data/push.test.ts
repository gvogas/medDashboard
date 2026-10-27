import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The browser's push parts are faked: a service worker registration whose pushManager
// hands out one subscription, and Notification with a permission the test sets.
const api = vi.hoisted(() => ({
    pushKey: vi.fn(async () => ({ enabled: true, key: "BAEC" })),
    pushOn: vi.fn(async () => null), pushOff: vi.fn(async () => null),
    pushTest: vi.fn(async () => ({ result: "ok" })),
}))
vi.mock("@/core/api", () => ({ api }))
vi.mock("./settings", () => ({ timeZone: () => "Europe/Athens" }))

import { forgetDevice, keyBytes, pushState, testPush, turnOff, turnOn } from "./push"

let sub: { endpoint: string; options: { applicationServerKey: ArrayBuffer | null }; unsubscribe: ReturnType<typeof vi.fn> } | null
const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async (o: { applicationServerKey: Uint8Array }) => {
        sub = { endpoint: "https://fcm.googleapis.com/fcm/send/new", options: { applicationServerKey: o.applicationServerKey.buffer as ArrayBuffer }, unsubscribe: vi.fn(async () => { sub = null; return true }) }
        return sub
    }),
}
const perm = { now: "default" as NotificationPermission, answer: "granted" as NotificationPermission }

beforeEach(() => {
    sub = null
    perm.now = "default"
    perm.answer = "granted"
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager }), getRegistration: async () => ({ pushManager }) } })
    vi.stubGlobal("PushManager", function PushManager() {})
    vi.stubGlobal("Notification", { get permission() { return perm.now }, requestPermission: vi.fn(async () => (perm.now = perm.answer)) })
})
afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

describe("push reminders on this device", () => {
    it("reads the key as bytes", () => {
        expect([...keyBytes("BAEC")]).toEqual([4, 1, 2])
        expect([...keyBytes("_-8")]).toEqual([255, 239])
    })

    it("asks, subscribes with the key and tells the Worker the zone; off undoes both", async () => {
        expect(await pushState()).toBe("off")
        expect(await turnOn()).toBe("on")
        expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyBytes("BAEC") })
        expect(api.pushOn).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/new", "Europe/Athens")
        expect(await pushState()).toBe("on")
        expect(await testPush()).toBe("ok")
        const was = sub!
        expect(await turnOff()).toBe("off")
        expect(api.pushOff).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/new")
        expect(was.unsubscribe).toHaveBeenCalled()
        expect(await testPush()).toBe("off")
    })

    it("stays off when notifications are refused, and says when they are blocked", async () => {
        perm.answer = "denied"
        expect(await turnOn()).toBe("blocked")
        expect(pushManager.subscribe).not.toHaveBeenCalled()
        expect(await pushState()).toBe("blocked")
    })

    it("replaces a subscription made with an older key", async () => {
        const old = vi.fn(async () => true)
        sub = { endpoint: "https://fcm.googleapis.com/fcm/send/old", options: { applicationServerKey: new Uint8Array([9]).buffer }, unsubscribe: old }
        expect(await turnOn()).toBe("on")
        expect(old).toHaveBeenCalled()
        expect(api.pushOn).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/new", "Europe/Athens")
    })

    it("says when the site has no keys, or the browser has no push", async () => {
        api.pushKey.mockResolvedValueOnce({ enabled: false, key: null } as never)
        expect(await pushState()).toBe("disabled")
        delete (navigator as { serviceWorker?: unknown }).serviceWorker
        expect(await pushState()).toBe("unsupported")
        await expect(forgetDevice()).resolves.toBeUndefined()
    })

    it("lets sign-out go on when the service worker never registered", async () => {
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: new Promise(() => {}), getRegistration: async () => undefined } })
        await expect(forgetDevice()).resolves.toBeUndefined()
        expect(api.pushOff).not.toHaveBeenCalled()
    })
})
