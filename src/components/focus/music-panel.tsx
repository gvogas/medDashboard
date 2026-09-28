// The focus screen's music, opened: "Music" and ✕ over <NowPlaying> and a compact
// <MusicBrowser> (Up next, Recent, Library and search), on glass. The focus screen places
// it (a side panel, a bottom sheet on a phone) and owns Esc and M; ✕ calls `onClose`.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { cooldownMessage, useSpotify } from "@/data/spotify"
import { FX, GLASS, Notice, SpotifyMark } from "@/components/spotify/bits"
import { NowPlaying } from "@/components/spotify/now-playing"
import { MusicBrowser } from "@/components/spotify/music-browser"
import { useCooling, useFollowTrack } from "@/components/spotify/use-music"

export interface MusicPanelProps {
    /** ✕: close the panel. */
    onClose: () => void
    className?: string
}

export function MusicPanel({ onClose, className }: MusicPanelProps) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    useFollowTrack(s)
    const p = s.player

    return (
        <aside aria-label="Music" className={cn(FX, GLASS, "flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
            <div className="flex flex-none items-center gap-2 px-4 pt-3.5 pb-2">
                <h2 className="m-0 text-[14px] font-bold text-foreground">Music</h2>
                <button type="button" onClick={onClose} aria-label="Close music" title="Close (Esc)"
                    className="ml-auto grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[15px] text-muted-foreground hover:bg-[var(--panel-2)] hover:text-foreground">✕</button>
            </div>
            {!p.loaded
                ? <Message title="Spotify">Checking your connection…</Message>
                : !p.connected
                    ? (
                        <Message title="Spotify is not connected">
                            Connect your account to search, browse your playlists, see the queue and set the volume from here.
                            <br />
                            <a href="/api/spotify/connect" className="mt-3 inline-flex rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-bold text-primary-foreground no-underline hover:brightness-110">Connect Spotify</a>
                        </Message>
                    )
                    : <>
                        <div className="flex flex-none flex-col gap-2.5 px-4 pb-3">
                            <Notice text={cooling ? cooldownMessage(s.retryAt) : s.note?.text} ok={!cooling && !!s.note?.ok} />
                            <NowPlaying compact />
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col border-t border-line-2">
                            <MusicBrowser compact />
                        </div>
                    </>}
        </aside>
    )
}

function Message({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="px-4 py-9 text-center text-[12.5px] text-muted-foreground">
            <SpotifyMark className="mx-auto mb-2 size-7" />
            <b className="mb-0.5 block font-semibold text-ink-2">{title}</b>
            {children}
        </div>
    )
}
