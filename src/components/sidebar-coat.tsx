// Who this is: the lab-coat pocket with the name embroidered (Med), or a lanyard ID badge
// (CS). Both are drawn; data-bg on <html> shows one. The coat colour is --coat, which
// Settings sets on <html>.

import { useProfile } from "@/data/store"
import { openSettings } from "@/data/actions"

const editButton = "ml-0.5 rounded border-0 bg-transparent px-1 py-0 align-middle text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-primary [@media(hover:none)]:opacity-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10"

export function Coat() {
    const profile = useProfile()
    const coat = profile?.coat ?? { name: "", role: "" }
    const name = coat.name || profile?.displayName || "Your name"
    return (
        <>
            <Pocket name={name} role={coat.role} />
            <IdBadge name={name} role={coat.role} username={profile?.username || ""} />
        </>
    )
}

function Pocket({ name, role }: { name: string; role: string }) {
    return (
        <div className="group relative rounded-[3px_3px_8px_8px] border border-t-2 border-[color:color-mix(in_srgb,var(--coat)_26%,var(--line))] border-t-[color:color-mix(in_srgb,var(--coat)_40%,var(--line))] bg-[linear-gradient(color-mix(in_srgb,var(--coat)_7%,var(--pocket-a)),color-mix(in_srgb,var(--coat)_14%,var(--pocket-b)))] px-3 pt-3 pb-3.5 before:absolute before:inset-x-[7px] before:top-1 before:border-t before:border-dashed before:border-[color:color-mix(in_srgb,var(--coat)_62%,transparent)] before:content-[''] [[data-bg=cs]_&]:hidden">
            <span aria-hidden="true" className="absolute top-[-7px] right-3 h-10 w-[9px] rounded-[2px_2px_4px_4px] bg-[#3C6E8F] after:absolute after:inset-x-px after:top-[-6px] after:h-[13px] after:rounded-[3px] after:bg-[#B9C7CC] after:content-['']" />
            <div className="font-[family-name:Spectral,Georgia,serif] text-[14px] font-semibold text-[color:color-mix(in_srgb,var(--coat)_74%,var(--ink))] italic">
                <span>{name}</span>
                <button type="button" className={editButton} aria-label="Edit the name on the coat" onClick={() => openSettings("o-name")}>✎</button>
            </div>
            {role && <div className="mt-px text-[9.5px] tracking-[.13em] text-muted-foreground uppercase">{role}</div>}
            <svg viewBox="0 0 60 34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"
                className="absolute right-[27px] bottom-[5px] h-7 w-[50px] text-primary opacity-[var(--orn-art)]">
                <path d="M4 6c0 9 7 8 9 14s7 9 14 8 12-6 18-6" /><path d="M11 4c0 7 4 8 6 12" />
                <circle cx="50" cy="20" r="6" /><circle cx="50" cy="20" r="2.6" /><path d="M44.6 21.6 42 23" />
            </svg>
        </div>
    )
}

/* ── the CS ID badge: an identicon and a barcode drawn from the username, so they stay
   the same for each person ── */

/** FNV-1a. */
export function hash(text: string): number {
    let h = 2166136261
    for (const ch of text) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) }
    return h >>> 0
}

/** 5×5 cells, mirrored like a GitHub avatar. */
export function identicon(seed: string): boolean[] {
    const h = hash(seed), cells: boolean[] = []
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells.push(((h >>> (r * 3 + (c < 3 ? c : 4 - c))) & 1) === 1)
    return cells
}

/** Bar widths 1–3, with a gap after every third. 0 is a gap. */
export function barcode(seed: string): number[] {
    const g = hash(seed + ":bars"), bars: number[] = []
    for (let i = 0; i < 30; i++) {
        bars.push(1 + ((g >>> (i % 29)) & 1) + ((i * 7 + g) % 3 === 0 ? 1 : 0))
        if (i % 3 === 2) bars.push(0)
    }
    return bars
}

function IdBadge({ name, role, username }: { name: string; role: string; username: string }) {
    const seed = username || name
    const [lead, ...rest] = role.split("·").map((x) => x.trim())
    return (
        <div className="group relative hidden overflow-hidden rounded-[10px] border border-border bg-card shadow-[var(--shadow-1),0_6px_14px_rgba(23,32,51,.06)] [[data-bg=cs]_&]:block">
            <div className="flex h-6 items-center justify-between bg-primary px-2.5 font-mono text-[9px] font-semibold tracking-[.12em] text-primary-foreground">
                <span>TERM</span><span>STUDENT</span>
            </div>
            <i aria-hidden="true" className="absolute top-[7px] left-1/2 -ml-[13px] h-1.5 w-[26px] rounded-[3px] bg-card shadow-[inset_0_1px_1px_rgba(0,0,0,.25)]" />
            <div className="flex items-center gap-2.5 px-2.5 pt-2.5 pb-2">
                <span aria-hidden="true" className="grid size-[38px] shrink-0 grid-cols-5 gap-px rounded-[7px] bg-accent p-1">
                    {identicon(seed).map((on, i) => <i key={i} className={on ? "rounded-[1px] bg-primary" : "rounded-[1px]"} />)}
                </span>
                <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13.5px] leading-tight font-bold tracking-[-.01em]">
                        {name}
                        <button type="button" className={editButton} aria-label="Edit the name on the badge" onClick={() => openSettings("o-name")}>✎</button>
                    </span>
                    {role && (
                        <span className="mt-0.5 truncate font-mono text-[10px] text-ink-2">
                            <b className="font-semibold text-accent-foreground">{lead}</b>{rest.length ? " · " + rest.join(" · ") : ""}
                        </span>
                    )}
                </span>
            </div>
            <div className="flex items-center gap-2 border-t border-dashed border-border px-2.5 pt-1.5 pb-2">
                <span aria-hidden="true" className="flex h-3.5 min-w-0 flex-1 items-stretch gap-px">
                    {barcode(seed).map((w, i) => (
                        <i key={i} className={w ? "bg-foreground opacity-75" : ""} style={{ flex: `${w || 1} 0 0` }} />
                    ))}
                </span>
                {username && <span className="max-w-1/2 truncate font-mono text-[9px] tracking-[.04em] text-muted-foreground">@{username}</span>}
            </div>
        </div>
    )
}
