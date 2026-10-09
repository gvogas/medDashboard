// A class schedule read with AI (worker/schedule.js): the courses it found, matched to yours
// (core/importers/plan.ts, planSchedule), shown in the schedule sheet with a semester and a
// tick per class, and written on "Add N classes" through the import's commit. Nothing is
// saved before. A screenshot is made smaller here first (core/image.ts); a PDF goes as its
// text with its grid read from the page layout (core/pdftext.ts, pdfTimetable).

import { data } from "@/core/store"
import { today } from "@/core/dates"
import { planSchedule, type Schedule } from "@/core/importers/plan"
import { shrinkImage } from "@/core/image"
import { pdfTimetable } from "@/core/pdftext"
import { api } from "@/core/api"
import { schoolCal } from "@/data/query"
import { notify } from "@/bridge"
import { isPdf, MAX_FILE, readWithAi, type NoteKey } from "./ai-read"
import { readContext } from "./ai-context"
import { commitImport, defaultTerm, type ImportPlan } from "./import-edit"
import { closeSheet, openSheet } from "./overlay"
import { toast } from "./toast"

export const isImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name)

/** What "Add N classes" adds: the ticked classes. */
export const scheduleCount = (plan: ImportPlan) => plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length, 0)

/** The courses of yours whose semester was changed in the preview. */
export const semesterChanges = (plan: ImportPlan) =>
    plan.courses.filter((c) => !c.isNew && c.term !== undefined && c.term !== ((data.courses as { id: string; term?: string }[]).find((x) => x.id === c.id)?.term ?? "")).length

/** A timetable was picked: read it with AI, then check it in the schedule sheet. */
export function readScheduleFile(file: File, note: NoteKey = "aiNote") {
    return readWithAi(file, {
        what: "timetable", title: "Reading your timetable",
        steps: ["Reading the timetable", "Finding courses and class times", "Matching them to your courses"],
        flag: "scheduleBusy", note, refresh: notify,
        prepare: async (f) => (isImage(f) ? shrinkImage(f) : isPdf(f) ? new Blob([await pdfTimetable(f)], { type: "text/plain" }) : f),
        /* a phone or retina screenshot can be over 5 MB; what is sent is a 1600 px JPEG */
        maxBytes: isImage(file) ? 4 * MAX_FILE : MAX_FILE,
        errors: {
            outline_empty: "No text was found in that PDF. Try a screenshot of the timetable instead.",
            schedule_unreadable: "No classes could be found in that timetable. Try a clearer screenshot, or the PDF.",
            image_unsupported: "That kind of picture cannot be read. Use a PNG or JPG screenshot.",
            /* the Worker takes a picture of up to 4 MB, made smaller first; not "over 5 MB" */
            ...(isImage(file) ? { too_large: "That picture is too large." } : {}),
        },
        cache: ["timetable", String(data.profile?.id ?? ""), today().slice(0, 7), JSON.stringify(readContext())],
        call: (body, signal) => api.readSchedule(body, { name: file.name, today: today(), ...readContext() }, signal),
        done: (read: Schedule) => openSheet({
            kind: "schedule", name: file.name,
            plan: planSchedule(read, data, defaultTerm(schoolCal(), read.term || "", today())) as ImportPlan,
        }),
    })
}

/** "1 class", "2 classes". */
export const plural = (n: number, one: string, many = one + "s") => n + " " + (n === 1 ? one : many)

/** Add the ticked classes and the semesters picked; a toast says what happened. True when saved
    (the sheet is then closed). */
export async function commitSchedule(plan: ImportPlan): Promise<boolean> {
    const n = scheduleCount(plan)
    const added = plan.courses.filter((c) => c.meetings.some((m) => m.include))
    /* the courses of yours given only a new semester */
    const terms = semesterChanges({ ...plan, courses: plan.courses.filter((c) => !added.includes(c)) })
    try {
        await commitImport(plan)
        closeSheet()
        toast(n
            ? "Added " + plural(n, "class", "classes") + " to " + plural(added.length, "course") + (terms ? " and updated the semester of " + plural(terms, "other course") : "")
            : "Updated the semester of " + plural(terms, "course"))
        return true
    } catch (e) {
        toast((n ? "The classes were not all added: " : "The semesters were not saved: ") + (e as Error).message, { error: true, ms: 8000 })
        return false
    }
}
