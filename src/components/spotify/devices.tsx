// Where the music plays and how loud: the device button (Spotify's green dot, the device,
// ▾), its "Play on" list (this tab as "This tab", a tick on the device that plays, devices
// that take no commands disabled), and the volume. The prototype's lines 688–699.

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { activate, closeDevices, pickDevice, setVolume, toggleDevices, type SpotifySnapshot } from "@/data/spotify"
import { Empty, Icon, Loading } from "./bits"

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
            <div className="flex min-w-0 items-center gap-3">
                <button
                    ref={button}
                    type="button"
                    aria-expanded={open}
                    title="Choose where Spotify plays"
                    onClick={() => toggleDevices()}
                    className={cn(
                        "inline-flex h-[34px] max-w-[190px] min-w-0 flex-none cursor-pointer items-center gap-2 rounded-full border bg-card px-3 text-[12.5px] whitespace-nowrap text-foreground hover:border-primary",
                        open ? "border-primary" : "border-border",
                    )}
                >
                    <span aria-hidden="true" className="size-2 flex-none rounded-full bg-[var(--spotify)]" />
                    <span className="min-w-0 truncate">{s.player.device || "Choose a device"}</span>
                    <Icon name="down" className="size-2.5" />
                </button>
                {beside}
            </div>
            {list && (
                <div role="dialog" aria-label="Choose a device" className="overflow-hidden rounded-[10px] border border-border bg-card py-1.5 shadow-[var(--shadow-2)]">
                    <div className="px-3.5 pt-1 pb-1.5 text-[11px] font-semibold text-muted-foreground">Play on</div>
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
                                            "flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 px-3.5 text-left disabled:cursor-default disabled:opacity-50",
                                            d.active ? "bg-secondary" : "bg-transparent hover:bg-[var(--line-2)] disabled:hover:bg-transparent",
                                        )}
                                    >
                                        <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                                            <span className={cn("truncate text-[13px] text-foreground", d.active && "font-semibold")}>{here ? "This tab" : d.name}</span>
                                            <small className="truncate text-[11.5px] text-muted-foreground">{d.active ? "Playing here" : here ? "Term, in this browser" : d.type}</small>
                                        </span>
                                        {d.active && <Icon name="check" className="size-3.5 text-primary" />}
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
            className={cn("flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted-foreground", !can && "opacity-55", className)}
        >
            <Icon name={vol === 0 ? "mute" : "volume"} className="size-[15px]" />
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
            <span className="w-[26px] flex-none text-right font-mono text-[11.5px]">{vol == null ? "—" : vol}</span>
        </div>
    )
}
