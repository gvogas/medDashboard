// Where the music plays and how loud: the device button, its "Play on" list (with this
// tab as "This tab"; devices that take no commands disabled), and the volume.

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { activate, closeDevices, pickDevice, setVolume, toggleDevices, type SpotifySnapshot } from "@/data/spotify"
import { deviceIcon, Empty, Loading } from "./bits"

/** The device button with the volume beside it (`beside`), and the list under both when open. */
export function Devices({ s, cooling, beside }: { s: SpotifySnapshot; cooling: boolean; beside?: ReactNode }) {
    const list = s.cache.devices, open = !!list
    const box = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)

    /* A click anywhere else, or Escape, closes the list. Escape is taken before the page's
       own keys (capture), which then leave it alone. */
    useEffect(() => {
        if (!open) return
        const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) closeDevices() }
        const esc = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return
            e.preventDefault()
            closeDevices()
            button.current?.focus()
        }
        document.addEventListener("pointerdown", away, true)
        document.addEventListener("keydown", esc, true)
        return () => {
            document.removeEventListener("pointerdown", away, true)
            document.removeEventListener("keydown", esc, true)
        }
    }, [open])

    return (
        <div ref={box} className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
                <button
                    ref={button}
                    type="button"
                    aria-expanded={open}
                    title="Choose where Spotify plays"
                    onClick={() => toggleDevices()}
                    className={cn(
                        "inline-flex max-w-[200px] min-w-0 flex-none cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap text-ink-2 hover:border-primary hover:text-primary",
                        open && "border-primary text-primary",
                    )}
                >
                    <span aria-hidden="true">🔈</span>
                    <span className="min-w-0 truncate">{s.player.device || "Choose a device"}</span>
                    <span aria-hidden="true">▾</span>
                </button>
                {beside}
            </div>
            {list && (
                <div role="dialog" aria-label="Choose a device" className="overflow-hidden rounded-[10px] border border-border bg-card pb-1 shadow-[0_10px_30px_rgba(0,0,0,.14)]">
                    <div className="px-3.5 pt-2.5 pb-1 text-[9.5px] font-semibold tracking-[.12em] text-muted-foreground uppercase">Play on</div>
                    {s.busy.has("devices") && !list.length
                        ? <Loading what="Devices" cooling={cooling} />
                        : !list.length
                            ? <Empty>No devices. Open Spotify on your phone, computer or speaker.</Empty>
                            : list.map((d) => {
                                const here = d.id === s.web.deviceId
                                return (
                                    <button
                                        key={d.id}
                                        type="button"
                                        disabled={d.restricted}
                                        title={d.restricted ? "This device does not take commands" : undefined}
                                        aria-current={d.active || undefined}
                                        onClick={() => { activate(); void pickDevice(d.id) }}
                                        className={cn(
                                            "flex w-full cursor-pointer items-center gap-2.5 border-0 border-l-2 border-transparent bg-transparent px-3.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent",
                                            d.active && "border-l-primary bg-secondary font-semibold text-accent-foreground hover:bg-secondary",
                                        )}
                                    >
                                        <span aria-hidden="true" className="grid size-[26px] flex-none place-items-center rounded-[6px] bg-muted text-[13px]">{deviceIcon(d.type)}</span>
                                        <span className="min-w-0 truncate leading-[1.25]">
                                            {here ? "This tab" : d.name}
                                            <small className="block text-[10px] font-normal text-muted-foreground">{d.active ? "Playing here" : here ? "Rounds, in this browser" : d.type}</small>
                                        </span>
                                    </button>
                                )
                            })}
                </div>
            )}
        </div>
    )
}

/** The volume, where the device takes it from here; the number follows the slider at once. */
export function Volume({ s, className }: { s: SpotifySnapshot; className?: string }) {
    const p = s.player, vol = s.volume
    const can = p.connected && p.supportsVolume && vol != null
    return (
        <div
            title={can ? "Volume on " + p.device : p.device ? "This device does not take volume from here" : "Nothing is playing"}
            className={cn("flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-2", !can && "opacity-55", className)}
        >
            <span aria-hidden="true" className="flex-none">{vol === 0 ? "🔇" : vol != null && vol < 50 ? "🔉" : "🔊"}</span>
            <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={vol ?? 50}
                disabled={!can}
                aria-label="Volume"
                onChange={(e) => setVolume(+e.target.value)}
                className="m-0 h-4 min-w-[60px] flex-1 accent-[var(--accent)]"
            />
            <span className="w-[2.4em] flex-none text-right font-mono text-[11px] text-muted-foreground">{vol == null ? "—" : vol}</span>
        </div>
    )
}
