// The sidebar: the name, the pages, the courses, the Open items filters, the lab-coat
// pocket or ID badge, the Spotify player, and the foot (quote, name, sync, Settings).
// It renders inside <App>'s <aside id="side">, whose .on and inert come from
// data/sidebar.ts.

import { MotionConfig } from "framer-motion"
import { useCourses, useItems } from "@/data/store"
import { useUi } from "@/data/ui"
import { openCourse, setCourse } from "@/data/actions"
import { Coat } from "./sidebar-coat"
import { Count, counts, Heading, Pip, Row } from "./sidebar-parts"
import { TypeList } from "./sidebar-types"
import { SideNav } from "./side-nav"
import { SideFoot } from "./side-foot"
import { SidebarPlayer } from "./spotify/sidebar-player"

export function Sidebar() {
    const bg = useUi((u) => u.bg)
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex grow flex-col gap-5 px-1 pt-1">
                <div className="flex items-baseline justify-between px-2.5">
                    <span className="font-serif text-[26px] font-semibold tracking-[-.01em]">Term</span>
                    <span className="text-[12px] font-medium text-accent-foreground">{bg === "cs" ? "Computer Science" : "Medicine"}</span>
                </div>
                <SideNav />
                <CourseList />
                <TypeList />
                <div className="mt-auto flex flex-col gap-3.5 pt-2">
                    <Coat />
                    <SidebarPlayer />
                    <SideFoot />
                </div>
            </div>
        </MotionConfig>
    )
}

function CourseList() {
    const courses = useCourses().filter((c) => !c.archived)       // legacy activeCourses()
    const items = useItems()
    const selected = useUi((ui) => ui.course)
    const n: Record<string, number> = {}
    for (const it of items) if (it.courseId && counts(it)) n[it.courseId] = (n[it.courseId] || 0) + 1

    return (
        <section aria-label="Courses">
            <Heading>Courses</Heading>
            <div className="flex flex-col gap-px">
                <Row pressed={selected === "all"} onClick={() => setCourse("all")}>
                    <span className="min-w-0 truncate">All courses</span>
                </Row>
                {courses.map((c) => (
                    <div key={c.id} className="group flex items-center rounded-[9px] hover:bg-muted">
                        <Row pressed={selected === c.id} onClick={() => setCourse(c.id)} className={selected === c.id ? undefined : "hover:bg-transparent"}>
                            <Pip color={c.color} />
                            <span className="min-w-0 truncate">{c.name}</span>
                            <Count n={n[c.id] || 0} />
                        </Row>
                        <button
                            type="button"
                            aria-label={"Edit " + c.name}
                            onClick={() => openCourse(c.id)}
                            className="shrink-0 rounded-md border-0 bg-transparent px-2 py-1 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-primary focus-visible:opacity-100 [@media(hover:none)]:opacity-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                        >
                            ✎
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() => openCourse(null)}
                    className="mt-1.5 w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary"
                >
                    + New course
                </button>
            </div>
        </section>
    )
}
