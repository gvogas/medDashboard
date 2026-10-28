// Settings, Study: the goal and streak, reviews, the school calendar.

import { useEffect, useId, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { normalizePrefs } from "@/core/model"
import { shortDate, today } from "@/core/dates"
import { schoolStatus } from "@/core/school"
import type { SchoolCalendar } from "@/core/school"
import { schoolCal } from "@/data/query"
import { readSetting, writeSetting } from "@/core/reviews"
import { runReviews } from "@/data/sync-status"
import { savePrefs } from "@/data/study-controller"
import { notify } from "@/bridge"
import { useProfile } from "@/data/store"
import { ui, useUi } from "@/data/ui"
import { GOAL_MAX, GOALS, hm, REST_DAYS, toggleRest } from "@/data/settings"
import { openSchool, removeSchool } from "@/data/school-edit"
import { openAiImport } from "@/data/actions"
import type { Profile } from "@/data/types"
import { GradingGroup } from "./grading-settings"
import { Button, CONTROL } from "./fields"
import { Group, Hint, Row, Chip } from "./settings-parts"

/* ── Study ── */

export function StudyTab({ profile }: { profile: Profile }) {
    return (
        <>
            <Goal profile={profile} />
            <Streak profile={profile} />
            <Reviews profile={profile} />
            <School />
            <GradingGroup profile={profile} />
        </>
    )
}

function Goal({ profile }: { profile: Profile }) {
    const p = normalizePrefs(profile.studyPrefs)
    const step = (by: number) => void savePrefs({ goal: Math.max(0, Math.min(GOAL_MAX, p.goal + by)) })
    return (
        <Group title="Daily goal" state={p.goal ? hm(p.goal) + " a day" : "off"} id="goalGrp">
            <div className="flex items-center gap-2.5">
                <Button variant="ghost" className="size-10 p-0 text-[18px] font-bold" aria-label="15 minutes less" disabled={!p.goal} onClick={() => step(-15)}>−</Button>
                <b aria-live="polite" className="flex-1 text-center font-mono text-[22px] font-bold text-foreground">{p.goal ? hm(p.goal) : "No goal"}</b>
                <Button variant="ghost" className="size-10 p-0 text-[18px] font-bold" aria-label="15 minutes more" onClick={() => step(15)}>+</Button>
            </div>
            <span role="group" aria-label="Pick a goal" className="flex flex-wrap gap-1.5">
                {GOALS.map((g) => <Chip key={g} tone="study" on={p.goal === g} className="rounded-full" onClick={() => void savePrefs({ goal: g })}>{g ? hm(g) : "Off"}</Chip>)}
            </span>
            <Hint>The Study tab and the corner clock show how far along today is.</Hint>
        </Group>
    )
}

/** A day minimum the streak can use: a whole number of minutes from 1 to 240. */
const dayMinOk = (s: string) => { const v = Math.round(+s); return v >= 1 && v <= 240 }

function Streak({ profile }: { profile: Profile }) {
    const p = normalizePrefs(profile.studyPrefs)
    const [min, setMin] = useState(String(p.dayMin))
    useEffect(() => setMin(String(p.dayMin)), [p.dayMin])
    const ok = dayMinOk(min)
    const f = useId()
    return (
        <Group title="Streak">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <span>A day counts from</span>
                <input id={f} type="number" inputMode="numeric" min={1} max={240} value={min} aria-invalid={!ok} className={cn(CONTROL, "w-20 border-border")}
                    onChange={(e) => setMin(e.target.value)}
                    onBlur={() => { if (ok) void savePrefs({ dayMin: Math.round(+min) }); else setMin(String(p.dayMin)) }} />
                <span>min</span>
            </label>
            {!ok && <Hint error>Enter a number from 1 to 240.</Hint>}
            <Hint>Rest days never break it: study on one and it counts, skip it and nothing resets.</Hint>
            <span role="group" aria-label="Rest days" className="flex flex-wrap gap-1.5">
                {REST_DAYS.map(([d, label]) => <Chip key={d} on={p.rest.includes(d)} onClick={() => void savePrefs({ rest: toggleRest(p.rest, d) })}>{label}</Chip>)}
            </span>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={p.celebrate} className="accent-[var(--accent)]" onChange={(e) => void savePrefs({ celebrate: e.target.checked })} />
                <span>Fireworks at the daily goal and at 7, 30, 100 and 365 days</span>
            </label>
        </Group>
    )
}

function Reviews({ profile }: { profile: Profile }) {
    /* on for the account (studyPrefs.reviews), or, before that first syncs, in this browser */
    const since = normalizePrefs(profile.studyPrefs).reviews
    const on = since === undefined ? readSetting(profile.id).on : !!since
    return (
        <Group title="Reviews" state={on ? "on" : "off"}>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={on} className="accent-[var(--accent)]" onChange={async (e) => {
                    const next = e.target.checked
                    if (!next) writeSetting(profile.id, { on: false, through: null })
                    await savePrefs({ reviews: next ? today() : null })
                    await runReviews()
                }} />
                <span>Create review tasks after lectures</span>
            </label>
            <Hint>Days 1, 3, 7 and 21 after each lecture, from today, on all your devices.</Hint>
        </Group>
    )
}

function School() {
    const asking = useUi((u) => u.schoolAsk)
    const note = useUi((u) => u.schoolNote)
    useProfile()   /* the calendar lives on the profile */
    const cal = schoolCal() as SchoolCalendar | null
    const keep = useRef<HTMLButtonElement>(null)
    useEffect(() => { if (asking) keep.current?.focus() }, [asking])
    const ask = (on: boolean) => { ui.schoolAsk = on; notify() }
    return (
        <Group title="School calendar" state={cal ? "on" : "off"} id="schoolGrp">
            {!cal ? <>
                <Hint>Add your school’s academic calendar with Import with AI. Term marks days off, breaks and exams, skips classes when there are none, and numbers your weeks.</Hint>
                <Row><Button variant="ghost" onClick={openAiImport}>Import with AI…</Button></Row>
            </> : asking ? <>
                <Hint>Remove the school calendar? Classes show every week again, and the term start goes back to the one you had.</Hint>
                <Row>
                    <Button ref={keep} variant="ghost" onClick={() => ask(false)}>Keep</Button>
                    <Button variant="danger" onClick={async () => { ui.schoolAsk = false; await removeSchool() }}>Remove</Button>
                </Row>
            </> : <>
                <span className="flex flex-col gap-px text-[12.5px] text-ink-2">
                    <b className="text-[13.5px] text-foreground">{cal.name || "Your school"}</b>
                    <span>
                        {schoolStatus(cal, today(), shortDate)} · {cal.terms.length} semester{cal.terms.length === 1 ? "" : "s"}, {cal.days.length} special day{cal.days.length === 1 ? "" : "s"}
                    </span>
                </span>
                <Row>
                    <Button variant="ghost" onClick={() => openSchool(null)}>Review dates</Button>
                    <Button variant="ghost" onClick={openAiImport}>Replace…</Button>
                    <Button variant="ghost" onClick={() => ask(true)}>Remove</Button>
                </Row>
            </>}
            {note && <Hint error={note.error}>{note.text}</Hint>}
        </Group>
    )
}
