// The Buddy page, in #views while gameplay is on: the buddy at its rank and mood, the XP and
// health bars, the streak and coins; then the ranks with Claim, the buddy picker, and the last
// coins earned. Everything comes from GET /api/buddy (data/buddy.ts); nothing is worked out here.

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Panel, HeadNote } from "@/components/views/bits"
import { Button, Note } from "@/components/sheet/fields"
import { BUDDIES, BUDDY_ORDER, buddyFor, rankName, type BuddyId } from "@/core/buddy-art"
import { TIERS, moodOf } from "@/core/buddy-rules"
import { activeBuddy, buddyStale, claimTier, loadBuddy, pickBuddy, STALE_MS, useBuddy } from "@/data/buddy"
import { openSettings } from "@/data/actions"
import { useProfile } from "@/data/store"
import { useScreen } from "@/data/signin"
import { BuddySprite } from "./buddy-sprite"

export const MOOD_WORD = { happy: "Happy", tired: "Tired", sick: "Sick", hurt: "Bandaged" } as const
const SMALL = "text-[12.5px] text-muted-foreground"
const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"

/** What a ledger row was for, in words. */
export function earnedFor(source: string): string {
    if (source.startsWith("session:")) return "Study session"
    if (source.startsWith("item:")) return "Finished item"
    if (source.startsWith("streak:")) return "Streak day"
    if (source.startsWith("claim:")) return "Rank claimed"
    if (source.startsWith("admin:")) return "Admin grant"
    return "Coins"
}
/* what each tier adds, for the rank list */
const adds = (b: BuddyId, i: number) => [
    "An egg in your theme's pattern", "Hatches", "A face of its own",
    BUDDIES[b].gear.hat, BUDDIES[b].gear.item, BUDDIES[b].gear.outfit, "Cape, crown, gold glow and sparkles",
][i]

function Bar({ value, max, label, tone }: { value: number; max: number; label: string; tone: "study" | "good" | "warn" | "crit" }) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 100
    const color = { study: "var(--study)", good: "var(--good)", warn: "var(--warn)", crit: "var(--crit)" }[tone]
    return (
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: pct + "%", background: color }} />
        </div>
    )
}

