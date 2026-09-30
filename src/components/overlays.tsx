// What sits over everything, in its own root (#overlays, outside #app and #sheet): the
// keyboard shortcuts panel and the busy card while an outline or school calendar is read
// with AI. While one is up, cover() (data/overlay.ts) keeps everything beneath inert.

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { closeKeys, useKeys } from "@/data/keys"
import { useBusy, type Busy } from "@/data/ai-read"
import { IconButton } from "@/components/sheet/fields"

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
    return (
        <div className={cn(BACKDROP, "z-[65]")}>
            <div ref={card} role="alertdialog" aria-modal="true" aria-labelledby="busyTitle" tabIndex={-1} className={cn(CARD, "max-w-[340px] px-[22px] pt-[26px] pb-5 text-center")}>
                <div aria-hidden="true" className="mx-auto mb-3.5 size-[42px] animate-spin rounded-full border-[3.5px] border-[var(--accent-soft)] border-t-[var(--accent)] [animation-duration:.8s] motion-reduce:animate-none" />
                <h3 id="busyTitle" className="m-0 mb-1 text-[17px] font-[750] tracking-[-.015em]">{busy.title}</h3>
                <p className="m-0 mb-3 truncate text-[12px] text-muted-foreground">{busy.file}</p>
                <p aria-live="polite" className="m-0 mb-1.5 text-[13px] font-semibold text-accent-foreground">{busy.stage}</p>
                <p className="m-0 text-[12px] leading-[1.45] text-ink-2">Please wait and keep this tab open. It usually takes 10 to 30 seconds.</p>
                <p className="mt-2 mb-0 min-h-[1em] text-[11px] tabular-nums text-muted-foreground">{s < 1 ? "" : s + "s"}</p>
            </div>
        </div>
    )
}
