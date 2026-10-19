// The sidebar's Projects group (spec §15), for admins until Stage 10: a row per team project
// you are in, opening its sheet. Stage 9 adds each one's progress ring and its eye.

import { useProfile, useSpaces } from "@/data/store"
import { openProject, projectsShown } from "@/data/projects"
import { TeamGlyph } from "./shared-glyph"
import { Heading } from "./sidebar-parts"

export function ProjectsGroup() {
    useProfile()
    const projects = useSpaces().filter((s) => s.kind === "project").sort((a, b) => a.name.localeCompare(b.name))
    if (!projectsShown() || !projects.length) return null
    return (
        <section aria-label="Projects">
            <Heading>Projects</Heading>
            <div className="flex flex-col gap-px">
                {projects.map((p) => (
                    <button key={p.id} type="button" onClick={() => openProject(p.id)}
                        className="flex w-full min-w-0 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-foreground">
                        <span aria-hidden="true" className="text-muted-foreground"><TeamGlyph /></span>
                        <span className="min-w-0 truncate">{p.name}</span>
                        {p.archived && <span className="shrink-0 text-[11px] text-muted-foreground">Archived</span>}
                    </button>
                ))}
            </div>
        </section>
    )
}