export function BuddyPage() {
    const state = useBuddy()
    const screen = useScreen()
    const bg = useProfile()?.bg ?? "med"
    const b = activeBuddy(state)
    const [error, setError] = useState("")
    const [busy, setBusy] = useState("")
    useEffect(() => {
        if (screen !== "app") return
        const reload = () => { if (!document.hidden && buddyStale()) void loadBuddy() }
        reload()
        const timer = setInterval(reload, STALE_MS / 2)
        document.addEventListener("visibilitychange", reload)
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", reload) }
    }, [screen])

    if (!state.buddy) return <Panel title="Buddy" label="Buddy"><div className="p-4"><Note>{state.offline ? "Your buddy needs a connection." : state.error || "Loading…"}</Note></div></Panel>
    if (!b) return (
        <Panel title="Buddy" label="Buddy">
            <div className="flex flex-col items-start gap-3 p-5">
                <p className={SMALL}>Gameplay is off. Turn it on to raise a study buddy that grows as you study.</p>
                <Button onClick={() => openSettings("gameplayGrp")}>Open Settings</Button>
            </div>
        </Panel>
    )

    const who = buddyFor(b.look, bg)
    const tierIx = Math.max(0, TIERS.findIndex((t) => t.id === b.tier))
    const name = b.look.name || BUDDIES[who].name
    const title = rankName(who, tierIx)
    const from = TIERS[tierIx].minXp
    const act = async (key: string, run: () => Promise<string>) => { setBusy(key); setError(await run()); setBusy("") }
    const healthTone = b.mood === "happy" ? "good" : b.mood === "tired" ? "warn" : "crit"
    return (
        <div className="grid items-start gap-4 pb-1.5 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
                <Panel title={<>{name} <span className="font-normal text-muted-foreground">· {title}</span></>} label="Your buddy"
                    head={<HeadNote>{b.coins.toLocaleString()} coins</HeadNote>}>
                    <div className="flex flex-col items-center gap-4 p-5">
                        <div className="flex justify-center rounded-xl bg-[var(--study-soft)] p-3">
                            <BuddySprite buddy={who} tier={tierIx} mood={b.mood} scale={8} label={`${name}, ${title}, ${MOOD_WORD[b.mood].toLowerCase()}`} className="max-w-full" />
                        </div>
                        <div className="grid w-full max-w-md gap-3">
                            <div className="grid gap-1">
                                <span className="flex justify-between text-[12.5px] text-ink-2">
                                    <b className="text-foreground">XP</b>
                                    <span className="font-mono tabular-nums">{b.next ? `${b.xp.toLocaleString()} / ${b.next.xp.toLocaleString()}` : `${b.xp.toLocaleString()} · top rank`}</span>
                                </span>
                                <Bar value={b.next ? b.xp - from : 1} max={b.next ? b.next.xp - from : 1} label="XP to the next rank" tone="study" />
                            </div>
                            <div className="grid gap-1">
                                <span className="flex justify-between text-[12.5px] text-ink-2">
                                    <b className="text-foreground">Health</b>
                                    <span><span className="font-mono tabular-nums">{b.health}</span> · {MOOD_WORD[moodOf(b.health)]}</span>
                                </span>
                                <Bar value={b.health} max={100} label="Health" tone={healthTone} />
                            </div>
                            <p className={cn(SMALL, "m-0")}>
                                {b.streak ? <>Streak: <b className="text-foreground">{b.streak} day{b.streak === 1 ? "" : "s"}</b>. </> : null}
                                Timed study and finished items grow your buddy. Missed labs and open assignments make it unwell, but it never dies and keeps what it has earned.
                            </p>
                        </div>
                    </div>
                </Panel>
                <Panel title="Ranks" label="Ranks">
                    <div className="px-4 py-1.5">
                        {b.tiers.map((t, i) => (
                            <div key={t.id} className={ROW}>
                                <span className="flex min-w-[160px] flex-1 flex-col">
                                    <b className={cn("text-[13.5px]", t.reached ? "text-foreground" : "text-muted-foreground")}>{rankName(who, i)}</b>
                                    <span className={SMALL}>{t.minXp.toLocaleString()} XP · {adds(who, i)}</span>
                                </span>
                                {t.claimed ? <span className={SMALL}>Claimed {t.reward} coins</span>
                                    : t.reached ? <Button variant="study" disabled={!!busy} onClick={() => void act(t.id, () => claimTier(t.id))}>{busy === t.id ? "Claiming…" : `Claim ${t.reward} coins`}</Button>
                                    : <span className={SMALL}>Locked</span>}
                            </div>
                        ))}
                    </div>
                </Panel>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
                {error && <Note tone="bad">{error}</Note>}
                <Panel title="Pick a buddy" label="Pick a buddy">
                    <div role="radiogroup" aria-label="Buddy" className="grid grid-cols-3 gap-2 p-3">
                        {(["auto", ...BUDDY_ORDER] as const).map((id) => {
                            const shown = id === "auto" ? buddyFor(null, bg) : id
                            const on = (b.look.buddy || "auto") === id
                            return (
                                <button key={id} type="button" role="radio" aria-checked={on} disabled={!!busy}
                                    onClick={() => { if (!on) void act("look", () => pickBuddy(id)) }}
                                    className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-lg border bg-muted px-1 py-2 font-[inherit] text-[11.5px] text-ink-2",
                                        on ? "border-[var(--study)] font-semibold text-foreground" : "border-border hover:text-foreground")}>
                                    <BuddySprite buddy={shown} tier={tierIx} mood="happy" scale={2} animate={false} label="" />
                                    <span>{id === "auto" ? "Your theme" : BUDDIES[id].name}</span>
                                </button>
                            )
                        })}
                    </div>
                </Panel>
                <Panel title="Recent coins" label="Recent coins">
                    <div className="px-4 py-1.5">
                        {b.recent.length === 0 && <p className={cn(SMALL, "py-3")}>Nothing yet. Start a timed session to earn your first coins.</p>}
                        {b.recent.map((r) => (
                            <div key={r.source} className={ROW}>
                                <span className="flex-1 text-[12.5px] text-ink-2">{earnedFor(r.source)}</span>
                                <b className="font-mono text-[12.5px] tabular-nums text-foreground">{r.amount > 0 ? "+" : ""}{r.amount}</b>
                            </div>
                        ))}
                    </div>
                </Panel>
            </div>
        </div>
    )
}
