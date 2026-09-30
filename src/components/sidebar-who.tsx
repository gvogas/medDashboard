// Who this is: the theme's picture with the person's name and goal on it, and "Headed for
// Neurologist" under it. Both open Settings: the picture at the top, the goal at its field.

import { useProfile } from "@/data/store"
import { useUi } from "@/data/ui"
import { openSettings } from "@/data/actions"
import { goalFor } from "@/data/themes"
import { SidebarPicture } from "./sidebar-picture"

export function SidebarWho() {
    const profile = useProfile()
    const bg = useUi((u) => u.bg)
    const name = profile?.coat?.name || profile?.displayName || "Your name"
    const goal = goalFor(bg, profile?.coat?.role ?? "")
    return (
        <div className="flex flex-col gap-1">
            <button type="button" title="Change theme" onClick={() => openSettings()}
                className="block cursor-pointer rounded-lg border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
                <SidebarPicture bg={bg} name={name} goal={goal} username={profile?.username || ""} />
            </button>
            <button type="button" onClick={() => openSettings("o-goal")}
                className="flex cursor-pointer items-baseline gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-left font-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
                <span className="text-[12px] text-muted-foreground">Headed for</span>
                <span className="font-serif text-[15px] font-medium text-[var(--accent)] italic">{goal}</span>
            </button>
        </div>
    )
}
