import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as Api from "./api"

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
let report: typeof import("./report")
let api: typeof Api
let ApiError: typeof Api.ApiError

beforeEach(async () => {
    vi.stubGlobal("fetch", fetchMock)
    vi.resetModules() // the dynamic imports below give each test fresh module state
    report = await import("./report")
    api = await import("./api")
    ApiError = api.ApiError
    api.bindAccount("u-tester")
})
afterEach(() => { fetchMock.mockClear(); vi.unstubAllGlobals() })

const sent = () => fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))

describe("reporting a crash", () => {
    it("sends nothing and spends no budget while signed out", () => {
        api.bindAccount(null)
        for (let i = 0; i < report.MAX + 5; i++) report.reportError("error", new Error("boom " + i))
        expect(fetchMock).not.toHaveBeenCalled()
        api.bindAccount("u-tester")
        report.reportError("error", new Error("after sign-in"))
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    it("sends what broke and on which page, once per message", () => {
        report.reportError("react", new TypeError("x is undefined"))
        report.reportError("react", new TypeError("x is undefined"))
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/errors")
        expect(sent()[0]).toMatchObject({ kind: "react", where: location.pathname })
        expect(sent()[0].message).toMatch(/^TypeError: x is undefined/)
    })

    it("leaves out what the server logged, a lost connection, and a cancelled request", () => {
        report.reportError("rejection", new ApiError(404, { error: "not_found" }))
        report.reportError("rejection", new TypeError("Failed to fetch"))
        report.reportError("rejection", Object.assign(new Error("stop"), { name: "AbortError" }))
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("sends at most a few a page load", () => {
        for (let i = 0; i < report.MAX + 5; i++) report.reportError("error", new Error("boom " + i))
        expect(fetchMock).toHaveBeenCalledTimes(report.MAX)
    })

    it("never throws, even when sending fails", () => {
        fetchMock.mockImplementationOnce(() => { throw new Error("no fetch") })
        expect(() => report.reportError("error", "a string")).not.toThrow()
    })
})
