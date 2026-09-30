import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { statusText } from "@/components/views/bits"
import type { Item } from "@/data/types"

const item = (over: Partial<Item>): Item => ({ id: "i", type: "assignment", title: "t", courseId: null, date: "2026-09-29", start: "", end: "", where: "", status: "todo", notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, ...over } as unknown as Item)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 29, 9, 0)) })
afterEach(() => vi.useRealTimers())

describe("statusText", () => {
    it("a finished item says its status, in the done tone", () => {
        expect(statusText(item({ status: "submitted" }), "2026-09-29")).toEqual({ text: "Submitted", tone: "done" })
    })
    it("an overdue item says so", () => {
        expect(statusText(item({ date: "2026-09-28" }), "2026-09-28")).toEqual({ text: "Overdue", tone: "late" })
    })
    it("due today with no start time: due tonight", () => {
        expect(statusText(item({}), "2026-09-29")).toEqual({ text: "Due tonight", tone: "soon" })
    })
    it("due today before six: due at that hour", () => {
        expect(statusText(item({ end: "17:00" }), "2026-09-29")).toEqual({ text: "Due 17:00", tone: "soon" })
        expect(statusText(item({ end: "23:59" }), "2026-09-29")).toEqual({ text: "Due tonight", tone: "soon" })
    })
    it("a missed, cancelled or dropped item says so, not when it was due", () => {
        expect(statusText(item({ type: "lab", status: "missed" }), "2026-09-29")).toEqual({ text: "Missed", tone: "" })
        expect(statusText(item({ type: "lab", status: "missed", date: "2026-10-02" }), "2026-10-02")).toEqual({ text: "Missed", tone: "" })
    })
    it("today with a start time: today", () => {
        expect(statusText(item({ type: "tutoring", start: "11:00" }), "2026-09-29")).toEqual({ text: "Today", tone: "soon" })
    })
    it("tomorrow, then in n days", () => {
        expect(statusText(item({ date: "2026-09-30" }), "2026-09-30")).toEqual({ text: "Tomorrow", tone: "" })
        expect(statusText(item({ date: "2026-10-02" }), "2026-10-02")).toEqual({ text: "In 3 days", tone: "" })
    })
    it("a weekly item says which day it repeats", () => {
        expect(statusText(item({ recur: "weekly", weekday: 5, date: "2026-09-04" }), "2026-10-02")).toEqual({ text: "Every Fri", tone: "" })
    })
})
