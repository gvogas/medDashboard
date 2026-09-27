// The single-key shortcuts in legacy/js/keyboard.js call the actions directly.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const ui = vi.hoisted(() => ({ view: "week", focus: false }))
const actions = vi.hoisted(() => ({ newItem: vi.fn(), goToday: vi.fn(), step: vi.fn() }))
const setView = vi.hoisted(() => vi.fn())

// Everything else keyboard.js imports needs the booted app; none of it runs for these keys.
vi.mock("@/data/actions", () => actions)
vi.mock("@/legacy/js/state.js", () => ({ ui }))
vi.mock("@/legacy/js/study-controller.js", () => ({ setView, leaveFocus: vi.fn() }))
vi.mock("@/legacy/js/views/drawer-base.js", () => ({ drawerOpen: () => false, setSide: vi.fn() }))
vi.mock("@/legacy/js/views/keys.js", () => ({ keysOpen: () => false, openKeys: vi.fn(), closeKeys: vi.fn() }))
vi.mock("@/legacy/js/store.js", () => ({}))
vi.mock("@/legacy/js/views/render.js", () => ({}))
vi.mock("@/legacy/js/views/sidebar.js", () => ({}))
vi.mock("@/legacy/js/views/drawer-item.js", () => ({}))
vi.mock("@/legacy/js/views/drawer-course.js", () => ({}))
vi.mock("@/legacy/js/views/drawer-settings.js", () => ({}))
vi.mock("@/legacy/js/views/types-nav.js", () => ({}))
vi.mock("@/legacy/js/spotify.js", () => ({}))
vi.mock("@/legacy/js/web-player.js", () => ({}))
vi.mock("@/legacy/js/views/spotify-view.js", () => ({}))

import { onKeydown } from "@/legacy/js/keyboard.js"

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
