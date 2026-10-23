// The iCalendar reader in the browser's own time zone: a UTC start moves to local, and a weekly
// rule's weekdays move with it (test/importers.test.js covers the rest, in UTC).
import { afterEach, describe, expect, it } from "vitest"
import { parseIcs } from "./ics"

const zone = process.env.TZ
afterEach(() => { process.env.TZ = zone })

const event = (lines: string) => `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${lines}\nEND:VEVENT\nEND:VCALENDAR`

describe("a weekly class written in UTC", () => {
    it("keeps its local weekday west of UTC: Monday 18:00 in Los Angeles is Tuesday 01:00 UTC", () => {
        process.env.TZ = "America/Los_Angeles"
        const [ev] = parseIcs(event("SUMMARY:Anatomy\nDTSTART:20260915T010000Z\nDTEND:20260915T023000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH"))
        expect(ev).toMatchObject({ date: "2026-09-14", start: "18:00", end: "19:30", weekly: true, weekdays: [1, 3] })
    })

    it("keeps its local weekday east of UTC: Saturday 08:00 in Tokyo is Friday 23:00 UTC", () => {
        process.env.TZ = "Asia/Tokyo"
        const [ev] = parseIcs(event("SUMMARY:Lab\nDTSTART:20260918T230000Z\nRRULE:FREQ=WEEKLY;BYDAY=FR"))
        expect(ev).toMatchObject({ date: "2026-09-19", start: "08:00", weekdays: [6] })
    })

    it("leaves the weekdays alone when the date does not change, and for a time with no zone", () => {
        process.env.TZ = "America/Los_Angeles"
        expect(parseIcs(event("DTSTART:20260915T170000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU"))[0].weekdays).toEqual([2])
        expect(parseIcs(event("DTSTART;TZID=America/New_York:20260915T210000\nRRULE:FREQ=WEEKLY;BYDAY=TU"))[0].weekdays).toEqual([2])
    })
})
