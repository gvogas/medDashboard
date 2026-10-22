import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { stubMatchMedia } from "@/components/test-media"
import { showApp, showSignInState } from "@/data/signin"
import { resetFriends } from "@/data/friends"

// The app is not booted: the page reads a fake store and ui through the real
// study.ts and leaderboard.ts; the sheets and the API are fakes. The
// timer cards are tested in timer-cards.test.tsx.
const fake = vi.hoisted(() => ({
    data: {
        items: [] as unknown[], courses: [] as { id: string }[], quotes: [] as unknown[], study_sessions: [] as { id: string }[],
        achievements: [] as unknown[], profile: null as unknown,
    },
    ui: {
        view: "study", focus: false, bg: "med", search: "", types: {}, course: "all", studyTab: "timer",
        hist: { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null as string | null, undo: null as unknown },
        lb: null as unknown, lbTab: "week", study: { courseId: null as string | null, itemId: null as string | null },
    },
    termStart: null as string | null,
    api: { leaderboard: vi.fn(), leaderboardJoin: vi.fn(), friends: { get: vi.fn(() => new Promise(() => {})) } },
}))
const actions = vi.hoisted(() => ({ openSession: vi.fn(), deleteSession: vi.fn(), openAchievement: vi.fn(), openSettings: vi.fn() }))
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/core/store", () => ({
    data: fake.data,
    course: (id: string | null) => fake.data.courses.find((c) => c.id === id) || null,
    item: (id: string | null) => (fake.data.items as { id: string }[]).find((c) => c.id === id) || null,
    subscribe: () => () => {},
}))
vi.mock("@/data/query", () => ({ termStart: () => fake.termStart, schoolCal: () => null }))
vi.mock("@/core/api", () => ({ api: fake.api }))

import { notify } from "@/bridge"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { Views } from "@/components/views/views"
import { ViewsHost } from "@/components/shell"
import type { StudySession } from "@/data/types"

/* Wednesday 23 September 2026, noon; the week runs Mon 21 – Sun 27. */
beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 8, 23, 12))
    stubMatchMedia({ reducedMotion: true })
    Element.prototype.scrollIntoView = vi.fn()
})
afterAll(() => { vi.useRealTimers() })

const session = (id: string, day: number, hour: number, minutes: number, row: Partial<StudySession> = {}): StudySession =>
    ({ id, courseId: "anat", itemId: null, startedAt: new Date(2026, 8, day, hour).getTime(), studyMinutes: minutes, roundsDone: 0, note: "", manual: false, ...row })
const joined = { joined: true, week: [{ name: "Ada", minutes: 300, me: false }, { name: "George", minutes: 0, me: true }, { name: "Ben", minutes: 0, me: false }], all: [{ name: "Ada", minutes: 900, me: false }, { name: "George", minutes: 45, me: true }], at: 0 }

beforeEach(() => {
    resetFriends()
    fake.api.friends.get.mockImplementation(() => new Promise(() => {}))
    showApp()
    fake.data.courses = [normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#C2571A" }, 0), normalizeCourse({ id: "phys", code: "PHYS", name: "Physiology", color: "#1E628F" }, 1)]
    fake.data.items = [normalizeItem({ id: "e1", type: "exam", title: "Brachial plexus quiz", courseId: "anat", date: "2026-10-01", status: "todo" })]
    fake.data.study_sessions = [
        session("s1", 22, 14, 45, { itemId: "e1", roundsDone: 2 }),
        session("s2", 21, 9, 30, { courseId: "phys", manual: true, note: "Anki, 120 cards" }),
        session("s3", 2, 10, 60),
    ]
    fake.data.achievements = []
    fake.data.profile = { id: "p", studyPrefs: { goal: 60 } }
    fake.termStart = "2026-09-01"
    fake.api.leaderboard.mockResolvedValue({ joined: false, week: [], all: [] })
    fake.api.leaderboardJoin.mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { onLine: true })
})
afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    Object.assign(fake.ui, { view: "study", focus: false, lb: null, lbTab: "week", studyTab: "timer" })
    Object.assign(fake.ui.hist, { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null, undo: null })
})

