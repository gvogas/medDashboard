// The Leaderboard card on the Study page: who has studied the most this week, or ever,
// among those who joined. Not joined, it says what joining shares. It loads when its tab
// opens and the totals are missing or a minute old, and again when the device comes back
// online after saying it needed a connection.

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { addDays, dayMonth, iso, monday } from "@/core/dates"
import { Panel } from "@/components/views/bits"
import { Button, Segmented } from "@/components/sheet/fields"
import { joinLeaderboard, lbHours, lbStale, loadLeaderboard, setLbTab, useLeaderboard, type LbRank } from "@/data/leaderboard"
import { ui } from "@/data/ui"
import { useScreen } from "@/data/signin"
import type { LbTab } from "@/data/types"

const TABS = [["week", "This week"], ["all", "All-time"]] as const

const NOTE = "m-0 text-[13px] text-ink-2"

export function LeaderboardCard({ className }: { className?: string }) {
    const { lb, tab, rows } = useLeaderboard()
    const joinButton = useRef<HTMLButtonElement>(null), leaveButton = useRef<HTMLButtonElement>(null)
    /* after Join or Leave, focus goes to the other one (the same one when it failed) */
    const refocus = useRef<{ to: "join" | "leave"; from: "join" | "leave" } | null>(null)

    /* The page is drawn, hidden, before boot knows the account; asking then would be
       cancelled when the account is bound (core/api.ts), so wait for the app to show. */
    const screen = useScreen()
    useEffect(() => {
        if (screen === "app" && (lbStale() || (ui.lb?.offline && navigator.onLine))) void loadLeaderboard()
    }, [screen])

    useEffect(() => {
        const online = () => { if (ui.lb?.offline) void loadLeaderboard() }
        window.addEventListener("online", online)
        return () => window.removeEventListener("online", online)
    }, [])

    useEffect(() => {
        const want = refocus.current
        if (!want || lb?.busy) return
        refocus.current = null
        const pick = (which: "join" | "leave") => (which === "join" ? joinButton : leaveButton).current
        ;(pick(want.to) ?? pick(want.from))?.focus()
    })

    const act = (join: boolean) => {
        refocus.current = join ? { to: "leave", from: "join" } : { to: "join", from: "leave" }
        void joinLeaderboard(join)
    }

    const joined = !!lb && !lb.offline && lb.joined === true
    const error = lb?.error ? <p role="alert" className="m-0 text-[13px] text-destructive">{lb.error}</p> : null

    let body
    if (!lb || (lb.loading && lb.joined === undefined)) body = <p className={NOTE}>Loading…</p>
    else if (lb.offline) body = <p className={NOTE}>The leaderboard needs a connection. Your own hours are still saved.</p>
    else if (lb.error && lb.joined === undefined) body = <p className={NOTE}>{lb.error}</p>
    else if (!lb.joined) {
        body = (
            <div className="flex flex-col items-start gap-3">
                <p className="m-0 max-w-[60ch] text-[13px] leading-normal text-ink-2">
                    See who has studied the most this week. When you join, others who have joined will see your name and study hours. You can leave at any time.
                </p>
                <Button ref={joinButton} disabled={!!lb.busy} onClick={() => act(true)}>Join the leaderboard</Button>
                {error}
            </div>
        )
    } else {
        const mon = monday(new Date()) as Date, count = lb.all?.length ?? 0
        body = (
            <>
                <div className="flex flex-wrap justify-between gap-2.5 text-[12px] text-muted-foreground tabular-nums">
                    {tab === "week"
                        ? <><span>{dayMonth(iso(mon)) + " – " + dayMonth(iso(addDays(mon, 6)))}</span><span>Resets Monday</span></>
                        : <><span>Since each person started</span><span>{count + (count === 1 ? " person" : " people")}</span></>}
                </div>
                <ol className="m-0 flex list-none flex-col gap-1 p-0">
                    {rows.map((r) => <Row key={r.name + (r.me ? ":me" : "")} r={r} />)}
                </ol>
                {error}
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line-2 pt-3 text-[12px] text-muted-foreground">
                    <span>Counts logged study time</span>
                    <button ref={leaveButton} type="button" disabled={!!lb.busy} onClick={() => act(false)}
                        className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:cursor-default disabled:opacity-60">
                        Leave the leaderboard
                    </button>
                </div>
            </>
        )
    }

    return (
        <div className={cn("min-w-0", className)}>
            <Panel
                label="Leaderboard"
                title="Leaderboard"
                head={joined && <span className="ml-auto"><Segmented label="Time range" value={tab} options={TABS} onChange={(v: LbTab) => setLbTab(v)} /></span>}
            >
                <div className="flex flex-col gap-3 p-3.5">{body}</div>
            </Panel>
        </div>
    )
}

/* The top three's rank badges: gold, silver, bronze, in light and dark. */
const MEDAL: Record<number, string> = {
    1: "bg-[#FBF1D6] text-[#7C5C07] shadow-[inset_0_0_0_2px_#C99A1E] dark:bg-[#342A10] dark:text-[#F0D38A] dark:shadow-[inset_0_0_0_2px_#E2B84A]",
    2: "bg-[#EEF2F3] text-[#4E5C61] shadow-[inset_0_0_0_2px_#8A9AA0] dark:bg-[#1F2A2D] dark:text-[#CAD5D8] dark:shadow-[inset_0_0_0_2px_#A9B8BD]",
    3: "bg-[#F8E8DC] text-[#7D4521] shadow-[inset_0_0_0_2px_#B8703F] dark:bg-[#34211A] dark:text-[#EDB894] dark:shadow-[inset_0_0_0_2px_#D99466]",
}

function Row({ r }: { r: LbRank }) {
    return (
        <li className={cn(
            "grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2.5 py-2",
            r.me && "bg-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]",
        )}>
            <span className={cn(
                "grid size-7 place-items-center rounded-full text-[12.5px] font-extrabold tabular-nums",
                r.medal ? MEDAL[r.medal] : "bg-muted text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--line)]",
            )}>{r.rank}</span>
            <span className="flex min-w-0 flex-col gap-[5px]">
                <span className={cn("truncate text-[13.5px] font-semibold", r.minutes ? "text-foreground" : "text-muted-foreground")}>
                    {r.name}
                    {r.me && <span className="ml-1.5 text-[10.5px] font-bold tracking-[.06em] text-accent-foreground uppercase">you</span>}
                </span>
                <span aria-hidden="true" className={cn("h-[5px] overflow-hidden rounded-full", r.me ? "bg-[color-mix(in_srgb,var(--panel)_60%,transparent)]" : "bg-line-2")}>
                    <i style={{ width: r.width + "%" }} className="block h-full rounded-full bg-[var(--study)]" />
                </span>
            </span>
            <span className={cn("min-w-[6ch] text-right font-mono text-[14px] font-semibold whitespace-nowrap tabular-nums", r.minutes ? "text-foreground" : "text-muted-foreground")}>
                {lbHours(r.minutes)}<small className="ml-[3px] text-[11.5px] font-medium text-muted-foreground">h</small>
            </span>
        </li>
    )
}
