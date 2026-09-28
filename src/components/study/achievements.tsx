// The Achievements card on the Study page: how many are earned, the three badges closest
// to done, then every group as round medals (earned ones filled and dated, locked ones
// hollow with a ring for how far along), and last your own stickers. Each medal has the
// id the unlock toast's See looks for (ach-<id>), and pops when it is found.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { dayMonth } from "@/core/dates"
import { GROUPS } from "@/core/achievements"
import { ACHIEVEMENT_LIMIT } from "@/core/model"
import { Panel } from "@/components/views/bits"
import { useBadges } from "@/data/study"
import { openAchievement } from "@/data/actions"
import type { Badge } from "@/data/types"

/* Each group's colour, as --g (the ring and tick), --g-soft (the medal) and --g-ink (its words). */
const TONE: Record<string, string> = {
    hours: "[--g:var(--study)] [--g-soft:var(--study-soft)] [--g-ink:var(--study-ink)]",
    streak: "[--g:#E08A3C] [--g-soft:var(--amber-bg)] [--g-ink:var(--amber-ink)] dark:[--g:#E9A25E]",
    days: "[--g:var(--accent)] [--g-soft:var(--accent-soft)] [--g-ink:var(--accent-ink)]",
    tasks: "[--g:var(--good)] [--g-soft:color-mix(in_srgb,var(--good)_16%,var(--panel))] [--g-ink:var(--good)]",
    exams: "[--g:var(--break)] [--g-soft:var(--break-soft)] [--g-ink:var(--break-ink)]",
    grades: "[--g:#D9A21E] [--g-soft:color-mix(in_srgb,#E8B33A_20%,var(--panel))] [--g-ink:#855D00] dark:[--g-ink:#F0C96A]",
    own: "[--g:var(--coat)] [--g-soft:color-mix(in_srgb,var(--coat)_16%,var(--panel))] [--g-ink:color-mix(in_srgb,var(--coat)_70%,var(--ink))]",
}

/* The unlock toast's See adds .pop to the medal's <li> (showAchievement in study-controller.js). */
const POP = "group-[.pop]:motion-safe:animate-[ach-pop_1.4s_ease-out_1]"

