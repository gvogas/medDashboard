import { afterEach, describe, expect, it, vi } from "vitest"
import { setBg } from "./theme"
import { ui } from "./ui"

/* ui.ts reads what this browser remembered when it loads, so each case loads it afresh. */
const load = async (saved: unknown) => {
    localStorage.setItem("rounds.ui", JSON.stringify(saved))
    vi.resetModules()
    return await import("@/data/ui")
}

afterEach(() => localStorage.clear())

describe("the remembered schedule tab", () => {
    it("starts on Everything", async () => {
        expect((await load({})).ui.schedule).toBe("all")
    })

    it("carries over the month's old Deadlines toggle", async () => {
        expect((await load({ monthDeadlines: false })).ui.schedule).toBe("classes")
        expect((await load({ monthDeadlines: true })).ui.schedule).toBe("all")
    })

    it("keeps a saved tab, and saves it in place of the old toggle", async () => {
        const state = await load({ schedule: "deadlines", monthDeadlines: false })
        expect(state.ui.schedule).toBe("deadlines")
        state.rememberUi()
        expect(JSON.parse(localStorage.getItem("rounds.ui")!)).toEqual({ view: "week", schedule: "deadlines" })
    })
})

describe("the theme", () => {
    it("applies any of the six to <html>, and Medicine for anything else", () => {
        setBg("law", { persist: false })
        expect(document.documentElement.getAttribute("data-bg")).toBe("law")
        expect(ui.bg).toBe("law")
        setBg("foo", { persist: false })
        expect(document.documentElement.getAttribute("data-bg")).toBe("med")
    })
})