const redraw = () => act(() => notify())
/* the page, and a tab opened as a person would; the waits are the page's lazy load and the leaderboard's first load */
const show = async (tab?: string) => {
    const r = render(<ViewsHost><Views /></ViewsHost>)
    await act(async () => {})
    if (tab) {
        fireEvent.click(screen.getByRole("tab", { name: tab }))
        await act(async () => {})
    }
    return r
}
const region = (name: string) => screen.getByRole("region", { name })
/* a tile; the achievements have a Streak group too, after it */
const tile = (name: string) => screen.getAllByRole("group", { name })[0]
const history = () => region("History")
const tab = (name: string) => screen.getByRole("tab", { name })
const tabs = () => within(screen.getByRole("tablist", { name: "Study" })).getAllByRole("tab")

describe("the Study page", () => {
    it("shows the tiles, then five tabs with Timer open: the Ready card and Your flow", async () => {
        await show()
        for (const name of ["Streak", "Today", "This term"]) expect(tile(name)).toBeTruthy()
        expect(tabs().map((t) => t.textContent)).toEqual(["Timer", "History", "Achievements", "Leaderboard", "Friends"])
        expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"])
        expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1])
        const panel = screen.getByRole("tabpanel", { name: "Timer" })
        expect(tab("Timer").getAttribute("aria-controls")).toBe(panel.id)
        expect(panel.tabIndex).toBe(0)
        for (const name of ["Ready", "Your flow"]) expect(within(panel).getByRole("region", { name })).toBeTruthy()
        for (const name of ["History", "Achievements", "Leaderboard"]) expect(screen.queryByRole("region", { name })).toBeNull()
    })

    it("counts the requests waiting on the Friends tab", async () => {
        fake.api.friends.get.mockResolvedValue({ friends: [], incoming: [{ userId: "u-jo", username: "jo", name: "Jo", at: 1 }], sent: [], settings: { findable: true, showStudying: true } })
        await show()
        await act(async () => {})
        expect(screen.getByRole("tab", { name: /Friends, 1 waiting/ })).toBeTruthy()
        expect(tab("Friends, 1 waiting").textContent).toContain("1")
    })

    it("marks the Friends tab New while there are no friends and no requests", async () => {
        fake.api.friends.get.mockResolvedValue({ friends: [], incoming: [], sent: [], settings: { findable: true, showStudying: true } })
        await show()
        await act(async () => {})
        expect(screen.getByRole("tab", { name: /Friends, new/ }).textContent).toContain("New")
    })

    it("asks for the friends again each minute while the page shows, and stops when it goes", async () => {
        const timers = vi.spyOn(globalThis, "setInterval")
        fake.api.friends.get.mockResolvedValue({ friends: [], incoming: [], sent: [], settings: { findable: true, showStudying: true } })
        const r = await show()
        await act(async () => {})
        expect(fake.api.friends.get).toHaveBeenCalledTimes(1)
        /* every half minute, so a list loaded just under a minute ago is asked for again at the next tick */
        const tick = timers.mock.calls.find((c) => c[1] === 30_000)![0] as () => void
        vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 30))
        await act(async () => { tick() })
        expect(fake.api.friends.get).toHaveBeenCalledTimes(1)
        vi.setSystemTime(new Date(2026, 8, 23, 12, 1, 5))
        await act(async () => { tick() })
        expect(fake.api.friends.get).toHaveBeenCalledTimes(2)
        const clear = vi.spyOn(globalThis, "clearInterval")
        r.unmount()
        expect(clear).toHaveBeenCalled()
        timers.mockRestore(); clear.mockRestore()
        vi.setSystemTime(new Date(2026, 8, 23, 12))
    })

    it("opens a tab on a click, and keeps it in the ui", async () => {
        await show()
        fireEvent.click(tab("History"))
        expect(fake.ui.studyTab).toBe("history")
        expect(tab("History").getAttribute("aria-selected")).toBe("true")
        expect(within(screen.getByRole("tabpanel", { name: "History" })).getByRole("region", { name: "History" })).toBeTruthy()
        expect(screen.queryByRole("region", { name: "Ready" })).toBeNull()
        fireEvent.click(tab("Achievements"))
        expect(region("Achievements")).toBeTruthy()
        fireEvent.click(tab("Leaderboard"))
        await act(async () => {})
        expect(region("Leaderboard")).toBeTruthy()
        expect(fake.api.leaderboard).toHaveBeenCalledTimes(1)   /* asked for once its tab opened */
    })

    it("opens on the tab last shown", async () => {
        fake.ui.studyTab = "achievements"
        await show()
        expect(tab("Achievements").getAttribute("aria-selected")).toBe("true")
        expect(region("Achievements")).toBeTruthy()
    })

    it("moves between tabs with the left and right arrows, Home and End", async () => {
        await show()
        act(() => tab("Timer").focus())
        fireEvent.keyDown(tab("Timer"), { key: "ArrowRight" })
        expect(document.activeElement).toBe(tab("History"))
        expect(fake.ui.studyTab).toBe("history")
        fireEvent.keyDown(document.activeElement!, { key: "End" })
        await act(async () => {})
        expect(document.activeElement).toBe(tab("Friends"))
        expect(tab("Friends").tabIndex).toBe(0)
        fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })   /* round to the first */
        expect(document.activeElement).toBe(tab("Timer"))
        fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" })
        await act(async () => {})
        expect(fake.ui.studyTab).toBe("friends")
        fireEvent.keyDown(document.activeElement!, { key: "Home" })
        expect(fake.ui.studyTab).toBe("timer")
        fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })   /* a row of tabs: down does nothing */
        expect(fake.ui.studyTab).toBe("timer")
    })

    it("lays Achievements full width with the groups two across, and centres the leaderboard", async () => {
        await show("Achievements")
        const groups = within(region("Achievements")).getByRole("group", { name: "Study hours" }).parentElement!
        expect(groups.className).toContain("grid-cols-2")
        fireEvent.click(tab("Leaderboard"))
        await act(async () => {})
        expect(region("Leaderboard").closest(".max-w-\\[760px\\]")!.className).toContain("mx-auto")
    })

    it("lays the Timer tab out as the Ready card beside Your flow, one column under 1000px", async () => {
        await show()
        const layout = region("Ready").parentElement!
        expect(layout.className).toContain("[grid-template-columns:minmax(0,1.4fr)_minmax(0,1fr)]")
        expect(layout.className).toContain("max-[1000px]:[grid-template-columns:minmax(0,1fr)]")
        expect(layout.firstElementChild).toBe(region("Ready"))
        expect(layout.children[1].contains(region("Your flow"))).toBe(true)
        expect(layout.children[1].contains(region("Today"))).toBe(true)
        expect(region("Your flow").compareDocumentPosition(region("Today")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("is not drawn on the focus screen", async () => {
        fake.ui.focus = true
        await show()
        expect(screen.queryByRole("region", { name: "Ready" })).toBeNull()
        expect(document.getElementById("views")!.hidden).toBe(true)
    })
})

describe("the tiles", () => {
    it("show the streak, today against the goal, and the term", async () => {
        await show()
        expect(tile("Streak").textContent).toContain("2 days")
        expect(tile("Streak").textContent).toContain("study today to keep it")
        expect(screen.getByRole("meter", { name: "Daily goal" }).getAttribute("aria-valuenow")).toBe("0")
        expect(tile("Today").textContent).toContain("0m of 1h 00m")
        expect(tile("Today").textContent).toContain("60 min to your daily goal")
        expect(tile("This term").textContent).toContain("2h 15m")
        expect(tile("This term").textContent).toContain("3 sessions since 1 Sep")
    })

    it("offer to set a goal without one, and count 12 weeks without a term", async () => {
        fake.data.profile = null
        fake.termStart = null
        fake.data.study_sessions = []
        await show()
        expect(screen.queryByRole("meter")).toBeNull()
        fireEvent.click(within(tile("Today")).getByRole("button", { name: "Set a daily goal" }))
        expect(actions.openSettings).toHaveBeenCalledWith("goalGrp")
        expect(tile("Last 12 weeks").textContent).toContain("0 sessions")
        expect(tile("Streak").textContent).toContain("0 days")
    })
})

describe("Today", () => {
    it("lists today's sessions newest first, with the total of the goal", async () => {
        fake.data.study_sessions = [
            ...fake.data.study_sessions,
            session("t1", 23, 8, 25, { courseId: "phys", manual: true, note: "Flashcards" }),
            session("t2", 23, 10, 40, { itemId: "e1" }),
        ]
        await show()
        const today = region("Today")
        const rows = within(within(today).getByRole("list", { name: "Sessions today" })).getAllByRole("listitem")
        expect(rows.map((r) => r.textContent)).toEqual(["10:00Brachial plexus quiz40m", "08:00Flashcards25m"])
        expect(within(today).getByRole("heading", { name: "Today" }).parentElement!.textContent).toBe("Today1h 05m of 1h 00m")
    })

    it("says when nothing is logged, shows the total alone without a goal, and logs study by hand", async () => {
        fake.data.profile = null
        await show()
        const today = region("Today")
        expect(today.textContent).toContain("Nothing logged today yet.")
        expect(within(today).getByRole("heading", { name: "Today" }).parentElement!.textContent).toBe("Today0m")
        fireEvent.click(within(today).getByRole("button", { name: "Log study by hand" }))
        expect(actions.openSession).toHaveBeenCalledWith(null)
    })
})

describe("History", () => {
    it("shows the week: total, sessions newest first, and the arrows stop at this week", async () => {
        await show("History")
        const h = history()
        expect(h.textContent).toContain("21 – 27 Sep")
        expect(h.textContent).toContain("in 2 sessions")
        expect(h.textContent).toContain("1h 00m goal")
        const rows = within(h).getAllByRole("listitem").filter((li) => li.dataset.session)
        expect(rows.map((r) => r.dataset.session)).toEqual(["s1", "s2"])
        expect(rows[0].textContent).toContain("Tue 22 · 14:00")
        expect(rows[0].textContent).toContain("Brachial plexus quiz")
        expect(rows[0].textContent).toContain("2 rounds")
        expect(rows[0].textContent).toContain("Timer")
        expect(rows[1].textContent).toContain("Anki, 120 cards")
        expect(rows[1].textContent).toContain("By hand")
        expect(rows[1].textContent).toContain("PHYS")

        const next = within(h).getByRole("button", { name: "Next week" }) as HTMLButtonElement
        expect(next.disabled).toBe(true)
        expect(within(h).queryByRole("button", { name: "This week" })).toBeNull()
        fireEvent.click(within(h).getByRole("button", { name: "Previous week" }))
        expect(h.textContent).toContain("14 – 20 Sep")
        expect(h.textContent).toContain("No study logged this week.")
        expect(next.disabled).toBe(false)
        fireEvent.click(within(h).getByRole("button", { name: "This week" }))
        expect(h.textContent).toContain("21 – 27 Sep")
    })

    it("puts the week in two columns when wide: the total, chart and courses beside the sessions", async () => {
        await show("History")
        const h = history()
        const left = h.querySelector<HTMLElement>('[data-col="chart"]')!, right = h.querySelector<HTMLElement>('[data-col="sessions"]')!
        expect(left.parentElement).toBe(right.parentElement)
        expect(left.parentElement!.className).toContain("@min-[880px]:grid-cols-2")
        expect(left.textContent).toContain("1h 00m goal")
        expect(within(left).getByText("ANAT")).toBeTruthy()   /* the course bars */
        expect(within(right).getAllByRole("listitem").map((li) => li.dataset.session)).toEqual(["s1", "s2"])
        expect(right.className).toContain("@container")
    })

    it("switches to the month: the stats, the calendar, the picked day", async () => {
        await show("History")
        const h = history()
        fireEvent.click(within(h).getByRole("button", { name: "Month" }))
        expect(within(h).getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true")
        const cal = within(h).getByRole("group", { name: "September 2026" })
        expect(h.textContent).toContain("2h 15m" + "studied")
        expect(h.textContent).toContain("3/23days studied")
        /* today is picked, with nothing logged */
        expect(within(cal).getByRole("button", { name: "Wed 23 Sep, no study" }).getAttribute("aria-pressed")).toBe("true")
        expect(h.textContent).toContain("Wed 23 Sep · today")
        expect(document.getElementById("hday-2026-09-23")!.textContent).toContain("Nothing logged this day.")
        fireEvent.click(within(document.getElementById("hday-2026-09-23")!).getByRole("button", { name: "Log study" }))
        expect(actions.openSession).toHaveBeenCalledWith(null)

        const day = within(cal).getByRole("button", { name: "Wed 2 Sep, 1h 00m, goal reached" })
        fireEvent.click(day)
        expect(day.getAttribute("aria-pressed")).toBe("true")
        expect(document.getElementById("hday-2026-09-02")!.textContent).toContain("1h 00m · 1 session")
        expect(within(cal).queryByRole("button", { name: /Thu 24 Sep/ })).toBeNull()   /* the future is not a button */

        fireEvent.click(within(h).getByRole("button", { name: "Previous month" }))
        expect(within(h).getByRole("group", { name: "August 2026" })).toBeTruthy()
        expect(h.textContent).not.toContain("Nothing logged this day.")   /* August has no study: nothing picked */
        fireEvent.click(within(h).getByRole("button", { name: "This month" }))
        expect(within(h).getByRole("group", { name: "September 2026" })).toBeTruthy()
    })

    it("shows the term; a day opens its month with it picked, in view, and focused", async () => {
        await show("History")
        const h = history()
        fireEvent.click(within(h).getByRole("button", { name: "Term" }))
        expect(h.textContent).toContain("Term · 31 Aug – 20 Dec")
        expect(screen.getByText("Studied on 3 days in this range.")).toBeTruthy()
        expect(h.textContent).toContain("By course")
        expect(within(h).queryByRole("button", { name: "Previous week" })).toBeNull()
        const heat = within(h).getByRole("group", { name: "Study by day, 31 Aug – 20 Dec" })
        /* one day takes Tab, and the arrows move between days */
        const today = within(heat).getByRole("button", { name: "Wed 23 Sep, no study" })
        expect(today.tabIndex).toBe(0)
        act(() => today.focus())
        fireEvent.keyDown(today, { key: "ArrowLeft" })
        expect(document.activeElement).toBe(within(heat).getByRole("button", { name: "Wed 16 Sep, no study" }))
        fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })
        expect(document.activeElement!.getAttribute("aria-label")).toBe("Thu 17 Sep, no study")

        fireEvent.click(within(heat).getByRole("button", { name: "Tue 22 Sep, 45m" }))
        expect(fake.ui.hist).toMatchObject({ tab: "month", focusDay: "2026-09-22", monthOffset: 0 })
        const picked = document.getElementById("hday-2026-09-22")!
        expect(picked.textContent).toContain("Tue 22 Sep")
        expect(picked.textContent).toContain("45m · 1 session")
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
        expect(document.activeElement!.getAttribute("aria-label")).toBe("Tue 22 Sep, 45m")
        expect(document.activeElement!.getAttribute("aria-pressed")).toBe("true")
    })

    it("edits a session, deletes it with Undo in the foot on any tab, and Undo brings it back", async () => {
        await show("History")
        const h = history()
        const row = () => h.querySelector('[data-session="s1"]') as HTMLElement | null
        fireEvent.click(within(row()!).getByRole("button", { name: "Edit this session" }))
        expect(actions.openSession).toHaveBeenCalledWith("s1")

        fireEvent.click(within(row()!).getByRole("button", { name: "Delete this session" }))
        expect(actions.deleteSession).toHaveBeenCalledWith("s1")
        /* what study-controller's deleteWithUndo does: hide it and wait */
        const commit = vi.fn()
        fake.ui.hist.undo = { session: fake.data.study_sessions[0], timer: setTimeout(commit, 60_000) }
        redraw()
        expect(row()).toBeNull()
        const status = within(h).getByRole("status")
        expect(status.textContent).toBe("Deleted ANAT · 45m from Tue 22 Sep.Undo")
        expect(document.activeElement).toBe(within(status).getByRole("button", { name: "Undo" }))
        expect(h.textContent).toContain("in 1 session")

        fireEvent.click(within(h).getByRole("button", { name: "Term" }))
        expect(within(h).getByRole("status").textContent).toContain("Deleted ANAT · 45m")
        fireEvent.click(within(h).getByRole("button", { name: "Week" }))
        fireEvent.click(within(h).getByRole("button", { name: "Undo" }))
        expect(fake.ui.hist.undo).toBeNull()
        expect(within(h).getByRole("status").textContent).toBe("")
        expect(row()).toBeTruthy()
        expect(document.activeElement).toBe(within(row()!).getByRole("button", { name: "Edit this session" }))
    })

    it("logs study by hand from the head", async () => {
        await show("History")
        fireEvent.click(within(history()).getByRole("button", { name: "Log study" }))
        expect(actions.openSession).toHaveBeenCalledWith(null)
    })

    it("says so with no study at all", async () => {
        fake.data.study_sessions = []
        await show("History")
        expect(history().textContent).toContain("No study logged this week.")
        fireEvent.click(within(history()).getByRole("button", { name: "Term" }))
        expect(screen.getByText("Studied on 0 days in this range.")).toBeTruthy()
        expect(history().textContent).not.toContain("By course")
    })
})

describe("achievements", () => {
    it("count the badges, list the next three, and give each medal its id", async () => {
        await show("Achievements")
        const a = region("Achievements")
        expect(a.textContent).toMatch(/\d+ of 24/)
        expect(within(a).getByRole("heading", { name: "Next up" })).toBeTruthy()
        const first = document.getElementById("ach-hours-1")!
        expect(first.getAttribute("aria-label")).toBe("First hour: Study 1 hour in total. Earned 2 Sep")
        expect(document.getElementById("ach-days-first")).toBeTruthy()
        for (const g of ["Study hours", "Streak", "Big days", "Tasks done", "Exams", "Grades", "Your own"]) expect(within(a).getByRole("group", { name: g })).toBeTruthy()
        expect(a.textContent).toContain("Make your own: upload a sticker")
        fireEvent.click(within(a).getByRole("button", { name: /New/ }))
        expect(actions.openAchievement).toHaveBeenCalledWith(null)
    })

    it("open a sticker's sheet, and stop offering New at 30", async () => {
        fake.data.achievements = Array.from({ length: 30 }, (_, i) => ({ id: "a" + i, name: "Sticker " + i, sticker: "data:image/webp;base64,AAAA", rule: "hours", courseId: "anat", itemId: null, target: i ? 50 : 1 }))
        await show("Achievements")
        const own = within(region("Achievements")).getByRole("group", { name: "Your own" })
        expect(own.textContent).toContain("1 / 30")
        expect(document.getElementById("ach-own-a0")).toBeTruthy()
        fireEvent.click(within(own).getByRole("button", { name: "Sticker 0, earned 2 Sep. Edit" }))
        expect(actions.openAchievement).toHaveBeenCalledWith("a0")
        expect(within(own).getByRole("button", { name: "Sticker 1, 1.8 / 50 h. Edit" })).toBeTruthy()
        const add = within(own).getByRole("button", { name: /New/ }) as HTMLButtonElement
        expect(add.disabled).toBe(true)
        expect(add.textContent).toContain("30 is the most")
        expect(own.textContent).not.toContain("Make your own")
    })
})

describe("the leaderboard", () => {
    const lb = () => region("Leaderboard")

    it("says Loading… until the totals come", async () => {
        let answer!: (v: unknown) => void
        fake.api.leaderboard.mockReturnValue(new Promise((r) => { answer = r }))
        await show("Leaderboard")
        expect(lb().textContent).toContain("Loading…")
        await act(async () => { answer({ joined: false, week: [], all: [] }) })
        expect(lb().textContent).toContain("See who has studied the most this week.")
    })

    it("waits for the app to show before asking, so booting does not cancel it", async () => {
        showSignInState()
        await show("Leaderboard")
        expect(fake.api.leaderboard).not.toHaveBeenCalled()
        await act(async () => { showApp() })
        expect(fake.api.leaderboard).toHaveBeenCalledTimes(1)
    })

    it("joins: busy while it goes, then the list, with focus on Leave", async () => {
        await show("Leaderboard")
        let finish!: () => void
        fake.api.leaderboardJoin.mockReturnValue(new Promise<void>((r) => { finish = r }))
        fake.api.leaderboard.mockResolvedValue(joined)
        const join = within(lb()).getByRole("button", { name: "Join the leaderboard" }) as HTMLButtonElement
        act(() => join.focus())
        fireEvent.click(join)
        expect(join.disabled).toBe(true)
        expect(fake.api.leaderboardJoin).toHaveBeenCalledWith(true)
        await act(async () => { finish() })
        await waitFor(() => expect(within(lb()).getByRole("button", { name: "Leave the leaderboard" })).toBeTruthy())
        expect(document.activeElement).toBe(within(lb()).getByRole("button", { name: "Leave the leaderboard" }))
    })

    it("ranks the joined list with your row from this device, and switches to all-time", async () => {
        fake.ui.lb = { ...joined, at: Date.now() }
        await show("Leaderboard")
        expect(fake.api.leaderboard).not.toHaveBeenCalled()   /* fresh: not asked again */
        const rows = within(lb()).getAllByRole("listitem")
        /* your 45 + 30 minutes this week, from this device */
        expect(rows.map((r) => r.textContent)).toEqual(["1Ada5h", "2Georgeyou1.3h", "3Ben0h"])
        expect(rows[0].firstElementChild!.className).toContain("#FBF1D6")
        expect(rows[2].firstElementChild!.className).not.toContain("#F8E8DC")   /* no medal at zero */
        expect(lb().textContent).toContain("21 Sep – 27 Sep")
        expect(lb().textContent).toContain("Resets Monday")
        fireEvent.click(within(lb()).getByRole("button", { name: "All-time" }))
        expect(fake.ui.lbTab).toBe("all")
        expect(lb().textContent).toContain("Since each person started2 people")
        expect(within(lb()).getAllByRole("listitem").map((r) => r.textContent)).toEqual(["1Ada15h", "2Georgeyou2.3h"])
    })

    it("leaves, with focus back on Join", async () => {
        fake.ui.lb = { ...joined, at: Date.now() }
        fake.api.leaderboard.mockResolvedValue({ joined: false, week: [], all: [] })
        await show("Leaderboard")
        fireEvent.click(within(lb()).getByRole("button", { name: "Leave the leaderboard" }))
        expect(fake.api.leaderboardJoin).toHaveBeenCalledWith(false)
        await waitFor(() => expect(document.activeElement).toBe(within(lb()).getByRole("button", { name: "Join the leaderboard" })))
        expect(within(lb()).queryByRole("button", { name: "All-time" })).toBeNull()
    })

    it("says when joining did not go through, keeping focus on Join", async () => {
        fake.api.leaderboardJoin.mockRejectedValue(new Error("offline"))
        await show("Leaderboard")
        const join = within(lb()).getByRole("button", { name: "Join the leaderboard" }) as HTMLButtonElement
        act(() => join.focus())
        await act(async () => { fireEvent.click(join) })
        expect(within(lb()).getByRole("alert").textContent).toBe("That did not go through. Try again when you are online.")
        expect(join.disabled).toBe(false)
        expect(document.activeElement).toBe(join)
    })

    it("needs a connection, and tries again when back online", async () => {
        vi.stubGlobal("navigator", { onLine: false })
        fake.api.leaderboard.mockRejectedValue(new Error("offline"))
        await show("Leaderboard")
        expect(lb().textContent).toContain("The leaderboard needs a connection. Your own hours are still saved.")
        vi.stubGlobal("navigator", { onLine: true })
        fake.api.leaderboard.mockResolvedValue(joined)
        await act(async () => { window.dispatchEvent(new Event("online")) })
        expect(within(lb()).getByRole("button", { name: "Leave the leaderboard" })).toBeTruthy()
    })

    it("tries again on opening its tab when the last try was offline and the device is online now", async () => {
        vi.stubGlobal("navigator", { onLine: false })
        fake.api.leaderboard.mockRejectedValue(new Error("offline"))
        await show("Leaderboard")
        expect(lb().textContent).toContain("needs a connection")
        vi.stubGlobal("navigator", { onLine: true })
        fake.api.leaderboard.mockResolvedValue(joined)
        fireEvent.click(tab("Timer"))
        fireEvent.click(tab("Leaderboard"))
        await act(async () => {})
        expect(within(lb()).getByRole("button", { name: "Leave the leaderboard" })).toBeTruthy()
    })

    it("says when the totals could not be loaded", async () => {
        fake.api.leaderboard.mockRejectedValue(new Error("500"))
        await show("Leaderboard")
        expect(lb().textContent).toContain("Could not load the leaderboard. Try again in a minute.")
        expect(within(lb()).queryByRole("button")).toBeNull()
    })
})