export function AchievementsCard({ className }: { className?: string }) {
    const b = useBadges()
    return (
        <div className={cn("min-w-0", className)}>
            <Panel
                label="Achievements"
                title="Achievements"
                head={<>
                    <span className="text-[13px] text-ink-2 tabular-nums"><b className="font-bold text-foreground">{b.earned}</b> of {b.total}</span>
                    <span aria-hidden="true" className="h-1.5 min-w-[120px] flex-[1_1_160px] overflow-hidden rounded-full bg-line-2">
                        <i style={{ width: b.total ? Math.round((b.earned / b.total) * 1000) / 10 + "%" : "0%" }} className="block h-full rounded-full bg-[var(--accent)]" />
                    </span>
                </>}
            >
                <div className="@container flex flex-col gap-4 p-3.5">
                    {b.next.length > 0 && (
                        <section aria-labelledby="achNext" className="flex flex-col gap-2.5">
                            <h3 id="achNext" className="m-0 text-[11px] font-semibold tracking-[.1em] text-muted-foreground uppercase">Next up</h3>
                            <ul className="m-0 grid list-none grid-cols-3 gap-2.5 p-0 @max-[640px]:grid-cols-1">
                                {b.next.map((x) => (
                                    <li key={x.id} className={cn("flex min-w-0 items-center gap-3 rounded-[11px] border border-line-2 bg-muted px-3 py-2.5", TONE[x.group])}>
                                        <Medal b={x} />
                                        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                            <b className="truncate text-[13.5px] font-bold text-foreground">{x.name}</b>
                                            <span className="text-[12px] text-ink-2 tabular-nums">{x.progress}</span>
                                            <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-border">
                                                <i style={{ width: Math.round(x.frac * 1000) / 10 + "%" }} className="block h-full rounded-full bg-[var(--g)]" />
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <div className="grid grid-cols-2 gap-3 @max-[520px]:grid-cols-1">
                        {(GROUPS as [string, string][]).map(([g, name]) => {
                            const mine = b.builtIn.filter((x) => x.group === g)
                            return (
                                <Group key={g} group={g} name={name} count={mine.filter((x) => x.earned).length + " / " + mine.length}>
                                    <ul className="m-0 flex list-none flex-wrap items-start gap-1.5 p-0">
                                        {mine.map((x) => <BadgeItem key={x.id} b={x} />)}
                                    </ul>
                                </Group>
                            )
                        })}
                        <Own own={b.own} />
                    </div>
                </div>
            </Panel>
        </div>
    )
}

function Group({ group, name, count, className, children }: { group: string; name: string; count: string; className?: string; children: ReactNode }) {
    return (
        <div role="group" aria-label={name} className={cn("min-w-0 rounded-[11px] border border-line-2 px-3 pt-3 pb-3.5", TONE[group], className)}>
            <div className="mb-3 flex items-center gap-2">
                <span aria-hidden="true" className="grid size-6 place-items-center rounded-[7px] bg-[var(--g-soft)] text-[var(--g-ink)] [&_svg]:size-3.5">{ICONS[group]}</span>
                <h4 className="m-0 text-[13px] font-bold text-foreground">{name}</h4>
                <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">{count}</span>
            </div>
            {children}
        </div>
    )
}

const RING = 2 * Math.PI * 28

/** The round medal: filled with a tick when earned; hollow, with a ring for how far along, when not. */
function Medal({ b }: { b: Badge }) {
    return (
        <span aria-hidden="true" className={cn(
            "relative grid size-[52px] flex-none place-items-center rounded-full text-[13px] font-extrabold tracking-[-.01em] tabular-nums",
            b.earned
                ? "bg-[var(--g-soft)] text-[var(--g-ink)] shadow-[inset_0_0_0_2px_var(--g),0_2px_6px_color-mix(in_srgb,var(--g)_25%,transparent)]"
                : "bg-muted text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--line)]",
            POP,
        )}>
            {b.earned
                ? (
                    <span className="absolute -right-px -bottom-px grid size-[18px] place-items-center rounded-full border-2 border-card bg-[var(--g)] text-card">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="size-2.5"><path d="M4 8.5l2.5 2.5L12 5.5" /></svg>
                    </span>
                )
                : b.frac > 0 && b.frac < 1 && (
                    <svg viewBox="0 0 60 60" className="pointer-events-none absolute -inset-1 size-[60px]">
                        <circle cx="30" cy="30" r="28" fill="none" strokeWidth="3" strokeLinecap="round" transform="rotate(-90 30 30)"
                            strokeDasharray={(RING * b.frac).toFixed(1) + " " + RING.toFixed(1)} className="stroke-[var(--g)]" />
                    </svg>
                )}
            {b.tier}
        </span>
    )
}

/** A built-in badge: its medal, name, and the day earned, else how far along (a grade's best, for Grades). */
function BadgeItem({ b }: { b: Badge }) {
    const sub = b.earned ? dayMonth(b.earnedOn) : b.group === "grades" ? b.progress : Math.floor(b.frac * 100) + "%"
    const label = b.name + ": " + b.blurb + ". " + (b.earned ? "Earned " + dayMonth(b.earnedOn) : b.progress)
    return (
        <li id={"ach-" + b.id} title={label} aria-label={label} className="group flex w-[62px] flex-col items-center gap-[5px] text-center">
            <Medal b={b} />
            <span className={cn("text-[11.5px] leading-[1.2]", b.earned ? "font-semibold text-foreground" : "font-medium text-ink-2")}>{b.name}</span>
            <span className="text-[10.5px] leading-[1.2] text-muted-foreground tabular-nums">{sub}</span>
        </li>
    )
}

/* An earned sticker is stuck on at a tilt, the same one each time (from its id). */
const TILT = ["-rotate-7", "-rotate-3", "rotate-2", "rotate-5", "rotate-8"]
const tiltOf = (id: string) => TILT[[...id].reduce((t, ch) => t + ch.charCodeAt(0), 0) % TILT.length]

/** Your own: each sticker opens its sheet; + New makes another, up to the limit. */
function Own({ own }: { own: Badge[] }) {
    const full = own.length >= ACHIEVEMENT_LIMIT
    return (
        <Group group="own" name="Your own" count={own.filter((x) => x.earned).length + " / " + own.length} className="col-span-full">
            {own.length === 0 && (
                <p className="m-0 mb-2.5 text-[12.5px] text-ink-2">Make your own: upload a sticker, then pick what earns it, hours on a course or a grade on an exam.</p>
            )}
            <ul className="m-0 flex list-none flex-wrap items-start gap-2.5 p-0">
                {own.map((x) => {
                    const when = x.earned ? dayMonth(x.earnedOn) : x.progress
                    return (
                        <li key={x.id} id={"ach-" + x.id} className="group w-[84px]">
                            <button type="button" onClick={() => openAchievement(x.ownId!)} aria-label={x.name + ", " + (x.earned ? "earned " + when : when) + ". Edit"} className={STICKER_BUTTON}>
                                {x.sticker
                                    ? <img src={x.sticker} alt="" width={64} height={64} decoding="async" className={cn(
                                        "block size-16 drop-shadow-[0_2px_3px_rgba(0,0,0,.25)] transition-transform duration-200 motion-reduce:transition-none",
                                        x.earned ? tiltOf(x.ownId!) : "opacity-40 grayscale", POP,
                                    )} />
                                    : <span aria-hidden="true" className="block size-[52px] rounded-full bg-muted shadow-[inset_0_0_0_1.5px_var(--line)]" />}
                                <span className={cn("text-[11.5px] leading-[1.2]", x.earned ? "font-semibold text-foreground" : "font-medium text-ink-2")}>{x.name}</span>
                                <span className="max-w-[84px] text-[10.5px] leading-[1.2] text-muted-foreground tabular-nums">{when}</span>
                            </button>
                        </li>
                    )
                })}
                <li className="w-[84px]">
                    <button type="button" disabled={full} onClick={() => openAchievement(null)} className={cn(STICKER_BUTTON, "group/add")}>
                        <span aria-hidden="true" className={cn(
                            "grid size-16 place-items-center rounded-full border-[1.5px] border-dashed border-border text-[24px] font-medium text-muted-foreground",
                            !full && "group-hover/add:border-[var(--accent)] group-hover/add:text-[var(--accent)]",
                        )}>+</span>
                        <span className="text-[11.5px] leading-[1.2] font-semibold text-foreground">New</span>
                        <span className="text-[10.5px] leading-[1.2] text-muted-foreground">{full ? ACHIEVEMENT_LIMIT + " is the most" : "sticker"}</span>
                    </button>
                </li>
            </ul>
        </Group>
    )
}

const STICKER_BUTTON = "flex w-full cursor-pointer flex-col items-center gap-[5px] rounded-[10px] border-0 bg-transparent px-0 py-1 text-center font-[inherit] text-inherit hover:bg-muted focus-visible:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"

const ICONS: Record<string, ReactNode> = {
    hours: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.4" /></svg>,
    streak: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1 2.6 2.3 3.1C11 8.5 11.3 5.5 12 3z" /></svg>,
    days: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
    tasks: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3L13 4.5" /></svg>,
    exams: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M4 2h6l2.5 2.5V14H4z" /><path d="M6 7h4.5M6 9.5h4.5M6 12h2.5" strokeLinecap="round" /></svg>,
    grades: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>,
    own: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 2.5h10v6.5L9 13H3z" /><path d="M9 13V9h4" /></svg>,
}
