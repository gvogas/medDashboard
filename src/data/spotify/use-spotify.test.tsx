// useSpotify() redraws on the engine's changes and keeps its snapshot between them.
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { state as player } from "./player"
import { state as web } from "./web-player"
import { changed } from "./signal"
import { say } from "./library"
import { useSpotify, type SpotifySnapshot } from "./index"

afterEach(() => { cleanup(); vi.useRealTimers() })

function Probe({ seen }: { seen: SpotifySnapshot[] }) {
    const s = useSpotify()
    seen.push(s)
    return (
        <div>
            <span data-testid="track">{s.player.track ? s.player.track.title : "none"}</span>
            <span data-testid="progress">{s.player.track?.progressMs ?? 0}</span>
            <span data-testid="target">{String(s.target)}</span>
            <span data-testid="note">{s.note?.text ?? ""}</span>
        </div>
    )
}

describe("useSpotify", () => {
    it("redraws when the engine says something changed, and not otherwise", () => {
        const seen: SpotifySnapshot[] = []
        const { rerender } = render(<Probe seen={seen} />)
        expect(screen.getByTestId("track").textContent).toBe("none")

        act(() => {
            Object.assign(player, { loaded: true, connected: true, playing: true, deviceId: null, track: { uri: "spotify:track:t1", title: "Weightless", artists: "Marconi Union", album: "", art: null, url: null, durationMs: 489000, progressMs: 1000 } })
            Object.assign(web, { status: "ready", deviceId: "roundsdev" })
            changed()
        })
        expect(screen.getByTestId("track").textContent).toBe("Weightless")
        expect(screen.getByTestId("target").textContent).toBe("here")
        const first = seen.at(-1)!
        expect(first.isNow("spotify:track:t1")).toBe(true)

        /* the progress line moves in place in the engine; the snapshot's copy does not */
        act(() => { player.track!.progressMs = 2000; changed() })
        expect(screen.getByTestId("progress").textContent).toBe("2000")
        expect(first.player.track?.progressMs).toBe(1000)

        /* a redraw from above, with nothing new, reuses the snapshot */
        const before = seen.at(-1)
        rerender(<Probe seen={seen} />)
        expect(seen.at(-1)).toBe(before)
    })

    it("shows a note and clears it when it expires", () => {
        vi.useFakeTimers()
        render(<Probe seen={[]} />)
        act(() => { say("Playing.", 1500, true) })
        expect(screen.getByTestId("note").textContent).toBe("Playing.")
        act(() => { vi.advanceTimersByTime(1500) })
        expect(screen.getByTestId("note").textContent).toBe("")
    })
})
