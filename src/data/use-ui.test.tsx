import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { notify } from "@/bridge"
import { BGS } from "./themes"
import { ui, useNotified, useUi } from "./ui"

afterEach(() => { cleanup(); ui.view = "week"; ui.bg = BGS[0] })

describe("useUi", () => {
    it("redraws when its value changes, not on an unrelated notify()", () => {
        let renders = 0
        function View() { renders++; return <p>{useUi((u) => u.view)}</p> }
        const { container } = render(<View />)
        const before = renders
        act(() => notify())
        act(() => { ui.bg = BGS[1]; notify() })
        expect(renders).toBe(before)
        act(() => { ui.view = "month"; notify() })
        expect(container.textContent).toBe("month")
        expect(renders).toBe(before + 1)
    })

    it("still redraws on every notify() for a selected object, which may change in place", () => {
        let renders = 0
        function View() { renders++; useUi((u) => u.study); return null }
        render(<View />)
        const before = renders
        act(() => { ui.study.courseId = "c1"; notify() })
        expect(renders).toBe(before + 1)
        ui.study.courseId = null
    })

    it("useNotified redraws on every notify()", () => {
        let renders = 0
        function View() { renders++; useNotified(); return null }
        render(<View />)
        const before = renders
        act(() => notify())
        expect(renders).toBe(before + 1)
    })
})
