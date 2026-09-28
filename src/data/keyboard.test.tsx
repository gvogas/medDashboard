// The single-key shortcuts in data/keyboard.ts call the actions directly.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const ui = vi.hoisted(() => ({ view: "week", focus: false }))
const actions = vi.hoisted(() => ({ newItem: vi.fn(), goToday: vi.fn(), step: vi.fn() }))
const setView = vi.hoisted(() => vi.fn())

// Everything else keyboard.ts imports needs the booted app; none of it runs for these keys.
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView }))
vi.mock("@/data/study-timer", () => ({ escapeFocus: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn(), sideOpen: () => false }))
vi.mock("@/data/ai-read", () => ({ getBusy: () => null }))
vi.mock("@/core/store", () => ({}))

import { onKeydown } from "@/data/keyboard"
import { keysOpen } from "@/data/keys"

const press = (key: string) => {
    const e = new KeyboardEvent("keydown", { key, cancelable: true })
    Object.defineProperty(e, "target", { value: document.body })
    onKeydown(e)
    return e.defaultPrevented
}

beforeAll(() => {
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "app" }))
    const search = Object.assign(document.createElement("input"), { id: "search", type: "search" })
    document.body.appendChild(search)
    document.body.appendChild(Object.assign(document.createElement("aside"), { id: "side" }))
})

afterEach(() => {
    vi.clearAllMocks()
    ui.view = "week"
})

describe("single-key shortcuts", () => {
    it("n opens a new item, t goes to today", () => {
        expect(press("n")).toBe(true)
        expect(actions.newItem).toHaveBeenCalledOnce()
        expect(press("t")).toBe(true)
        expect(actions.goToday).toHaveBeenCalledOnce()
    })

    it("[ and ] step in the week and month views only", () => {
        press("[")
        ui.view = "month"
        press("]")
        expect(actions.step.mock.calls).toEqual([[-1], [1]])
        ui.view = "table"
        press("[")
        expect(actions.step).toHaveBeenCalledTimes(2)
    })

    it("1–5 show a view and / focuses search", () => {
        press("3")
        expect(setView).toHaveBeenCalledWith("table")
        press("/")
        expect(document.activeElement?.id).toBe("search")
    })
})

describe("the shortcuts panel", () => {
    it("? opens and closes it, Escape closes it, and no shortcut runs while it is up", () => {
        expect(press("?")).toBe(true)
        expect(keysOpen()).toBe(true)
        expect(document.getElementById("app")!.inert).toBe(true)
        press("n")
        expect(actions.newItem).not.toHaveBeenCalled()
        press("?")
        expect(keysOpen()).toBe(false)
        press("?")
        press("Escape")
        expect(keysOpen()).toBe(false)
        expect(document.getElementById("app")!.inert).toBe(false)
    })
})
