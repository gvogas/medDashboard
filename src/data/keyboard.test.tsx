// The single-key shortcuts in data/keyboard.ts call the actions directly.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const ui = vi.hoisted(() => ({ view: "week", focus: false }))
const actions = vi.hoisted(() => ({ newItem: vi.fn(), goToday: vi.fn(), step: vi.fn() }))
const setView = vi.hoisted(() => vi.fn())
const busy = vi.hoisted(() => ({ current: null as null | { cancel: () => void } }))

// Everything else keyboard.ts imports needs the booted app; none of it runs for these keys.
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView }))
vi.mock("@/data/study-timer", () => ({ escapeFocus: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn(), sideOpen: () => false }))
vi.mock("@/data/ai-read", () => ({ getBusy: () => busy.current }))
vi.mock("@/core/store", () => ({}))

import { onKeydown } from "@/data/keyboard"
import { keysOpen } from "@/data/keys"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import { showApp } from "@/data/signin"
import { act, render } from "@testing-library/react"
import { Page } from "@/components/shell"

const press = (key: string) => {
    const e = new KeyboardEvent("keydown", { key, cancelable: true })
    Object.defineProperty(e, "target", { value: document.body })
    act(() => { onKeydown(e) })
    return e.defaultPrevented
}

beforeAll(() => {
    /* signed in, with the page as <App> draws it (inert while the panel is up) */
    showApp()
    render(<Page><input id="search" type="search" /></Page>)
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
        press("4")
        expect(setView).toHaveBeenLastCalledWith("study")
        press("5")
        expect(setView).toHaveBeenLastCalledWith("spotify")
        press("/")
        expect(document.activeElement?.id).toBe("search")
    })
    it("leaves a key a part of the page already used, like the flashcard review's 1, 2 and 3", () => {
        const e = new KeyboardEvent("keydown", { key: "2", cancelable: true })
        Object.defineProperty(e, "target", { value: document.body })
        e.preventDefault()
        act(() => { onKeydown(e) })
        expect(setView).not.toHaveBeenCalled()
    })
})

describe("the shortcuts panel", () => {
    it("? opens and closes it, Escape closes it, and no shortcut runs while it is up", () => {
        expect(press("?")).toBe(true)
        expect(keysOpen()).toBe(true)
        expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true)
        press("n")
        expect(actions.newItem).not.toHaveBeenCalled()
        press("?")
        expect(keysOpen()).toBe(false)
        press("?")
        press("Escape")
        expect(keysOpen()).toBe(false)
        expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false)
    })
})

describe("Escape while a file is read", () => {
    it("cancels the read, even with focus outside the card, and leaves the sheet open", () => {
        const cancel = vi.fn()
        act(() => openSheet({ kind: "course", id: null }))
        busy.current = { cancel }
        try {
            press("Escape")
            expect(cancel).toHaveBeenCalledOnce()
            expect(getSheet()).not.toBeNull()
        } finally {
            busy.current = null
            act(() => closeSheet())
        }
    })
})
