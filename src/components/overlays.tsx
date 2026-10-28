// What sits over everything, in its own root (#overlays, outside #app and #sheet): the
// keyboard shortcuts panel and the reading card while a class schedule, an outline or a school
// calendar is read with AI. While one is up, cover() (data/overlay.ts) keeps everything beneath inert.

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { closeKeys, useKeys } from "@/data/keys"
import { useBusy, type Busy } from "@/data/ai-read"
import { Button, IconButton } from "@/components/sheet/fields"

/* [keys, what they do]; two keys are a pair ('[' and ']') or a range ('1' to '5') */
export const SHORTCUTS: [string[], string][] = [
    [["n"], "New item"],
    [["t"], "Go to today"],
    [["[", "]"], "Previous / next week or month"],
    [["1", "5"], "Week, Month, All items, Study, Music"],
    [["/"], "Search"],
    [["?"], "Show this list"],
    [["Esc"], "Close a drawer or leave the focus screen"],
]

const BACKDROP = "fixed inset-0 grid place-items-center bg-[var(--scrim)] p-4 backdrop-blur-[3px] animate-[overlay-in_.18s_ease] motion-reduce:animate-none"
const CARD = "w-full rounded-[18px] border border-border bg-[linear-gradient(var(--panel),color-mix(in_srgb,var(--panel-2)_60%,var(--panel)))] shadow-[var(--lift),0_0_0_1px_var(--rim-hi),inset_0_1px_0_var(--rim-hi)] outline-none"

export function Overlays() {
    const keys = useKeys()
    const busy = useBusy()
    return (
        <>
            {keys && <Shortcuts />}
            {busy && <BusyCard busy={busy} />}
        </>
    )
}

function Shortcuts() {
    const close = useRef<HTMLButtonElement>(null)
    useEffect(() => { close.current?.focus() }, [])
    return (
        <div className={cn(BACKDROP, "z-[60]")} onClick={(e) => { if (e.target === e.currentTarget) closeKeys() }}>
            <div role="dialog" aria-modal="true" aria-labelledby="keysTitle" className={cn(CARD, "max-w-[420px] px-5 py-[18px]")}>
                <div className="mb-3 flex items-center justify-between">
                    <h2 id="keysTitle" className="m-0 text-[17px] font-[750] tracking-[-.015em]">Keyboard shortcuts</h2>
                    <IconButton ref={close} aria-label="Close" onClick={closeKeys}>✕</IconButton>
                </div>
                <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3.5 gap-y-2 text-[13px]">
                    {SHORTCUTS.map(([ks, what]) => (
                        <div key={what} className="contents">
                            <dt className="whitespace-nowrap text-muted-foreground">
                                {ks.map((k, i) => <span key={k}>{i > 0 && (ks[0] === "1" ? " – " : " ")}<kbd>{k}</kbd></span>)}
                            </dt>
                            <dd className="m-0">{what}</dd>
                        </div>
                    ))}
                </dl>
                <p className="mt-3 mb-0 text-[11.5px] text-muted-foreground">Shortcuts are off while you type in a field.</p>
            </div>
        </div>
    )
}

function BusyCard({ busy }: { busy: Busy }) {
    const card = useRef<HTMLDivElement>(null)
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(t)
    }, [])
    useEffect(() => { if (!card.current?.contains(document.activeElement)) card.current?.focus() }, [busy])
    const s = Math.floor((now - busy.started) / 1000)
    const pct = Math.round(((busy.step + 1) / (busy.steps.length + 0.3)) * 100)
    return (
        <div className={cn(BACKDROP, "z-[65]")}>
            <div
                ref={card}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="busyTitle"
                aria-describedby="busyNote"
                tabIndex={-1}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); busy.cancel() } }}
                className={cn(CARD, "flex max-w-[420px] flex-col gap-4 p-6 max-[420px]:p-5")}
            >
                <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="size-9 flex-none animate-spin rounded-full border-[3px] border-[var(--accent-soft)] border-t-[var(--accent)] [animation-duration:1s] motion-reduce:animate-none" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                        <h3 id="busyTitle" className="m-0 font-serif text-[20px] leading-tight font-medium text-foreground">{busy.title}</h3>
                        <span className="truncate font-mono text-[12px] text-muted-foreground">{busy.file}</span>
                    </span>
                </div>
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {busy.steps.map((label, i) => {
                        const done = i < busy.step, on = i === busy.step
                        return (
                            <li key={label} aria-current={on ? "step" : undefined}
                                className={cn("flex items-center gap-2.5 text-[13px]", done || on ? "text-foreground" : "text-muted-foreground", on && "font-semibold")}>
                                <span aria-hidden="true" className={cn("grid size-[18px] flex-none place-items-center rounded-full text-primary-foreground",
                                    done ? "bg-primary" : on ? "bg-[color-mix(in_srgb,var(--accent)_45%,var(--panel))]" : "bg-border")}>
                                    {done && <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8.5 3 3 7-7" /></svg>}
                                </span>
                                {label}
                                {done && <span className="sr-only"> (done)</span>}
                            </li>
                        )
                    })}
                </ol>
                <p aria-live="polite" className="sr-only">{busy.steps[busy.step]}</p>
                <span aria-hidden="true" className="block h-1 overflow-hidden rounded-sm bg-line-2">
                    <span style={{ width: pct + "%" }} className="block h-1 bg-primary transition-[width] duration-1000 ease-out motion-reduce:transition-none" />
                </span>
                <div className="flex items-center justify-between gap-3">
                    <span id="busyNote" className="text-[12px] tabular-nums text-muted-foreground">{s >= 30 ? "Still reading." : "Usually under half a minute"}{s >= 1 ? " · " + s + "s" : ""}</span>
                    <Button variant="ghost" onClick={busy.cancel}>Cancel</Button>
                </div>
            </div>
        </div>
    )
}
