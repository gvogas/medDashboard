// The focus screen's music, opened: "Music" and ✕ over <NowPlaying compact> and a compact
// <MusicBrowser> (Up next, Recent and Library as pills, and search), on glass, as the
// prototype's panel (design/term-prototype.dc.html lines 1155–1205). The focus screen
// places it (a floating side panel, a bottom sheet on a phone) and owns Esc and M; ✕
// calls `onClose`.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { cooldownMessage, useSpotify } from "@/data/spotify"
import { FX, GLASS, Icon, Notice, SpotifyMark } from "@/components/spotify/bits"
import { NowPlaying } from "@/components/spotify/now-playing"
import { MusicBrowser } from "@/components/spotify/music-browser"
import { useCooling, useFollowTrack } from "@/components/spotify/use-music"

export interface MusicPanelProps {
    /** ✕: close the panel. */
    onClose: () => void
    className?: string
    /** Shown under the header (the room chat, while music is open in a room). */
    top?: ReactNode
}

export function MusicPanel({ onClose, className, top }: MusicPanelProps) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    useFollowTrack(s)
    const p = s.player

    return (
        <aside aria-label="Music" className={cn(FX, GLASS, "flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
            <div className="flex h-14 flex-none items-center gap-2 border-b border-white/10 pr-2.5 pl-5">
                <h2 className="m-0 flex-1 text-[14px] font-semibold text-foreground">Music</h2>
                <button type="button" onClick={onClose} aria-label="Close music" title="Close (Esc)"
                    className="grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-foreground hover:bg-white/10">
                    <Icon name="close" className="size-[15px]" />
                </button>
            </div>
            {top}
            {!p.loaded
                ? <Message title="Spotify">Checking your connection…</Message>
                : !p.connected
                    ? (
                        <Message title="Spotify is not connected">
                            Connect your account to search, browse your playlists, see the queue and set the volume from here.
                            <br />
                            <a href="/api/spotify/connect" className="mt-4 inline-flex h-9 items-center rounded-full bg-foreground px-4 text-[12.5px] font-semibold text-background no-underline hover:brightness-90">Connect Spotify</a>
                        </Message>
                    )
                    : <>
                        <div className="flex flex-none flex-col gap-3 border-b border-white/10 px-5 py-4">
                            <Notice text={cooling ? cooldownMessage(s.retryAt) : s.note?.text} ok={!cooling && !!s.note?.ok} />
                            <NowPlaying compact />
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col">
                            <MusicBrowser compact />
                        </div>
                    </>}
        </aside>
    )
}

function Message({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
            <SpotifyMark className="mx-auto mb-3 size-8" />
            <b className="mb-1 block text-[15px] font-semibold text-foreground">{title}</b>
            {children}
        </div>
    )
}
