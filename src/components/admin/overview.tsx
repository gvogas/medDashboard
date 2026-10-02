// The Admin page's Overview: today's use of the free plan's allowances, the Worker's
// requests and errors hour by hour, and the health panel. Traffic comes from
// Cloudflare's analytics (worker/analytics.js); without its token the meters say how
// to set it up and the health panel still shows.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { api } from "@/core/api"
import { Panel, HeadNote, Empty } from "@/components/views/bits"
import { Button, Note } from "@/components/sheet/fields"
import { ago, useLoad, when } from "./use-admin"

interface Hour { hour: string; requests: number; errors: number }
interface Traffic {
    configured: boolean
    free: { requests: number; neurons: number; rowsRead: number; rowsWritten: number; storageBytes: number }
    hours?: Hour[] | null
    today?: { requests: number | null; neurons: number | null; rowsRead: number | null; rowsWritten: number | null; storageBytes: number | null }
    failed?: Record<string, string>
}
interface Health {
    migrations: { latest: string; applied: string | null; ok: boolean }
    cronLastRun: number | null
    secrets: Record<string, boolean>
    ai: boolean
    accounts: number
    errors24h: number
}

export function Overview() {
    const traffic = useLoad<Traffic>(api.admin.traffic)
    const health = useLoad<Health>(api.admin.health)
    const refresh = () => { void traffic.reload(); void health.reload() }
    return (
        <div className="grid gap-4">
            <Usage traffic={traffic.data} error={traffic.error} loading={traffic.loading} onRefresh={refresh} />
            <TrafficChart traffic={traffic.data} />
            <HealthPanel health={health.data} error={health.error} />
        </div>
    )
}

/* ── the meters ── */

const n = (v: number) => v.toLocaleString()
const mb = (b: number) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + " GB" : (b / 1024 ** 2).toFixed(1) + " MB")

function Usage({ traffic, error, loading, onRefresh }: { traffic: Traffic | null; error: string | null; loading: boolean; onRefresh: () => void }) {
    const head = (
        <>
            <HeadNote>resets 00:00 UTC</HeadNote>
            <Button variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={onRefresh} disabled={loading}>{loading ? "Loading…" : "Refresh"}</Button>
        </>
    )
    let body
    if (error) body = <Empty title="Couldn't load usage">{error}</Empty>
    else if (!traffic) body = <Empty>Loading…</Empty>
    else if (!traffic.configured) {
        body = (
            <div className="grid gap-1.5 px-5 py-4 text-[13px] text-ink-2">
                <p className="m-0 font-semibold text-foreground">Traffic isn't set up yet.</p>
                <p className="m-0">Create a Cloudflare API token with only <b>Account Analytics: Read</b>, then run
                    {" "}<code className="font-mono text-[12px]">npx wrangler secret put CF_ANALYTICS_TOKEN</code> and set
                    {" "}<code className="font-mono text-[12px]">CF_ACCOUNT_ID</code> under vars in wrangler.jsonc.</p>
            </div>
        )
    } else {
        const t = traffic.today!, f = traffic.free
        body = (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-6 gap-y-4 px-5 py-4">
                <Gauge label="Worker requests" used={t.requests} limit={f.requests} fmt={n} />
                <Gauge label="Workers AI neurons" used={t.neurons} limit={f.neurons} fmt={n} />
                <Gauge label="D1 rows read" used={t.rowsRead} limit={f.rowsRead} fmt={n} />
                <Gauge label="D1 rows written" used={t.rowsWritten} limit={f.rowsWritten} fmt={n} />
                <Gauge label="D1 storage (all databases)" used={t.storageBytes} limit={f.storageBytes} fmt={mb} />
                {traffic.failed && Object.keys(traffic.failed).length > 0 && (
                    <p className="col-span-full m-0 text-[11.5px] text-muted-foreground">
                        Not available: {Object.entries(traffic.failed).map(([k, v]) => k + " (" + v + ")").join(", ")}
                    </p>
                )}
            </div>
        )
    }
    return <Panel title="Free plan, today" head={head}>{body}</Panel>
}

/** One allowance: the number, the share used, and a bar that turns amber at 70% and red at 90%. */
export function Gauge({ label, used, limit, fmt }: { label: string; used: number | null; limit: number; fmt: (v: number) => string }) {
    const part = used == null ? 0 : used / limit
    const tone = part >= 0.9 ? "crit" : part >= 0.7 ? "warn" : "ok"
    return (
        <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="text-ink-2">{label}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">{used == null ? "—" : Math.round(part * 100) + "%"}</span>
            </div>
            <span className="block h-[7px] overflow-hidden rounded-full bg-line-2" role="meter" aria-label={label}
                aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used ?? undefined}>
                <span className={cn("block h-full rounded-full", tone === "crit" ? "bg-[var(--crit)]" : tone === "warn" ? "bg-[var(--warn)]" : "bg-primary")}
                    style={{ width: Math.min(100, Math.round(part * 100)) + "%" }} />
            </span>
            <span className="text-[11.5px] text-muted-foreground">
                {used == null ? "not available" : fmt(used) + " of " + fmt(limit)}
                {tone === "crit" ? " · nearly used up" : tone === "warn" ? " · getting close" : ""}
            </span>
        </div>
    )
}

/* ── the chart: requests and errors, two charts on their own scales ── */

