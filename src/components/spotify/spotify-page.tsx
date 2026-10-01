// The Music page, in #views: two Texture cards, the player on the left (<NowPlaying>,
// then Up next or Recent) and <MusicBrowser> on the right. Under 760px one column: the pill
// on top (▴ Music opens the player card), the browser under it. Space plays or pauses and /
// goes to the search box, when nothing is being typed. Not connected: Connect Spotify.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { MusicPill } from "@/components/focus/music-pill"
import { activate, control, cooldownMessage, useSpotify } from "@/data/spotify"
import { getSheet } from "@/data/overlay"
import { keysOpen } from "@/data/keys"
import { getBusy } from "@/data/ai-read"
import { getScreen } from "@/data/signin"
import { Notice, SpotifyMark } from "./bits"
import { NowPlaying } from "./now-playing"
import { MusicBrowser, UpNextRecent } from "./music-browser"
import { useCooling, useFollowTrack } from "./use-music"

/* Keys go to a control or a box when one has focus: Space presses a button, / is typed. */
const OWN_KEYS = /^(input|textarea|select|button|a)$/i

export function SpotifyPage() {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    useFollowTrack(s)
    const [playerOpen, setPlayerOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    const latest = useRef(s)
    useEffect(() => { latest.current = s })

    /* Before data/keyboard.ts (capture), which leave a key this took alone. */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.key !== "/" && e.key !== " ") || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
            const el = e.target as HTMLElement | null
            if (el && (OWN_KEYS.test(el.tagName) || el.isContentEditable)) return
            if (getSheet() || keysOpen() || getBusy() || getScreen() !== "app") return
            if (e.key === "/") {
                const box = root.current?.querySelector<HTMLInputElement>("[data-music-search]")
                if (!box) return
                e.preventDefault()
                box.focus()
                box.select()
                return
            }
            const p = latest.current.player
            if (!p.connected || e.repeat) return
            e.preventDefault()
            activate()
            void control(p.playing ? "pause" : "play")
        }
        document.addEventListener("keydown", onKey, true)
        return () => document.removeEventListener("keydown", onKey, true)
    }, [])

    if (!s.player.loaded || !s.player.connected) {
        return (
            <div ref={root} className="min-w-0">
                <Card className="min-w-0">
                    <div className="px-3.5 py-9 text-center text-[12.5px] text-muted-foreground">
                        {!s.player.loaded
                            ? <><b className="mb-0.5 block font-semibold text-ink-2">Spotify</b>Checking your connection…</>
                            : <>
                                <SpotifyMark className="mx-auto mb-2 size-7" />
                                <b className="mb-0.5 block font-semibold text-ink-2">Spotify is not connected</b>
                                Connect your account to search, browse your playlists, see the queue and set the volume from here.
                                <br />
                                <a href="/api/spotify/connect" className="mt-3 inline-flex rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_72%,#000)] bg-[linear-gradient(color-mix(in_srgb,var(--accent)_90%,#fff),color-mix(in_srgb,var(--accent)_92%,#000))] px-3.5 py-1.5 text-[12.5px] font-[650] text-primary-foreground no-underline hover:brightness-110">Connect Spotify</a>
                            </>}
                    </div>
                </Card>
            </div>
        )
    }

    return (
        <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col gap-[13px]">
            <Notice text={cooling ? cooldownMessage(s.retryAt) : s.note?.text} ok={!cooling && !!s.note?.ok} className="flex-none" />
            <div className="flex-none min-[761px]:hidden">
                <MusicPill tone="page" open={playerOpen} onOpen={() => setPlayerOpen((o) => !o)} />
            </div>
            <div className="grid min-h-0 flex-1 gap-[13px] [grid-template-columns:minmax(260px,34%)_minmax(0,1fr)] [grid-template-rows:minmax(0,1fr)] max-[760px]:flex max-[760px]:flex-col max-[760px]:overflow-y-auto">
                <SpotifyCard label="Player" className={cn(!playerOpen && "max-[760px]:hidden")}>
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3.5">
                        <NowPlaying />
                        <UpNextRecent />
                    </div>
                </SpotifyCard>
                <SpotifyCard label="Browse music">
                    <MusicBrowser />
                </SpotifyCard>
            </div>
        </div>
    )
}

/** A card whose inside fills the height left, and scrolls its own rows. */
function SpotifyCard({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    return (
        <Card className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-[760px]:flex-none", className)}>
            <section aria-label={label} className="flex min-h-0 flex-1 flex-col">{children}</section>
        </Card>
    )
}
