// "Share this course" in a course's sheet, for admins until Stage 6 (spec §13, §15): convert
// it into a shared class; or, when a class you are in looks like it (one made from it by a
// Stage 3 convert, or one you joined with the same code or name), merge it into that class.
// It shows nothing to anyone else, also while the admins have shared classes switched off.

import { useCourses, useProfile, useSharedCourses, useSpaces } from "@/data/store"
import { classFrom, openClass, openConvert } from "@/data/classes"
import { matchFor, openMerge } from "@/data/merge"
import { useMaintenance } from "@/data/maintenance"
import type { EffectiveCourse } from "@/data/effective"
import { SharedGlyph } from "@/components/shared-glyph"
import { Button, Note, Section } from "./fields"

export function ShareCourse({ courseId, dirty }: { courseId: string; dirty: boolean }) {
    const spaces = useSpaces(), shared = useSharedCourses()
    const own = (useCourses() as EffectiveCourse[]).filter((c) => !c.source)
    const admin = !!useProfile()?.isAdmin
    const maintenance = useMaintenance("classes")
    const made = classFrom(courseId, spaces, shared)
    const into = made ?? spaces.find((s) => s.kind === "class" && matchFor(s.id, own, shared)?.id === courseId) ?? null
    if (!admin || maintenance === "blocked") return null
    return (
        <Section title={<><SharedGlyph /> Share this course</>}>
            {into ? <>
                <Note>{made ? "You made the shared class " + into.name + " from this course." : "It looks like your shared class " + into.name + "."} Merge it, so your grades and notes sit on the class's items and the course goes.</Note>
                <span className="flex flex-wrap gap-2">
                    <Button variant="ghost" disabled={dirty} onClick={() => openMerge(into.id, courseId, true)}>Merge into the class</Button>
                    <Button variant="ghost" onClick={() => openClass(into.id)}>Open the class</Button>
                </span>
                {dirty && <Note>Save your changes first.</Note>}
            </> : <>
                <Note>Turn it into a shared class. Classmates get the dates, weights and class notes; your status, grades and notes stay yours.</Note>
                <Button variant="ghost" className="self-start" disabled={dirty} onClick={() => openConvert(courseId)}>Convert to shared class</Button>
                {dirty && <Note>Save your changes first.</Note>}
            </>}
        </Section>
    )
}
