// Settings, You: theme, where you're headed, name, look, quotes.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { COAT_PALETTE, colourName } from "@/core/model"
import { setBg, setTheme } from "@/data/theme"
import { useQuotes } from "@/data/store"
import { useUi } from "@/data/ui"
import { coatColour, themeLabel } from "@/data/settings"
import { addQuote, removeQuote, saveCoat } from "@/data/actions"
import { BGS, GOALS as THEME_GOALS, THEMES, goalFor, type Bg } from "@/data/themes"
import type { Profile } from "@/data/types"
import { radioKeys, rovingTab } from "./radio-keys"
import { Button, RemoveButton, Swatches, TextInput } from "./fields"
import { Group, Hint } from "./settings-parts"

/* ── You ── */

const LOOKS = [
    ["light", "Light", ["#EEF4F3", "#FFFFFF", "#0E7C74"]],
    ["dark", "Dark", ["#0A1214", "#111D1E", "#3FBFB2"]],
    ["system", "System", ["#EEF4F3", "#0A1214", "#3FBFB2"]],
] as const

export function YouTab({ profile }: { profile: Profile }) {
    const theme = useUi((u) => u.theme)
    const bg = useUi((u) => u.bg)
    const dark = document.documentElement.getAttribute("data-app") === "dark"
    return (
        <>
            <Group title="Theme" state={THEMES[bg].label} id="themeGrp">
                <Hint>Changes the sidebar, colours and the next-exam animation.</Hint>
                <div role="radiogroup" aria-label="Theme" onKeyDown={radioKeys} className="flex flex-col gap-1.5">
                    {BGS.map((id, i) => {
                        const t = THEMES[id], on = bg === id
                        return (
                            <button key={id} type="button" role="radio" aria-checked={on} tabIndex={rovingTab(i, BGS.indexOf(bg))} onClick={() => setBg(id)}
                                className={cn(
                                    "grid min-h-[60px] cursor-pointer grid-cols-[44px_minmax(0,1fr)_20px] items-center gap-3.5 rounded-lg border px-3.5 py-2 text-left font-[inherit] text-[14px] text-foreground",
                                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                                    on ? "border-foreground bg-[var(--bg)]" : "border-border bg-card",
                                )}>
                                <span aria-hidden="true" className="grid h-8 w-11 grid-cols-2 overflow-hidden rounded-[5px] shadow-[inset_0_0_0_1px_var(--line)]">
                                    <span style={{ background: t.accent }} /><span style={{ background: t.done }} />
                                </span>
                                <span className="flex flex-col gap-px"><span className="font-medium">{t.label}</span><span className="text-[12.5px] text-muted-foreground">{t.desc}</span></span>
                                <span aria-hidden="true" className={cn("size-[18px] rounded-full", on ? "border-[5px] border-foreground" : "border-[1.5px] border-[var(--box-line)]")} />
                            </button>
                        )
                    })}
                </div>
            </Group>
            <Headed key={bg} profile={profile} bg={bg} />
            <NameField profile={profile} />
            {bg === "med" && <CoatColour profile={profile} />}
            <Group title="Appearance" state={themeLabel(theme, dark)}>
                <div className="flex gap-1.5">
                    {LOOKS.map(([id, label, sw]) => (
                        <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}
                            className={cn(
                                "flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border border-border bg-muted p-2 font-[inherit] text-[12px] text-ink-2",
                                theme === id && "border-[var(--accent)] bg-accent font-semibold text-accent-foreground",
                            )}>
                            <span className="flex h-5 w-full overflow-hidden rounded-[5px] border border-border">
                                {sw.map((c) => <i key={c} className="flex-1" style={{ background: c }} />)}
                            </span>
                            {label}
                        </button>
                    ))}
                </div>
            </Group>
            <Quotes />
        </>
    )
}

