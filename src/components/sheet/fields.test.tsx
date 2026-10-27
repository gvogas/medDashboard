import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Checkbox } from "./fields"
import { TimeField } from "./time-field"

afterEach(() => cleanup())

describe("Checkbox", () => {
    it("is named by its text, and clicking the text toggles it", () => {
        const onChange = vi.fn()
        render(<Checkbox id="c" checked={false} onChange={onChange}>Keep it</Checkbox>)
        expect(screen.getByRole("checkbox", { name: "Keep it" })).toBeTruthy()
        fireEvent.click(screen.getByText("Keep it"))
        expect(onChange).toHaveBeenCalledWith(true)
    })
})

describe("TimeField", () => {
    it("is a combobox that points at the highlighted time while the list is open", () => {
        render(<TimeField value="08:30" onChange={() => {}} label="Starts" />)
        const box = screen.getByRole("combobox", { name: "Starts" })
        expect(box.getAttribute("aria-expanded")).toBe("false")
        expect(box.getAttribute("aria-activedescendant")).toBeNull()
        fireEvent.focus(box)
        expect(box.getAttribute("aria-expanded")).toBe("true")
        const list = screen.getByRole("listbox", { name: "Times" })
        expect(box.getAttribute("aria-controls")).toBe(list.id)
        const on = screen.getByRole("option", { name: "08:30" })
        expect(on.getAttribute("aria-selected")).toBe("true")
        expect(box.getAttribute("aria-activedescendant")).toBe(on.id)
    })
})
