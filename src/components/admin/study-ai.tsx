// The Admin page's Study AI tab (spec §9, Admin › Study Buddy): Generate here's estimated
// Workers AI neurons today against the day's ceiling, generations by provider, the last 14
// days, and the caps (free uses a day per person, extras buyable with coins, the ceiling).
// A changed cap applies to the next call. Use your own AI never shows here: it costs nothing.

import { useEffect, useState } from "react"
import { api } from "@/core/api"
import type { StudyAiAdmin } from "@/core/types"
import { toast } from "@/data/toast"
import { Panel, Empty, HeadNote } from "@/components/views/bits"
import { Button, Note, NumberInput } from "@/components/sheet/fields"
import { problem, useLoad } from "./use-admin"

const gens = (n: number) => `${n} generation${n === 1 ? "" : "s"}`
const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2 last:border-b-0 text-[12.5px]"
const CAPS: [keyof StudyAiAdmin["caps"], string, string, number, number][] = [
    ["perUser", "Free generations a day", "per person", 0, 20],
    ["extraMax", "Extra uses buyable a day", "60 coins each", 0, 5],
    ["ceiling", "Daily neuron ceiling", "for all study AI", 0, 9000],
]

export function StudyAiTab() {
    const got = useLoad<StudyAiAdmin>(api.studyAi.admin)
    const [caps, setCaps] = useState<StudyAiAdmin["caps"] | null>(null)
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
    useEffect(() => { if (got.data) setCaps(got.data.caps) }, [got.data])
    if (got.error) return <Panel title="Study AI"><Empty title="Couldn't load it">{got.error}</Empty></Panel>
    if (!got.data || !caps) return <Panel title="Study AI"><Empty>Loading…</Empty></Panel>
    const { today, last14 } = got.data
    const pct = today.ceiling ? Math.min(100, Math.round((today.neurons / today.ceiling) * 100)) : 100
    const save = async () => {
        setBusy(true); setError(null)
        try { await api.studyAi.setCaps(caps); toast("Caps saved. They apply to the next generation."); await got.reload() }
        catch (e) { setError(problem(e)) }
        finally { setBusy(false) }
    }
    return (
        <div className="grid gap-4">
            <Panel title="Today" head={<HeadNote>{gens(today.generations)}</HeadNote>}>
                <div className="grid gap-2 px-5 py-4">
                    <span className="text-[13px] text-ink-2"><b className="font-mono text-foreground">{today.neurons.toLocaleString()}</b> of {today.ceiling.toLocaleString()} neurons (estimated, Workers AI's free 10,000 a day is shared with Import with AI)</span>
                    <div role="meter" aria-label="Neurons used today" aria-valuemin={0} aria-valuemax={today.ceiling} aria-valuenow={today.neurons} className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: pct + "%", background: pct >= 100 ? "var(--crit)" : pct >= 75 ? "var(--warn)" : "var(--study)" }} />
                    </div>
                    {Object.keys(today.byProvider).length > 0 && <span className="text-[12.5px] text-muted-foreground">By provider: {Object.entries(today.byProvider).map(([p, n]) => `${p} ${n}`).join(", ")}</span>}
                </div>
            </Panel>
            <Panel title="Last 14 days">
                <div className="px-5 py-2">
                    {last14.map((d) => (
                        <div key={d.day} className={ROW}>
                            <span className="w-24 font-mono text-ink-2">{d.day}</span>
                            <span className="flex-1">{gens(d.generations)}</span>
                            <span className="font-mono text-foreground">{d.neurons.toLocaleString()} neurons</span>
                        </div>
                    ))}
                </div>
            </Panel>
            <Panel title="Caps">
                <form className="grid gap-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
                    {CAPS.map(([k, label, hint, lo, hi]) => (
                        <label key={k} className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-2">
                            <span className="min-w-[200px] flex-1"><b className="text-foreground">{label}</b> · {hint}</span>
                            <NumberInput aria-label={label} min={lo} max={hi} value={caps[k]} className="w-28"
                                onChange={(e) => setCaps({ ...caps, [k]: Math.max(lo, Math.min(hi, Math.round(Number(e.target.value) || 0))) })} />
                        </label>
                    ))}
                    {error && <Note tone="bad">{error}</Note>}
                    <span><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save caps"}</Button></span>
                </form>
            </Panel>
        </div>
    )
}