/** Where you're headed: one of the theme's six goals, or typed. Stored in coat.role; shown on the picture. */
function Headed({ profile, bg }: { profile: Profile; bg: Bg }) {
    const saved = (profile.coat?.role ?? "").trim()
    const [own, setOwn] = useState(saved && !THEME_GOALS[bg].includes(saved) ? saved : "")
    const now = goalFor(bg, saved)
    return (
        <Group title="Where you’re headed">
            <Hint>Goes on your {THEMES[bg].wear}, so you see what the work is for.</Hint>
            <div role="radiogroup" aria-label="Where you’re headed" onKeyDown={radioKeys} className="flex flex-wrap gap-1.5">
                {THEME_GOALS[bg].map((g, i) => (
                    <button key={g} type="button" role="radio" aria-checked={g === now} tabIndex={rovingTab(i, THEME_GOALS[bg].indexOf(now))}
                        onClick={() => { setOwn(""); void saveCoat({ role: g }) }}
                        className={cn(
                            "h-[34px] cursor-pointer rounded-full border px-3 font-[inherit] text-[13px]",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                            g === now ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-border bg-card text-foreground",
                        )}>{g}</button>
                ))}
            </div>
            <TextInput id="o-goal" aria-label="Your own goal" placeholder="Or type your own" maxLength={22} value={own}
                /* an empty own goal falls back to the theme's first goal (goalFor), so that chip shows checked: intended */
                onChange={(e) => { setOwn(e.target.value); void saveCoat({ role: e.target.value.trim() }) }} />
        </Group>
    )
}

function NameField({ profile }: { profile: Profile }) {
    const [name, setName] = useState(profile.coat?.name ?? "")
    return (
        <Group title="Your name">
            <Hint>Shown on your coat, badge, name plate, jacket, jersey or vest.</Hint>
            <TextInput id="o-name" aria-label="Your name" value={name} maxLength={28} placeholder={profile.displayName || "Your name"}
                onChange={(e) => { setName(e.target.value); void saveCoat({ name: e.target.value }) }} />
        </Group>
    )
}

function CoatColour({ profile }: { profile: Profile }) {
    const colour = coatColour(profile)
    return (
        <Group title="Coat colour" state={colourName(colour)}>
            <Swatches value={colour} colors={COAT_PALETTE.map((p: { hex: string; name: string }) => ({ ...p, name: p.name + " coat" }))} onChange={(color) => void saveCoat({ color })} />
        </Group>
    )
}

function Quotes() {
    const quotes = useQuotes()
    const [text, setText] = useState("")
    const [source, setSource] = useState("")
    const add = async () => {
        if (await addQuote(text, source)) { setText(""); setSource(""); document.getElementById("qText")?.focus() }
    }
    const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void add() } }
    return (
        <Group title="Quotes" state={quotes.length + " saved"}>
            <div className="flex flex-col gap-1.5">
                {quotes.length === 0 && <Hint>No quotes yet — the tile stays clear.</Hint>}
                {quotes.map((q) => (
                    <div key={q.id} className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                            <div className="font-serif text-[12.5px] [overflow-wrap:anywhere] text-foreground italic">“{q.text}”</div>
                            {q.source && <div className="mt-0.5 text-[10.5px] text-muted-foreground">— {q.source}</div>}
                        </div>
                        <RemoveButton aria-label="Remove quote" onClick={() => void removeQuote(q.id)} />
                    </div>
                ))}
            </div>
            <div className="flex flex-col gap-1.5">
                <TextInput id="qText" value={text} maxLength={300} aria-label="Quote" placeholder="Quote — press Enter to add" className="border-border" onChange={(e) => setText(e.target.value)} onKeyDown={onEnter} />
                <span className="flex gap-1.5">
                    <TextInput value={source} maxLength={80} aria-label="Source" placeholder="Who said it (optional)" className="border-border" onChange={(e) => setSource(e.target.value)} onKeyDown={onEnter} />
                    <Button variant="ghost" onClick={() => void add()}>Add</Button>
                </span>
            </div>
        </Group>
    )
}
