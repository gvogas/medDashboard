// How a course is graded: its credits for the GPA and its grade categories ("Quizzes 20%,
// drop the lowest 2"), in the course sheet. And, in an item's card, what the item counts for:
// its own weight, or a category of its course, whose weight its items share (core/grades.ts).

import { useId } from "react"
import { cn } from "@/lib/utils"
import { uid } from "@/core/model"
import { DEFAULT_CREDITS, MAX_CATEGORIES, MAX_DROP, shareOf, type GradeCategory } from "@/core/grades"
import type { Course, Item } from "@/data/types"
import { Button, KeptNumberInput, Note, NumberInput, Prop, QUIET, RemoveButton, Section, Select, Warning, CONTROL } from "./fields"
import { ICONS } from "./prop-icons"

const clampNum = (v: string, lo: number, hi: number): number | null => {
    const n = Number(v)
    return v.trim() === "" || !Number.isFinite(n) ? null : Math.max(lo, Math.min(hi, n))
}

/** Credits and grade categories, edited in the course sheet's draft. */
export function GradeSetup({ course, onChange, shared = false }: { course: Course; onChange: (change: Partial<Course>) => void; shared?: boolean }) {
    const f = useId()
    const cats = course.gradeCategories ?? []
    const editCat = (id: string, change: Partial<GradeCategory>) => onChange({ gradeCategories: cats.map((c) => (c.id === id ? { ...c, ...change } : c)) })
    const sum = Math.round(cats.reduce((n, c) => n + c.weight, 0) * 10) / 10
    return (
        <Section title="How it's graded" note="credits · categories">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <label htmlFor={f + "credits"}>Credits</label>
                <NumberInput id={f + "credits"} inputMode="decimal" min={0} max={30} step="any" placeholder={String(DEFAULT_CREDITS)} className="w-20"
                    value={course.credits ?? ""} onChange={(e) => onChange({ credits: clampNum(e.target.value, 0, 30) })} />
                <span>for the GPA{course.credits == null ? " (" + DEFAULT_CREDITS + " if left empty)" : ""}</span>
            </div>
            {cats.length === 0 && <Note>Give each item its own weight, or add categories such as “Quizzes 20%, drop the lowest 1”: their items share the weight.</Note>}
            {cats.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-border bg-muted p-2">
                    <input aria-label="Category name" value={c.name} maxLength={40} placeholder="Quizzes"
                        onChange={(e) => editCat(c.id, { name: e.target.value })}
                        className={cn(CONTROL, "min-w-0 flex-[1_1_120px] border-border bg-card")} />
                    <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                        <NumberInput aria-label={"Weight of " + (c.name || "the category")} inputMode="decimal" min={0} max={100} step="any" className="w-16 border-border bg-card"
                            value={c.weight || ""} onChange={(e) => editCat(c.id, { weight: clampNum(e.target.value, 0, 100) ?? 0 })} />%
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                        drop lowest
                        <NumberInput aria-label={"Lowest scores dropped from " + (c.name || "the category")} inputMode="numeric" min={0} max={MAX_DROP} step={1} className="w-14 border-border bg-card"
                            value={c.drop} onChange={(e) => editCat(c.id, { drop: Math.round(clampNum(e.target.value, 0, MAX_DROP) ?? 0) })} />
                    </span>
                    <RemoveButton aria-label={"Remove " + (c.name || "category")} onClick={() => onChange({ gradeCategories: cats.filter((x) => x.id !== c.id) })} />
                </div>
            ))}
            {cats.length < MAX_CATEGORIES
                ? <Button variant="ghost" className="self-start" onClick={() => onChange({ gradeCategories: [...cats, { id: uid(), name: "", weight: 0, drop: 0 }] })}>+ Add a category</Button>
                : <Note>Twelve categories is the most a course can hold.</Note>}
            {cats.length > 0 && sum > 100 && <Warning>Categories add up to {sum}%, over 100.</Warning>}
            {cats.some((c) => !c.name.trim()) && <Note>A category with no name is saved as “Category”.</Note>}
            {shared && <Note>Everyone in the class grades by these; each item's category is set on the item.</Note>}
        </Section>
    )
}

/**
 * An item's Weight row: its own weight, or, when its course has categories, a category to count
 * in. `items` are the course's, for the share each item of a category gets.
 */
export function WeightProp({ item, course, items, onWeight, onCategory, kept = false }: {
    item: Item; course: Course | null; items: Item[]; onWeight: (value: string) => void; onCategory: (id: string | null) => void; kept?: boolean
}) {
    const f = useId()
    const cats = (course?.gradeCategories ?? []).filter((c) => c.weight > 0)
    const share = shareOf(item, items, cats)
    const Input = kept ? KeptNumberInput : NumberInput
    return (
        <Prop icon={ICONS.weight} label="Weight" htmlFor={f + (share.category ? "cat" : "weight")}>
            <span className="flex flex-wrap items-center gap-1">
                {cats.length > 0 && (
                    <Select id={f + "cat"} aria-label="Grade category" className={cn(QUIET, "w-auto")} value={share.category?.id ?? ""}
                        onChange={(e) => onCategory(e.target.value || null)}>
                        <option value="">Its own weight</option>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.weight}%</option>)}
                    </Select>
                )}
                {share.category
                    ? <span className="text-muted-foreground">{share.weight === null ? "" : "about " + share.weight + "% each"}{share.category.drop ? ", lowest " + share.category.drop + " dropped" : ""}</span>
                    : <>
                        <Input id={f + "weight"} className={cn(QUIET, "w-16")} min={0} max={100} step="any" placeholder="—" value={item.weight ?? ""} onChange={(e) => onWeight(e.target.value)} />
                        <span className="text-muted-foreground">% of the course grade</span>
                    </>}
            </span>
        </Prop>
    )
}
