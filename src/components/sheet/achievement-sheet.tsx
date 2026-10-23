// New achievement, or Edit achievement: a sticker cut to a circle from a picture you
// upload (dragged and zoomed into place), a name, and what earns it, hours on one course
// or a grade on one exam or quiz. The draft is the sheet's state; the picture being
// cropped lives only here and is never stored.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { isTest } from "@/core/model"
import { dragCrop, drawSticker, readPicture, stickerData } from "@/core/sticker"
import { useCourses, useItems, useStudySessions } from "@/data/store"
import { keyedCourses, keyedItems, keyedSessions } from "@/data/refs"
import { closeSheet, replaceSheet } from "@/data/overlay"
import { footHint, NAME_MAX, saveAchievementDraft, standing, switchRule, TOP, validAchievement, type AchievementDraft, type Rule } from "@/data/achievement-edit"
import { deleteAchievement } from "@/data/actions"
import { toast } from "@/data/toast"
import { Button, Fields, Label, Note, NumberInput, Section, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

const SHOWN = 208                /* the crop preview, in CSS pixels */
const STEP = 12                  /* an arrow key moves the picture this far */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }

interface Crop { x: number; y: number; zoom: number }

export function AchievementSheet({ draft: d }: { draft: AchievementDraft }) {
    /* the draft holds keys (refs.ts) */
    const courses = keyedCourses(useCourses())
    const items = keyedItems(useItems())
    const sessions = keyedSessions(useStudySessions())
    const f = useId()
    const edit = (change: Partial<AchievementDraft>) => replaceSheet({ kind: "achievement", draft: { ...d, ...change } })

    /* the picture and how it sits in the circle, while a crop is in progress */
    const pic = useRef<ImageBitmap | null>(null)
    const [crop, setCrop] = useState<Crop | null>(null)
    const canvas = useRef<HTMLCanvasElement>(null)
    const drag = useRef<{ x: number; y: number } | null>(null)
    const file = useRef<HTMLInputElement>(null)
    const pick = useRef<HTMLButtonElement>(null)
    const name = useRef<HTMLInputElement>(null)
    /* where the keyboard goes once the crop is over */
    const [after, setAfter] = useState<"name" | "pick" | null>(null)

    useLayoutEffect(() => { if (crop && pic.current && canvas.current) drawSticker(canvas.current, pic.current, crop) }, [crop])
    const cropping = crop !== null
    useEffect(() => { if (cropping) canvas.current?.focus() }, [cropping])
    useEffect(() => {
        if (!after) return
        ;(after === "name" ? name : pick).current?.focus()
        setAfter(null)
    }, [after])

    const readFile = async (chosen: File | undefined) => {
        if (!chosen) return
        const got = await readPicture(chosen)
        if (!got) { toast("That picture could not be read. Try a JPG or PNG.", { error: true }); return }
        drop()
        pic.current = got
        setCrop({ x: 0, y: 0, zoom: 1 })
    }
    /* a decoded photo can be tens of MB: let it go as soon as the crop is over */
    const drop = () => { pic.current?.close?.(); pic.current = null }
    useEffect(() => drop, [])
    const cancelCrop = () => { drop(); setCrop(null); setAfter("pick") }
    const useCrop = () => {
        if (!crop || !pic.current) return
        const url = stickerData(pic.current, crop)
        if (!url) { toast("That picture is too detailed to keep small. Try zooming in, or another picture.", { error: true }); return }
        drop()
        setCrop(null)
        edit({ sticker: url })
        setAfter("name")
    }
    /* from the latest crop, so pointer moves faster than redraws all count */
    const move = (dx: number, dy: number, shown: number) => { const p = pic.current; if (p) setCrop((c) => c && dragCrop(c, p, dx, dy, shown)) }

    const liveCourses = courses.filter((c) => !c.archived || c.id === d.courseId)
    const tests = items.filter((it) => isTest(it.type)).sort((a, b) => a.date.localeCompare(b.date))
    const courseGone = !!d.courseId && !courses.some((c) => c.id === d.courseId)
    const examGone = !!d.itemId && !items.some((it) => it.id === d.itemId)
    const ok = validAchievement(d, cropping)

    return (
        <>
            <SheetHead color="#E8B33A" kind={d.isNew ? "New achievement" : "Edit achievement"} onClose={closeSheet} />

            <SheetBody>
                <Section title="Sticker">
                    {crop ? (
                        <div className="flex flex-col items-center gap-2.5">
                            <canvas
                                ref={canvas}
                                width={SHOWN * 2}
                                height={SHOWN * 2}
                                tabIndex={0}
                                role="img"
                                aria-label="The picture in the circle. Drag it, or use the arrow keys, to move it."
                                style={{ width: SHOWN, height: SHOWN }}
                                className="cursor-grab touch-none rounded-full outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_40%,transparent)] active:cursor-grabbing"
                                onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId) }}
                                onPointerMove={(e) => {
                                    if (!drag.current) return
                                    move(e.clientX - drag.current.x, e.clientY - drag.current.y, e.currentTarget.getBoundingClientRect().width || SHOWN)
                                    drag.current = { x: e.clientX, y: e.clientY }
                                }}
                                onPointerUp={() => { drag.current = null }}
                                onPointerCancel={() => { drag.current = null }}
                                onKeyDown={(e) => {
                                    const step = ARROWS[e.key]
                                    if (!step) return
                                    e.preventDefault()
                                    move(step[0], step[1], SHOWN)
                                }}
                            />
                            <label className="flex w-full max-w-[260px] items-center gap-2.5 text-[12px] text-muted-foreground">
                                <span>Zoom</span>
                                <input type="range" min={1} max={3} step={0.01} value={crop.zoom} className="flex-1 accent-[var(--accent)]"
                                    onChange={(e) => setCrop({ ...crop, zoom: Math.max(1, Math.min(3, +e.target.value)) })} />
                            </label>
                            <span className="flex gap-2">
                                <Button variant="ghost" onClick={cancelCrop}>Cancel</Button>
                                <Button variant="study" onClick={useCrop}>Use this</Button>
                            </span>
                            <Note>Drag the picture to move it in the circle.</Note>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3.5">
                            {d.sticker
                                ? <img src={d.sticker} alt="Your sticker" width={88} height={88} className="size-[88px] flex-none rounded-full drop-shadow-[0_2px_4px_rgba(0,0,0,.18)]" />
                                : <span aria-hidden="true" className="grid size-[88px] flex-none place-items-center rounded-full border-2 border-dashed border-border text-[28px] font-bold text-muted-foreground">?</span>}
                            <span className="flex flex-col items-start gap-1.5">
                                <Button ref={pick} variant="ghost" autoFocus={!d.sticker} onClick={() => file.current?.click()}>
                                    {d.sticker ? "Change picture" : "Upload a picture"}
                                </Button>
                                <input ref={file} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" className="sr-only"
                                    onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = "" }} />
                                <Note>A photo or any picture. It is cut to a circle, kept small, and only you can see it.</Note>
                            </span>
                        </div>
                    )}
                </Section>

                <Fields>
                    <Label htmlFor={f + "name"}>Name</Label>
                    <TextInput ref={name} id={f + "name"} value={d.name} maxLength={NAME_MAX} placeholder="20 hours on Neuro" autoFocus={!!d.sticker}
                        onChange={(e) => edit({ name: e.target.value })} />
                    <Label>Earned when</Label>
                    <span role="group" aria-label="Earned when" className="grid grid-cols-2 gap-1.5">
                        {([["hours", "Study hours", "on one course"], ["grade", "A grade", "on one exam or quiz"]] as const).map(([rule, big, small]) => (
                            <button key={rule} type="button" aria-pressed={d.rule === rule}
                                onClick={() => edit(switchRule(d, rule as Rule, courses))}
                                className={cn(
                                    "flex cursor-pointer flex-col items-start gap-px rounded-[10px] border border-border bg-card px-2.5 py-1.5 text-left font-[inherit] text-[11px] text-muted-foreground",
                                    d.rule === rule && "border-[var(--accent)] bg-accent text-accent-foreground",
                                )}>
                                <b className="text-[12.5px] font-[650] text-foreground">{big}</b>{small}
                            </button>
                        ))}
                    </span>
                    {d.rule === "hours" ? <>
                        <Label htmlFor={f + "course"}>Course</Label>
                        <Select id={f + "course"} value={d.courseId ?? ""} onChange={(e) => edit({ courseId: e.target.value || null })}>
                            {courseGone && <option value={d.courseId!}>Course removed</option>}
                            {!d.courseId && <option value="">Pick one</option>}
                            {liveCourses.map((c) => <option key={c.id} value={c.id}>{c.code + " · " + c.name}</option>)}
                        </Select>
                    </> : <>
                        <Label htmlFor={f + "item"}>Exam or quiz</Label>
                        <Select id={f + "item"} value={d.itemId ?? ""} onChange={(e) => edit({ itemId: e.target.value || null })}>
                            <option value="">{tests.length ? "Pick one" : "No exams or quizzes yet"}</option>
                            {examGone && <option value={d.itemId!}>Exam removed</option>}
                            {tests.map((it) => {
                                const code = courses.find((c) => c.id === it.courseId)?.code
                                return <option key={it.id} value={it.id}>{(code ? code + " · " : "") + it.title}</option>
                            })}
                        </Select>
                    </>}
                    <Label htmlFor={f + "target"}>{d.rule === "hours" ? "Hours" : "Grade"}</Label>
                    <span className="flex items-center gap-2">
                        <NumberInput id={f + "target"} inputMode="numeric" min={1} max={TOP[d.rule]} className="w-24"
                            value={d.target || ""} onChange={(e) => edit({ target: e.target.value === "" ? 0 : Math.round(+e.target.value) })} />
                        <span className="text-muted-foreground">{d.rule === "hours" ? "hours studied" : "or more"}</span>
                    </span>
                </Fields>
                <p role="status" className="m-0 rounded-[9px] bg-accent px-3 py-2.5 text-[12.5px] text-accent-foreground">{standing(d, sessions, items, courses)}</p>
            </SheetBody>

            <SheetFoot hint={footHint(d, cropping)}>
                {!d.isNew && <Button variant="ghost" onClick={() => void deleteAchievement(d.id)}>Delete</Button>}
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button variant="study" disabled={!ok} onClick={() => void saveAchievementDraft(d)}>{d.isNew ? "Add" : "Save"}</Button>
            </SheetFoot>
        </>
    )
}
