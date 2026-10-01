// The library's first card on the Music page: music picked for the theme ("For the night
// shift · Picked for the Medicine theme"), the prototype's lines 729–737. Spotify gives
// apps no editorial playlists to feature and Term has none of its own, so the pick is a
// search: the card runs the theme's query (THEMES[bg].music) and the results open as any
// search does; ‹ Library comes back here.

import { search } from "@/data/spotify"
import { useUi } from "@/data/ui"
import { THEMES } from "@/data/themes"
import { Icon } from "./bits"
import { openRoot } from "./use-music"

export function ForTheme() {
    const bg = useUi((u) => u.bg)
    const theme = THEMES[bg], m = theme.music
    return (
        <section aria-label={"For " + m.word} className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="m-0 text-[14px] font-semibold text-foreground">For {m.word}</h3>
                <span className="truncate text-[12px] text-muted-foreground @max-[560px]:hidden">Picked for the {theme.label} theme</span>
            </div>
            <button
                type="button"
                onClick={() => openRoot(() => search(m.query))}
                className="grid cursor-pointer grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-[18px] rounded-[10px] border-0 bg-secondary p-3.5 text-left font-[inherit] hover:brightness-[.98] @max-[560px]:grid-cols-[64px_minmax(0,1fr)] @max-[560px]:gap-3"
            >
                <span aria-hidden="true" className="grid aspect-square w-full place-items-center rounded-[6px] bg-primary text-primary-foreground">
                    <Icon name="search" className="size-1/3" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[12px] text-ink-2">Search on Spotify</span>
                    <span className="truncate font-serif text-[26px] leading-[1.15] font-medium text-foreground @max-[560px]:text-[20px]">{m.name}</span>
                    <span className="truncate text-[13px] text-ink-2">Playlists and tracks for “{m.query}”</span>
                </span>
                <span aria-hidden="true" className="grid size-[52px] place-items-center rounded-full bg-primary text-primary-foreground @max-[560px]:hidden">
                    <Icon name="arrow" className="size-[18px]" />
                </span>
            </button>
        </section>
    )
}
