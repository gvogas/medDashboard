// The sidebar: the brand, the Open items filters, the courses, the lab-coat pocket or ID
// badge, and the slot the legacy Spotify badge draws into. It renders inside the static
// <aside id="side"> in index.html, whose .on and inert belong to legacy setSide.

import { memo, useLayoutEffect } from "react"
import { MotionConfig } from "framer-motion"
import { renderPlayer } from "@/legacy/js/views/player.js"
import { state as spotifyState } from "@/legacy/js/spotify.js"
import { useCourses, useItems } from "@/data/store"
import { useUi } from "@/data/ui"
import { openCourse, setCourse } from "@/data/actions"
import { Coat } from "./sidebar-coat"
import { Count, counts, Heading, Pip, Row } from "./sidebar-parts"
import { TypeList } from "./sidebar-types"

export function Sidebar() {
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex grow flex-col gap-6 px-1 pt-0.5">
                <div className="flex items-center gap-2.5 px-1.5 text-[16px] font-extrabold tracking-[-.01em]">
                    <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(var(--accent),color-mix(in_srgb,var(--accent)_70%,#000))] text-[14px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_2px_6px_color-mix(in_srgb,var(--accent)_40%,transparent)]">R</span>
                    Rounds
                </div>
                <TypeList />
                <CourseList />
                <div className="mt-auto flex flex-col gap-3 pt-2">
                    <Coat />
                    <Player />
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

/* Legacy renderPlayer draws into #player by id and sets its hidden and data attributes;
   this renders it once and never again, then draws what Spotify already knows. */
const Player = memo(function Player() {
    useLayoutEffect(() => { renderPlayer(spotifyState) }, [])
    return <div id="player" className="player" hidden />
})
