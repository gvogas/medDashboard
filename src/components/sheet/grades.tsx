// Weighted grade so far, how much of the course it covers, what the rest needs to reach 50,
// 60, 70 or your own target, and what-if scores for what is still to come (never saved). The
// course sheet shows it for a course of yours; the class sheet, as "Your grade so far", over
// the class's items with your marks on top (spec §8). With grade categories it shows each one,
// and the letter comes from your grading scale (Settings), the targets from your pass marks.

import { useId } from "react"
import { cn } from "@/lib/utils"
import { courseGrade, letterFor, neededLabel, normalizeGrading, shareOf, targetsFor, ungraded } from "@/core/grades"
import { useProfile } from "@/data/store"
import type { Course, Item } from "@/data/types"
import { KeptNumberInput, Meter, Note, NumberInput, Section, Warning } from "./fields"

export function Grades({ title = "Grades", course, items, whatIf, setWhatIf, onTarget }: {
    title?: string; course: Course; items: Item[]; whatIf: Record<string, number>; setWhatIf: (w: Record<string, number>) => void; onTarget: (t: number | null) => void
}) {
    const f = useId()
    const grading = normalizeGrading(useProfile()?.grading)
    const cats = course.gradeCategories ?? []
    const real = courseGrade(items, {}, cats)
    if (!real.total) return null
    const open = ungraded(items, cats).sort((a: Item, b: Item) => a.date.localeCompare(b.date)) as Item[]
    const guessed = open.some((it) => typeof whatIf[it.id] === "number")
    const g = guessed ? courseGrade(items, whatIf, cats) : real
    const targets: number[] = targetsFor(course.target, grading.pass)
    const letter = letterFor(real.current, grading.scale)

    return (
        <Section title={title} note={real.graded + " of " + real.total + "% graded"}>
            <div className="flex items-baseline gap-2">
                <b className="text-[22px] font-semibold tabular-nums text-foreground">{real.current === null ? "—" : real.current + "%"}</b>
                {letter && <b className="text-[15px] font-semibold text-[var(--accent)]" aria-label={"Letter grade " + letter.letter}>{letter.letter}</b>}
                <span className="text-[11.5px] text-muted-foreground">current weighted average{letter ? " · " + letter.points + " points" : ""}</span>
            </div>
            {g.categories.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
                    {g.categories.map((c) => (
                        <li key={c.id} className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate">{c.name} <span className="text-muted-foreground">· {c.weight}%</span></span>
                            {c.dropped.length > 0 && <span className="text-[11px] text-muted-foreground">{c.dropped.length} dropped</span>}
                            <b className="font-semibold tabular-nums">{c.current === null ? "—" : c.current + "%"}</b>
                        </li>
                    ))}
                </ul>
            )}
            {guessed && (
                <div className="flex items-baseline gap-2">
                    <b className="text-[17px] font-semibold tabular-nums text-[var(--accent)]">{g.current}%</b>
                    <span className="text-[11.5px] text-muted-foreground">{g.remaining <= 0 ? "your final grade with these scores" : "with your what-if scores"}</span>
                </div>
            )}
            <Meter part={real.graded / Math.max(100, real.total)} />
            {g.remaining > 0 ? <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(64px,1fr))] gap-1.5">
                    {targets.map((t) => {
                        const label = neededLabel(g.needed(t))
                        const mine = t === course.target
                        return (
                            <span key={t} className={cn(
                                "flex flex-col gap-px rounded-lg bg-muted px-2 py-1.5 text-[12px] tabular-nums",
                                label === "secured" && "text-[var(--good)]", label === "out of reach" && "text-destructive",
                                mine && "shadow-[inset_0_0_0_1.5px_var(--accent)]",
                            )}>
                                <em className={cn("text-[10px] tracking-[.1em] not-italic", mine ? "font-bold text-[var(--accent)]" : "text-muted-foreground")}>{mine ? "Target " + t : t}</em>
                                {label}
                            </span>
                        )
                    })}
                </div>
                <Note>What you need on the {guessed ? "other " : "remaining "}{g.remaining}% to finish at {targets.slice(0, -1).join(", ")} or {targets.at(-1)}.</Note>
            </> : course.target && g.current !== null && (
                <Note tone={g.current >= course.target ? "ok" : "bad"}>{g.current >= course.target ? "At or above" : "Below"} your target of {course.target}%.</Note>
            )}
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <label htmlFor={f + "target"}>Your target</label>
                <KeptNumberInput id={f + "target"} inputMode="numeric" min={1} max={100} step={1} placeholder="e.g. 75" className="w-20"
                    value={course.target}
                    onChange={(e) => { const n = Math.round(+e.target.value); onTarget(e.target.value.trim() !== "" && n >= 1 && n <= 100 ? n : null) }} />
                <span>% final grade</span>
            </div>
            {open.length > 0 && (
                <details open={guessed || undefined} className="text-[12.5px]">
                    <summary className="cursor-pointer font-semibold text-ink-2">What if…</summary>
                    <div className="mt-2 flex flex-col gap-1.5">
                        {open.map((it) => (
                            <label key={it.id} className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                                <em className="text-[11px] text-muted-foreground not-italic">{weightLabel(it, items, cats)}</em>
                                <NumberInput inputMode="decimal" min={0} max={100} step="any" placeholder="score" className="w-20"
                                    aria-label={"If I get this score on " + it.title}
                                    defaultValue={whatIf[it.id] ?? ""}
                                    onChange={(e) => {
                                        const v = e.target.value.trim() === "" ? NaN : +e.target.value
                                        const next = { ...whatIf }
                                        if (Number.isFinite(v) && v >= 0 && v <= 100) next[it.id] = v; else delete next[it.id]
                                        setWhatIf(next)
                                    }} />
                            </label>
                        ))}
                    </div>
                    <Note>Scores you might get. Not saved; they clear when you close this.</Note>
                </details>
            )}
            {real.total !== 100 && <Warning>Weights add up to {real.total}%, not 100.</Warning>}
        </Section>
    )
}

/** What a what-if row says an item is worth: its own weight, or its share of its category. */
function weightLabel(it: Item, items: Item[], cats: NonNullable<Course["gradeCategories"]>): string {
    const share = shareOf(it, items, cats)
    if (share.category) return share.category.name + (share.weight === null ? "" : " · " + share.weight + "%")
    return share.weight === null ? "" : share.weight + "%"
}
