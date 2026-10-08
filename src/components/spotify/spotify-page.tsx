// The Music page, in #views: two white cards, the player on the left (<NowPlaying>, then
// Up next or Recent) and <MusicBrowser> on the right, as the prototype's lines 660–797:
// the player 400px wide from 1280px, 36% (at least 280px) below that. Under 760px one
// column: the pill on top (▴ Music unfolds the player card), the browser under it. Space
// plays or pauses and / goes to the search box, when nothing is being typed. Not
// connected: Connect Spotify.

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
import { FocusButton } from "./focus-button"
import { MusicBrowser, UpNextRecent } from "./music-browser"
import { useCooling, useFollowTrack } from "./use-music"
import { SPOTIFY_CONNECT } from "@/core/native"

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
                    <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                        {!s.player.loaded
                            ? <><b className="mb-1 block font-serif text-[20px] font-medium text-foreground">Spotify</b>Checking your connection…</>
                            : <>
                                <SpotifyMark className="mx-auto mb-3 size-8" />
                                <b className="mb-1 block font-serif text-[20px] font-medium text-foreground">Spotify is not connected</b>
                                Connect your account to search, browse your playlists, see the queue and set the volume from here.
                                <br />
                                <a href={SPOTIFY_CONNECT} className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground no-underline hover:brightness-110">Connect Spotify</a>
                            </>}
                    </div>
                </Card>
            </div>
        )
    }

    return (
        <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <Notice text={cooling ? cooldownMessage(s.retryAt) : s.note?.text} ok={!cooling && !!s.note?.ok} className="flex-none" />
            <div className="flex-none min-[761px]:hidden">
                <MusicPill tone="page" open={playerOpen} onOpen={() => setPlayerOpen((o) => !o)} />
            </div>
            <div className={cn(
                "grid min-h-0 flex-1 gap-4 [grid-template-rows:minmax(0,1fr)]",
                "[grid-template-columns:minmax(280px,36%)_minmax(0,1fr)] min-[1280px]:[grid-template-columns:400px_minmax(0,1fr)]",
                "max-[760px]:flex max-[760px]:flex-col max-[760px]:overflow-y-auto",
            )}>
                <MusicCard label="Player" className={cn(!playerOpen && "max-[760px]:hidden")}>
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                        <div className="flex-none border-b border-line-2 px-[22px] pt-5 pb-4 max-[560px]:px-4">
                            <NowPlaying />
                            <FocusButton />
                        </div>
                        <div className="px-[22px] pt-3 pb-3 max-[560px]:px-4">
                            <UpNextRecent />
                        </div>
                    </div>
                </MusicCard>
                <MusicCard label="Browse music">
                    <MusicBrowser />
                </MusicCard>
            </div>
        </div>
    )
}

/** A card whose inside fills the height left, and scrolls its own rows. */
function MusicCard({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    return (
        <Card className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-[760px]:flex-none", className)}>
            <section aria-label={label} className="flex min-h-0 flex-1 flex-col">{children}</section>
        </Card>
    )
}
