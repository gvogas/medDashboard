// Where a chip comes from (spec §9): the two-person glyph on a class's item ("Shared · Web
// Services"), the team glyph on a project's row ("Team task · assigned to you", "Team · Fire
// Response API"), the team glyph again on an assignment a project folds into, and a "you" pip
// on an item of yours filed under a class. Your other items have none.

import { Fragment, type ReactNode } from "react"
import { SharedGlyph, TeamGlyph } from "@/components/shared-glyph"
import { data } from "@/core/store"
import type { EffectiveItem } from "@/data/effective"

const mark = (label: string, glyph: ReactNode) => (
    <span role="img" aria-label={label} title={label} className="inline-flex flex-none text-muted-foreground">{glyph}</span>
)

export function SourceMark({ item, course }: { item: EffectiveItem; course: { name: string } | null }) {
    const name = course?.name || "a class"
    if (item.source === "project") {
        const me = data.profile?.id ?? "", who = item.assignees ?? []
        if (item.type === "task") return mark(who.includes(me) || who.includes("*") ? "Team task · assigned to you" : "Team task", <TeamGlyph className="size-3" />)
        return mark("Team · " + (data.spaces?.find((s) => s.id === item.spaceId)?.name ?? "a project"), <TeamGlyph className="size-3" />)
    }
    if (item.source === "class") return (
        <>
            {mark("Shared · " + name, <SharedGlyph className="size-3" />)}
            {item.team?.map((t) => <Fragment key={t.spaceId}>{mark("Team · " + t.name, <TeamGlyph className="size-3" />)}</Fragment>)}
        </>
    )
    if (item.classId) return (
        <span role="img" aria-label={"Yours, under " + name} title={"Yours, under " + name}
            className="flex-none rounded-full bg-[var(--chip-bg)] px-1 text-[9.5px] leading-[14px] font-semibold text-[var(--chip-ink)]">you</span>
    )
    return null
}
