// The sidebar: the name, the pages, the courses, the theme's picture and goal, the
// Spotify player, and the foot (quote, name, sync, Settings). The type filters are
// chips on All items (views/table-filters.tsx).
// It renders inside <App>'s <aside id="side">, whose .on and inert come from
// data/sidebar.ts.

import { MotionConfig } from "framer-motion"
import { useCourses, useItems, useProfile, useSpaces } from "@/data/store"
import { courseKeyOf, courseSource, keyOf } from "@/data/effective"
import { toggleSource } from "@/data/sources"
import { cn } from "@/lib/utils"
import { SharedGlyph } from "./shared-glyph"
import { useUi } from "@/data/ui"
import { THEMES } from "@/data/themes"
import { openCourse, setCourse, setSem } from "@/data/actions"
import { today } from "@/core/dates"
import { courseTerm, inTerm, pickedTerm } from "@/core/school"
import { schoolCal } from "@/data/query"
import { SidebarWho } from "./sidebar-who"
import { Count, counts, Heading, Pip, Row } from "./sidebar-parts"
import { SemesterMenu } from "./semester-menu"
import { SideNav } from "./side-nav"
import { SideFoot } from "./side-foot"
import { SidebarPlayer } from "./spotify/sidebar-player"
import { InvitesRow, NewMenu } from "./sidebar-classes"

export function Sidebar() {
    const bg = useUi((u) => u.bg)
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex grow flex-col gap-5 px-1 pt-1">
                <div className="flex items-baseline justify-between px-2.5">
                    <span className="font-serif text-[26px] font-semibold tracking-[-.01em]">Term</span>
                    <span className="text-[12px] font-medium text-accent-foreground">{THEMES[bg].label}</span>
                </div>
                <SideNav />
                <CourseList />
                <div className="mt-auto flex flex-col gap-3.5 pt-2">
                    <SidebarWho />
                    <SidebarPlayer />
                    <SideFoot />
                </div>
            </div>
        </MotionConfig>
    )
}

function CourseList() {
    const cal = schoolCal()
    const sem = useUi((ui) => ui.sem)
    const term = pickedTerm(cal, sem, today())
    /* the select shows with two semesters or more; a course goes under its own or every one */
    const picker = !!cal && cal.terms.length > 1
    const selected = useUi((ui) => ui.course)
    /* shared classes, the eye toggles and Personal items are for admins until Stage 6 */
    const profile = useProfile()
    const admin = !!profile?.isAdmin
    const hidden = profile?.hiddenSources ?? []
    const spaces = useSpaces()
    /* the course picked stays listed even when the semester shown leaves it out, so the
       filter in force can be seen; a class is a course here, by its key */
    const courses = useCourses().filter((c) => !c.archived && (keyOf(c) === selected || inTerm(cal, c.term, picker ? term : null)))
    const yearTag = cal && cal.terms.length === 2 ? "Both" : "All year"
    const items = useItems()
    const n: Record<string, number> = {}
    for (const it of items) {
        const key = courseKeyOf(it)
        if (key && counts(it)) n[key] = (n[key] || 0) + 1
    }

    return (
        <section aria-label="Courses">
            <Heading action={picker && term ? <SemesterMenu names={cal!.terms.map((t) => t.name)} value={term.name} onPick={setSem} /> : undefined}>Courses</Heading>
            <div className="flex flex-col gap-px">
                <Row pressed={selected === "all"} onClick={() => setCourse("all")}>
                    <span className="min-w-0 truncate">All courses</span>
                </Row>
                {courses.map((c) => {
                    const key = keyOf(c), source = courseSource(c), off = admin && hidden.includes(source)
                    const space = c.spaceId ? spaces.find((s) => s.id === c.spaceId) ?? null : null
                    const members = space ? space.members.length + (space.members.length === 1 ? " member" : " members") : ""
                    return (
                        <div key={key} title={space ? "Shared · " + members : undefined} className="group flex items-center rounded-[9px] hover:bg-muted">
                            <Row pressed={selected === key} dim={off && selected !== key ? true : undefined} onClick={() => setCourse(key)} className={selected === key ? undefined : "hover:bg-transparent"}>
                                <Pip color={c.color} />
                                <span className="min-w-0 truncate">{c.name}</span>
                                {space && <span className="sr-only">, shared, {members}</span>}
                                {space && <span aria-hidden="true" className="shrink-0 text-muted-foreground"><SharedGlyph /></span>}
                                {picker && !courseTerm(cal, c.term) && <span className="shrink-0 text-[11px] text-muted-foreground">{yearTag}</span>}
                                <Count n={n[key] || 0} />
                            </Row>
                            {admin && <Eye source={source} name={c.name} off={off} />}
                            <button
                                type="button"
                                aria-label={"Edit " + c.name}
                                onClick={() => openCourse(key)}
                                className="shrink-0 rounded-md border-0 bg-transparent px-2 py-1 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-primary focus-visible:opacity-100 [@media(hover:none)]:opacity-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                            >
                                ✎
                            </button>
                        </div>
                    )
                })}
                {admin && (
                    <div className="group flex items-center rounded-[9px] hover:bg-muted">
                        <span className={cn("flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-[13px] font-medium", hidden.includes("personal") ? "text-muted-foreground" : "text-ink-2")}>
                            <Pip color="var(--ink-3)" hollow />
                            <span className="min-w-0 truncate">Personal items</span>
                        </span>
                        <Eye source="personal" name="Personal items" off={hidden.includes("personal")} />
                    </div>
                )}
                {admin && <InvitesRow />}
                {admin ? <NewMenu /> : (
                    <button
                        type="button"
                        onClick={() => openCourse(null)}
                        className="mt-1.5 w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary"
                    >
                        + New course
                    </button>
                )}
            </div>
        </section>
    )
}

/** A row's eye (spec §9): hide its items and classes from your Week and Month, or show them again. A hidden row stays listed, dimmed. */
function Eye({ source, name, off }: { source: string; name: string; off: boolean }) {
    return (
        <button
            type="button"
            aria-pressed={off}
            aria-label={(off ? "Show " : "Hide ") + name + " on your calendar"}
            title={off ? "Hidden from your Week and Month" : "Hide from your Week and Month"}
            onClick={() => void toggleSource(source)}
            className={cn(
                "shrink-0 rounded-md border-0 bg-transparent px-1.5 py-1 text-muted-foreground hover:text-primary pointer-coarse:min-h-10 pointer-coarse:min-w-10",
                off ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="size-3.5">
                {off
                    ? <path d="M2 2l12 12M6.6 6.7a2 2 0 0 0 2.7 2.7M4.2 4.6C2.9 5.5 2 7 2 7s2.2 4 6 4c1 0 1.9-.3 2.7-.7M7 3.1c.3 0 .7-.1 1-.1 3.8 0 6 4 6 4s-.5 1-1.5 2" />
                    : <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.8" /></>}
            </svg>
        </button>
    )
}
