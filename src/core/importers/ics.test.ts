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

describe("how a weekly rule ends", () => {
    const rule = (r: string, start = "20260914T090000") => parseIcs(event(`SUMMARY:Anatomy
DTSTART;TZID=Europe/London:${start}
RRULE:${r}`))[0];

    it("reads INTERVAL, defaulting to every week", () => {
        expect(rule("FREQ=WEEKLY;BYDAY=MO").interval).toBe(1);
        expect(rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO").interval).toBe(2);
    })

    it("reads UNTIL as a date, as a UTC time, and as nothing when absent", () => {
        expect(rule("FREQ=WEEKLY;BYDAY=MO").until).toBe("");
        expect(rule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207").until).toBe("2026-12-07");
        process.env.TZ = "UTC";
        expect(rule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207T235959Z").until).toBe("2026-12-07");
        process.env.TZ = "Asia/Tokyo";   /* 23:59 UTC is already the next day in Tokyo */
        expect(rule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207T235959Z").until).toBe("2026-12-08");
    })

    it("counts occurrences from DTSTART through BYDAY and INTERVAL", () => {
        expect(rule("FREQ=WEEKLY;COUNT=1;BYDAY=MO").until).toBe("2026-09-14");
        expect(rule("FREQ=WEEKLY;COUNT=10;BYDAY=MO").until).toBe("2026-11-16");
        expect(rule("FREQ=WEEKLY;COUNT=5;BYDAY=MO,WE").until).toBe("2026-09-28");   /* 14, 16, 21, 23, 28 */
        expect(rule("FREQ=WEEKLY;COUNT=3;INTERVAL=2;BYDAY=MO").until).toBe("2026-10-12");
        expect(rule("FREQ=WEEKLY;COUNT=4").until).toBe("2026-10-05");               /* no BYDAY: DTSTART's weekday */
        expect(rule("FREQ=WEEKLY;COUNT=3;BYDAY=TU,MO").until).toBe("2026-09-21");   /* a start on Monday: 14, 15, 21 */
        expect(rule("FREQ=WEEKLY;COUNT=3;BYDAY=WE,FR", "20260916T090000").until).toBe("2026-09-23");   /* 16, 18, 23 */
    })

    it("counts in the written frame and gives the local date for a UTC start", () => {
        process.env.TZ = "America/Los_Angeles";   /* Tuesday 01:00 UTC is Monday 18:00 here */
        const [ev] = parseIcs(event("DTSTART:20260915T010000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=3"));
        expect(ev.until).toBe("2026-09-21");     /* UTC: Tue 15, Thu 17, Tue 22 -> local Mon 21 */
    })
})
