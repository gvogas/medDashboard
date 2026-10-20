// Settings → Study → Grading: your grading scale (letters, the percentage each starts at and
// its grade points, for the letter in a course's grade panel and the GPA) and your pass marks
// (the targets the panel shows in place of 50, 60 and 70). Saved on your profile, so every
// device has them (core/grades.ts normalizeGrading fills the defaults).

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import * as store from "@/core/store"
import { DEFAULT_SCALE, MAX_PASS, MAX_STEPS, normalizeGrading, type ScaleStep } from "@/core/grades"
import type { Profile } from "@/data/types"
import { Button, CONTROL, RemoveButton } from "./fields"

const same = (a: ScaleStep[], b: ScaleStep[]) => JSON.stringify(a) === JSON.stringify(b)

/** Pass marks typed as "50, 65": whole numbers 1–100, in order, without repeats; null when one can't be read. */
export function readMarks(text: string): number[] | null {
    const parts = text.split(/[,\s]+/).filter(Boolean)
    const marks = parts.map(Number)
    if (marks.some((n) => !Number.isInteger(n) || n < 1 || n > 100)) return null
    return [...new Set(marks)].sort((a, b) => a - b).slice(0, MAX_PASS)
}

/** A scale as typed, or null with the reason it can't be saved. */
export function checkScale(steps: { letter: string; min: string; points: string }[]): { scale: ScaleStep[] } | { error: string } {
    const scale: ScaleStep[] = []
    for (const s of steps) {
        const letter = s.letter.trim(), min = Number(s.min), points = Number(s.points)
        if (!letter) return { error: "Every step needs a letter." }
        if (s.min.trim() === "" || !(min >= 0 && min <= 100)) return { error: "Each “from” is a percentage, 0 to 100." }
        if (s.points.trim() === "" || !(points >= 0 && points <= 10)) return { error: "Grade points go from 0 to 10." }
        scale.push({ letter: letter.slice(0, 4), min, points })
    }
    if (!scale.length) return { error: "A scale needs at least one step." }
    if (new Set(scale.map((s) => s.min)).size !== scale.length) return { error: "Two steps start at the same percentage." }
    return { scale: scale.sort((a, b) => b.min - a.min) }
}

const asText = (scale: ScaleStep[]) => scale.map((s) => ({ letter: s.letter, min: String(s.min), points: String(s.points) }))

export function GradingGroup({ profile }: { profile: Profile }) {
    const stored = (profile.grading && typeof profile.grading === "object" ? profile.grading : {}) as Record<string, unknown>
    const g = normalizeGrading(stored)
    const [steps, setSteps] = useState(() => asText(g.scale))
    const [marks, setMarks] = useState(g.pass.join(", "))
    const f = useId()
    const checked = checkScale(steps)
    const dirty = "scale" in checked ? !same(checked.scale, g.scale) : true
    const save = (patch: Record<string, unknown>) => store.saveProfile({ grading: { ...stored, ...patch } })
    const saveScale = () => { if ("scale" in checked) void save({ scale: same(checked.scale, DEFAULT_SCALE) ? undefined : checked.scale }) }
    const edit = (i: number, change: Partial<(typeof steps)[number]>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...change } : s)))
    const custom = !same(g.scale, DEFAULT_SCALE)

    return (
        <section className="flex flex-col gap-2 border-b border-line-2 pb-3.5 last:border-b-0 last:pb-0">
            <h4 className="m-0 flex items-center gap-2 text-[12.5px] font-[650] text-ink-2">
                Grading
                <em className="ml-auto text-[11px] font-medium text-muted-foreground not-italic">{custom ? "your scale" : "4.0 scale"}</em>
            </h4>
            <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
                <span>Pass marks</span>
                <input id={f + "pass"} type="text" inputMode="numeric" value={marks} placeholder="50, 60, 70" className={cn(CONTROL, "w-36 border-border")}
                    onChange={(e) => setMarks(e.target.value)}
                    onBlur={() => {
                        const read = readMarks(marks)
                        if (read === null) { setMarks(g.pass.join(", ")); return }
                        setMarks((read.length ? read : [50, 60, 70]).join(", "))
                        void save({ pass: read.length ? read : undefined })
                    }} />
                <span className="text-[11.5px] text-muted-foreground">%, up to {MAX_PASS}</span>
            </label>
            <span className="text-[11.5px] text-muted-foreground">A course's grade panel shows what the rest of it needs to reach each one, and your own target.</span>
            <details className="text-[12.5px]">
                <summary className="cursor-pointer font-semibold text-ink-2">Letters and grade points</summary>
                <div className="mt-2 flex flex-col gap-1">
                    <div className="grid grid-cols-[3.5rem_4.5rem_4.5rem_auto] gap-1.5 text-[11px] text-muted-foreground" aria-hidden="true">
                        <span>Letter</span><span>From %</span><span>Points</span><span />
                    </div>
                    {steps.map((s, i) => (
                        <div key={i} className="grid grid-cols-[3.5rem_4.5rem_4.5rem_auto] items-center gap-1.5">
                            <input aria-label={"Letter " + (i + 1)} value={s.letter} maxLength={4} className={cn(CONTROL, "border-border")} onChange={(e) => edit(i, { letter: e.target.value })} />
                            <input aria-label={"From percentage for " + (s.letter || "step " + (i + 1))} type="number" inputMode="decimal" min={0} max={100} step="any" value={s.min} className={cn(CONTROL, "border-border")} onChange={(e) => edit(i, { min: e.target.value })} />
                            <input aria-label={"Grade points for " + (s.letter || "step " + (i + 1))} type="number" inputMode="decimal" min={0} max={10} step="any" value={s.points} className={cn(CONTROL, "border-border")} onChange={(e) => edit(i, { points: e.target.value })} />
                            <RemoveButton aria-label={"Remove " + (s.letter || "step " + (i + 1))} disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))} />
                        </div>
                    ))}
                    <span className="mt-1 flex flex-wrap gap-1.5">
                        {steps.length < MAX_STEPS && <Button variant="ghost" onClick={() => setSteps([...steps, { letter: "", min: "", points: "" }])}>+ Add a step</Button>}
                        <Button variant="ghost" disabled={same(g.scale, DEFAULT_SCALE) && !dirty} onClick={() => { setSteps(asText(DEFAULT_SCALE)); void save({ scale: undefined }) }}>Use the 4.0 scale</Button>
                        <Button disabled={!dirty || "error" in checked} onClick={saveScale}>Save scale</Button>
                    </span>
                    {"error" in checked && <span role="alert" className="text-[11.5px] text-destructive">{checked.error}</span>}
                </div>
            </details>
        </section>
    )
}
