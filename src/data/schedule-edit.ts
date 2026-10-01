// A class schedule read with AI (worker/schedule.js): the courses it found, matched to yours
// (core/importers/plan.ts, planSchedule), shown in the schedule sheet with a semester and a
// tick per class, and written on "Add N classes" through the import's commit. Nothing is
// saved before. A screenshot is made smaller here first (core/image.ts).

import { data } from "@/core/store"
import { today } from "@/core/dates"
import { planSchedule, type Schedule } from "@/core/importers/plan"
import { shrinkImage } from "@/core/image"
import { api } from "@/core/api"
import { schoolCal } from "@/data/query"
import { notify } from "@/bridge"
import { asSent, MAX_FILE, readWithAi, type NoteKey } from "./ai-read"
import { readContext } from "./ai-context"
import { commitImport, defaultTerm, type ImportPlan } from "./import-edit"
import { closeSheet, openSheet } from "./overlay"
import { toast } from "./toast"

export const isImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name)

/** What "Add N classes" adds: the ticked classes. */
export const scheduleCount = (plan: ImportPlan) => plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length, 0)

/** A timetable was picked: read it with AI, then check it in the schedule sheet. */
export function readScheduleFile(file: File, note: NoteKey = "aiNote") {
    return readWithAi(file, {
        what: "timetable", title: "Reading your timetable",
        steps: ["Reading the timetable", "Finding courses and class times", "Matching them to your courses"],
        flag: "scheduleBusy", note, refresh: notify,
        prepare: (f) => (isImage(f) ? shrinkImage(f) : asSent(f)),
        /* a phone or retina screenshot can be over 5 MB; what is sent is a 1600 px JPEG */
        maxBytes: isImage(file) ? 4 * MAX_FILE : MAX_FILE,
        errors: {
            outline_empty: "No text was found in that PDF. Try a screenshot of the timetable instead.",
            schedule_unreadable: "No classes could be found in that timetable. Try a clearer screenshot, or the PDF.",
            image_unsupported: "That kind of picture cannot be read. Use a PNG or JPG screenshot.",
        },
        call: (body, signal) => api.readSchedule(body, { name: file.name, today: today(), ...readContext() }, signal),
        done: (read: Schedule) => openSheet({
            kind: "schedule", name: file.name,
            plan: planSchedule(read, data, defaultTerm(schoolCal(), read.term || "", today())) as ImportPlan,
        }),
    })
}

/** Add the ticked classes and the semesters picked; a toast says what happened. */
export async function commitSchedule(plan: ImportPlan) {
    const n = scheduleCount(plan)
    const courses = plan.courses.filter((c) => c.meetings.some((m) => m.include)).length
    try {
        await commitImport(plan)
        closeSheet()
        toast("Added " + n + " class" + (n === 1 ? "" : "es") + " to " + courses + " course" + (courses === 1 ? "" : "s"))
    } catch (e) {
        toast("The classes were not all added: " + (e as Error).message, { error: true, ms: 8000 })
    }
}
