// The first-run setup (data/setup.ts), in place of an empty Week: four steps, each with
// Skip, and Skip setup always there. The imports open the sheets Import with AI already has;
// when the admins have switched Import with AI off, a step offers New course instead.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { normalizePrefs } from "@/core/model"
import { today } from "@/core/dates"
import { readSetting, writeSetting } from "@/core/reviews"
import { finishSetup, SETUP_STEPS, type SetupStep } from "@/data/setup"
import { savePrefs } from "@/data/study-controller"
import { runReviews } from "@/data/sync-status"
import { setBg } from "@/data/theme"
import { BGS, THEMES } from "@/data/themes"
import { GOALS, hm } from "@/data/settings"
import { openAiImport, openCourse } from "@/data/actions"
import { inMaintenance } from "@/data/maintenance"
import { useProfile } from "@/data/store"
import { useUi } from "@/data/ui"
import { radioKeys, rovingTab } from "@/components/sheet/radio-keys"
import { Button } from "@/components/sheet/fields"
import { Panel } from "./bits"

const TITLES: Record<SetupStep, string> = {
    theme: "Pick a look",
    timetable: "Add your timetable",
    outline: "Add a course outline",
    habits: "Reviews and a daily goal",
}

export function Setup() {
    const [at, setAt] = useState(0)
    const step = SETUP_STEPS[at]
    const next = () => (at < SETUP_STEPS.length - 1 ? setAt(at + 1) : void finishSetup())

    return (
        <Panel label="Set up Term" title="Welcome to Term" head={
            <button type="button" onClick={() => void finishSetup()}
                className="hit cursor-pointer border-0 bg-transparent px-1 font-[inherit] text-[12.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Skip setup
            </button>
        }>
            <div className="grid gap-4 px-5 py-4">
                <ol aria-label="Steps" className="m-0 flex list-none gap-1.5 p-0">
                    {SETUP_STEPS.map((s, i) => (
                        <li key={s} aria-current={i === at ? "step" : undefined} title={TITLES[s]}
                            className={cn("h-1.5 flex-1 rounded-full", i <= at ? "bg-[var(--accent)]" : "bg-[var(--line)]")}>
                            <span className="sr-only">{"Step " + (i + 1) + ": " + TITLES[s]}</span>
                        </li>
                    ))}
                </ol>
                <div className="grid gap-2">
                    <h3 className="m-0 font-serif text-[22px] leading-tight font-medium text-foreground">{TITLES[step]}</h3>
                    {step === "theme" && <ThemeStep />}
                    {step === "timetable" && <ImportStep what="timetable" />}
                    {step === "outline" && <ImportStep what="outline" />}
                    {step === "habits" && <HabitsStep />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {at > 0 && <Button variant="ghost" onClick={() => setAt(at - 1)}>Back</Button>}
                    <span className="flex-1" />
                    <Button onClick={next}>{at === SETUP_STEPS.length - 1 ? "Done" : "Next"}</Button>
                </div>
            </div>
        </Panel>
    )
}

const P = "m-0 text-[13.5px] leading-snug text-ink-2"

function ThemeStep() {
    const bg = useUi((u) => u.bg)
    return <>
        <p className={P}>Each theme has its own colours, sidebar picture and wording. You can change it any time in Settings.</p>
        <div role="radiogroup" aria-label="Theme" onKeyDown={radioKeys} className="grid grid-cols-2 gap-1.5 max-[520px]:grid-cols-1">
            {BGS.map((id, i) => {
                const t = THEMES[id], on = bg === id
                return (
                    <button key={id} type="button" role="radio" aria-checked={on} tabIndex={rovingTab(i, BGS.indexOf(bg))} onClick={() => setBg(id)}
                        className={cn(
                            "grid min-h-11 cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left font-[inherit] text-[13.5px] text-foreground",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                            on ? "border-foreground bg-[var(--bg)] font-semibold" : "border-border bg-card",
                        )}>
                        <span aria-hidden="true" className="grid h-5 w-7 grid-cols-2 overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_var(--line)]">
                            <span style={{ background: t.accent }} /><span style={{ background: t.done }} />
                        </span>
                        {t.label}
                    </button>
                )
            })}
        </div>
    </>
}

function ImportStep({ what }: { what: "timetable" | "outline" }) {
    const off = inMaintenance("import")
    return <>
        <p className={P}>
            {what === "timetable"
                ? "A screenshot or PDF of your class schedule from the student portal. Term reads each course and its weekly classes, and you tick what to keep before anything is saved."
                : "A course's outline or syllabus, as a PDF or Word file. Term finds its classes, exams and assignments with their dates and weights, and shows them before saving."}
        </p>
        {off
            ? <>
                <p className={P}>Import with AI is switched off for now. You can add a course by hand instead.</p>
                <div><Button variant="ghost" onClick={() => openCourse(null)}>New course…</Button></div>
            </>
            : <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={openAiImport}>{what === "timetable" ? "Import a timetable…" : "Import an outline…"}</Button>
                <Button variant="ghost" onClick={() => openCourse(null)}>New course by hand…</Button>
            </div>}
    </>
}

function HabitsStep() {
    const profile = useProfile()
    /* on for the account (studyPrefs.reviews), as in Settings; before that first syncs, this browser's */
    const prefs = normalizePrefs(profile?.studyPrefs)
    const reviews = prefs.reviews === undefined ? !!profile && readSetting(profile.id).on : !!prefs.reviews
    const goal = prefs.goal
    if (!profile) return null
    return <>
        <label className="flex items-start gap-2 text-[13.5px] text-ink-2">
            <input type="checkbox" checked={reviews} className="mt-0.5 accent-[var(--accent)]" onChange={async (e) => {
                const on = e.target.checked
                if (!on) writeSetting(profile.id, { on: false, through: null })
                await savePrefs({ reviews: on ? today() : null })
                await runReviews()
            }} />
            <span>Review each lecture on days 1, 3, 7 and 21 after it. Term adds the review tasks for you.</span>
        </label>
        <p className={P}>A daily study goal, counted by the study timer:</p>
        <div role="group" aria-label="Daily goal" className="flex flex-wrap gap-1.5">
            {GOALS.map((m) => (
                <button key={m} type="button" aria-pressed={goal === m} onClick={() => void savePrefs({ goal: m })}
                    className={cn(
                        "min-h-9 cursor-pointer rounded-full border border-border bg-card px-3 font-[inherit] text-[12.5px] text-foreground hover:border-[var(--accent)]",
                        goal === m && "border-[var(--accent)] bg-accent font-semibold text-accent-foreground",
                    )}>
                    {m ? hm(m) : "No goal"}
                </button>
            ))}
        </div>
    </>
}
