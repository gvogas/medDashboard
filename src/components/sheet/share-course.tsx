// "Share this course" in a course's sheet, for admins until Stage 6 (spec §13, §15): convert
// it into a shared class, or open the class already made from it. It shows nothing to anyone
// else, also while the admins have shared classes switched off.

import { useProfile, useSharedCourses, useSpaces } from "@/data/store"
import { classFrom, openClass, openConvert } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import { SharedGlyph } from "@/components/shared-glyph"
import { Button, Note, Section } from "./fields"

export function ShareCourse({ courseId, dirty }: { courseId: string; dirty: boolean }) {
    const admin = !!useProfile()?.isAdmin
    const maintenance = useMaintenance("classes")
    const made = classFrom(courseId, useSpaces(), useSharedCourses())
    if (!admin || maintenance === "blocked") return null
    return (
        <Section title={<><SharedGlyph /> Share this course</>}>
            {made ? <>
                <Note>You made the shared class {made.name} from this course.</Note>
                <Button variant="ghost" className="self-start" onClick={() => openClass(made.id)}>Open the class</Button>
            </> : <>
                <Note>Turn it into a shared class. Classmates get the dates, weights and class notes; your status, grades and notes stay yours.</Note>
                <Button variant="ghost" className="self-start" disabled={dirty} onClick={() => openConvert(courseId)}>Convert to shared class</Button>
                {dirty && <Note>Save your changes first.</Note>}
            </>}
        </Section>
    )
}
