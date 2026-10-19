// The sidebar's Projects group (spec §15): a row per team project
// you are in, opening its sheet. Its ring shows the tasks done, in the project's colour; its
// eye hides the project from your Week and Month (spec §9), the row staying listed, dimmed.

import { cn } from "@/lib/utils"
import { useProfile, useSharedItems, useSpacePrefs, useSpaces } from "@/data/store"
import { openProject, progress, projectColour, tasksOf } from "@/data/projects"
import { TeamGlyph } from "./shared-glyph"
import { ProgressRing } from "./progress-ring"
import { Eye, Heading } from "./sidebar-parts"

export function ProjectsGroup() {
    const hidden = useProfile()?.hiddenSources ?? []
    const items = useSharedItems()
    const prefs = useSpacePrefs()
    const spaces = useSpaces()
    const projects = spaces.filter((s) => s.kind === "project").sort((a, b) => a.name.localeCompare(b.name))
    if (!projects.length) return null
    return (
        <section aria-label="Projects">
            <Heading>Projects</Heading>
            <div className="flex flex-col gap-px">
                {projects.map((p) => {
                    const source = "space:" + p.id, off = hidden.includes(source), prog = progress(tasksOf(p.id, items))
                    return (
                        <div key={p.id} className="group flex items-center rounded-[9px] hover:bg-muted">
                            <button type="button" onClick={() => openProject(p.id)}
                                className={cn("flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium hover:text-foreground", off ? "text-muted-foreground" : "text-ink-2")}>
                                <ProgressRing frac={prog.frac} color={projectColour(p, prefs, spaces)} />
                                <span className="min-w-0 truncate">{p.name}</span>
                                <span className="sr-only">, {prog.done} of {prog.total} tasks done</span>
                                <span aria-hidden="true" className="text-muted-foreground"><TeamGlyph /></span>
                                {p.archived && <span className="shrink-0 text-[11px] text-muted-foreground">Archived</span>}
                            </button>
                            <Eye source={source} name={p.name} off={off} />
                        </div>
                    )
                })}
            </div>
        </section>
    )
}