function TrafficChart({ traffic }: { traffic: Traffic | null }) {
    const [range, setRange] = useState<"24h" | "7d">("24h")
    const all = traffic?.hours
    if (!traffic?.configured || !all) return null
    const hours = range === "24h" ? lastHours(all, 24) : lastHours(all, 24 * 7)
    const total = hours.reduce((s, h) => s + h.requests, 0), errs = hours.reduce((s, h) => s + h.errors, 0)
    const head = (
        <div role="group" aria-label="Range" className="flex gap-1">
            {(["24h", "7d"] as const).map((r) => (
                <Button key={r} variant="ghost" aria-pressed={range === r} onClick={() => setRange(r)}
                    className={cn("h-7 px-2.5 text-[12px]", range === r && "border-[var(--accent)] text-foreground")}>{r === "24h" ? "24 hours" : "7 days"}</Button>
            ))}
        </div>
    )
    return (
        <Panel title="Traffic (this Worker)" head={head}>
            <div className="grid gap-4 px-5 py-4">
                <Bars label="Requests" hours={hours} pick={(h) => h.requests} color="var(--accent)" summary={n(total) + " requests"} />
                <Bars label="Errors" hours={hours} pick={(h) => h.errors} color="var(--crit)" summary={n(errs) + " errors" + (total ? " · " + ((errs / total) * 100).toFixed(2) + "%" : "")} />
            </div>
        </Panel>
    )
}

/** The last `count` hours up to now, with empty hours filled in as zero. */
export function lastHours(rows: Hour[], count: number, now = Date.now()): Hour[] {
    const byHour = new Map(rows.map((r) => [r.hour, r]))
    const top = now - (now % 3_600_000)
    const out: Hour[] = []
    for (let i = count - 1; i >= 0; i--) {
        const hour = new Date(top - i * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z")
        out.push(byHour.get(hour) ?? { hour, requests: 0, errors: 0 })
    }
    return out
}

const hourLabel = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })

function Bars({ label, hours, pick, color, summary }: { label: string; hours: Hour[]; pick: (h: Hour) => number; color: string; summary: string }) {
    const [hover, setHover] = useState<number | null>(null)
    const W = 720, H = 96, gap = hours.length > 48 ? 0.5 : 2
    const max = Math.max(1, ...hours.map(pick))
    const bw = W / hours.length
    const shown = hover != null ? hours[hover] : null
    return (
        <figure className="m-0 grid gap-1.5">
            <figcaption className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-semibold text-foreground">{label}</span>
                <span className="text-muted-foreground" aria-live="polite">
                    {shown ? hourLabel(shown.hour) + ": " + n(pick(shown)) : summary}
                </span>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[96px] w-full" role="img"
                aria-label={label + " per hour, most " + n(max)} onMouseLeave={() => setHover(null)}>
                <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {hours.map((h, i) => {
                    const v = pick(h), bh = v ? Math.max(2, (v / max) * (H - 4)) : 0
                    return (
                        <g key={h.hour} onMouseEnter={() => setHover(i)}>
                            {/* the hit target is the whole column, wider than the bar */}
                            <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
                            {bh > 0 && <rect x={i * bw + gap / 2} y={H - bh} width={Math.max(0.5, bw - gap)} height={bh} rx={Math.min(2, bw / 3)}
                                fill={color} opacity={hover == null || hover === i ? 1 : 0.45} />}
                        </g>
                    )
                })}
            </svg>
            <div className="flex justify-between text-[10.5px] text-muted-foreground">
                <span>{hourLabel(hours[0].hour)}</span><span>now</span>
            </div>
        </figure>
    )
}

/* ── health ── */

function HealthPanel({ health, error }: { health: Health | null; error: string | null }) {
    if (error) return <Panel title="Health"><Empty title="Couldn't load health">{error}</Empty></Panel>
    if (!health) return <Panel title="Health"><Empty>Loading…</Empty></Panel>
    const cronOk = health.cronLastRun != null && Date.now() - health.cronLastRun < 26 * 3_600_000
    const rows: [string, boolean, string][] = [
        ["Database schema", health.migrations.ok, health.migrations.ok ? "Up to date (" + health.migrations.latest + ")" : "Behind: has " + (health.migrations.applied || "none") + ", needs " + health.migrations.latest + ". Run npm run db:remote."],
        ["Nightly cleanup", cronOk, health.cronLastRun ? "Last ran " + when(health.cronLastRun) + " (" + ago(health.cronLastRun) + ")" : "Hasn't run since the Admin page was added"],
        ["Errors, last 24 h", health.errors24h === 0, health.errors24h === 0 ? "None" : health.errors24h + " — see the Errors tab"],
        ["Workers AI", health.ai, health.ai ? "Bound" : "Not bound"],
        ...Object.entries(health.secrets).map(([name, ok]): [string, boolean, string] => [name === "SPOTIFY" ? "Spotify secrets" : name, ok, ok ? "Set" : "Not set"]),
    ]
    return (
        <Panel title="Health" head={<HeadNote>{health.accounts} accounts</HeadNote>}>
            <ul className="m-0 grid list-none gap-0 p-0">
                {rows.map(([name, ok, text]) => (
                    <li key={name} className="flex items-start gap-3 border-b border-border px-5 py-2.5 text-[13px] last:border-b-0">
                        <span aria-hidden className={cn("mt-[3px] size-2.5 flex-none rounded-full", ok ? "bg-[var(--good)]" : "bg-[var(--warn)]")} />
                        <span className="w-[150px] flex-none font-medium text-foreground">{name}</span>
                        <span className="min-w-0 text-ink-2"><span className="sr-only">{ok ? "OK: " : "Check: "}</span>{text}</span>
                    </li>
                ))}
            </ul>
            <div className="px-5 pb-3"><Note>Secrets show only whether they are set, never their values.</Note></div>
        </Panel>
    )
}
