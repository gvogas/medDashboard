// Where a chip comes from (spec §9): the two-person glyph on a class's item ("Shared · Web
// Services"), and a "you" pip on an item of yours filed under a class. Your other items have
// neither.

import { SharedGlyph } from "@/components/shared-glyph"
import type { EffectiveItem } from "@/data/effective"

export function SourceMark({ item, course }: { item: EffectiveItem; course: { name: string } | null }) {
    const name = course?.name || "a class"
    if (item.source === "class") return (
        <span role="img" aria-label={"Shared · " + name} title={"Shared · " + name} className="inline-flex flex-none text-muted-foreground">
            <SharedGlyph className="size-3" />
        </span>
    )
    if (item.classId) return (
        <span role="img" aria-label={"Yours, under " + name} title={"Yours, under " + name}
            className="flex-none rounded-full bg-[var(--chip-bg)] px-1 text-[9.5px] leading-[14px] font-semibold text-[var(--chip-ink)]">you</span>
    )
    return null
}
