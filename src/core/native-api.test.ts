// The iPhone/Mac build (VITE_NATIVE=1): the API client talks to the live Worker with a token
// instead of a cookie (worker/app.js), keeps the token the Worker gives it, and drops it on sign-out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const profile = { id: "u-1", username: "ana", revision: 3 }
let calls: { url: string; init: RequestInit }[] = []
const answer = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(status === 204 ? null : JSON.stringify(body), { status })
}))

let client: typeof import("./api")
beforeEach(async () => {
    vi.stubEnv("VITE_NATIVE", "1")
    vi.stubEnv("VITE_API_BASE", "https://term.example")
    vi.stubEnv("VITE_APP_VERSION", "1.2.0")
    vi.resetModules()
    localStorage.clear()
    calls = []
    client = await import("./api")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const headers = (i: number) => calls[i].init.headers as Record<string, string>

describe("the app's API client", () => {
    it("signs in as the app, keeps the token and device mark, and hands back the profile alone", async () => {
        answer({ ...profile, token: "tok-1", device: "dev.sig" })
        const me = await client.api.login("ana", "pw")
        expect(calls[0].url).toBe("https://term.example/api/login")
        expect(calls[0].init.credentials).toBe("omit")
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ username: "ana", password: "pw", client: "app" })
        expect(headers(0).authorization).toBeUndefined()
        expect(me).toEqual(profile)
        expect(localStorage.getItem("rounds.token")).toBe("tok-1")
        expect(localStorage.getItem("rounds.device")).toBe("dev.sig")
    })

    it("sends the token and its version, sends the device mark at the next sign-in, and forgets the token on sign-out", async () => {
        localStorage.setItem("rounds.token", "tok-2")
        localStorage.setItem("rounds.device", "dev.sig")
        answer({ ...profile, token: "tok-3" })
        await client.api.me()
        expect(headers(0).authorization).toBe("Bearer tok-2")
        expect(headers(0)["x-rounds-app"]).toBe("1.2.0")
        expect(localStorage.getItem("rounds.token")).toBe("tok-3")     /* renewed */
        answer(profile)
        await client.api.login("ana", "pw")
        expect(JSON.parse(calls[1].init.body as string).device).toBe("dev.sig")
        answer(null, 204)
        await client.api.signOut()
        expect(localStorage.getItem("rounds.token")).toBeNull()
    })
})
