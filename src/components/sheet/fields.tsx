// The sheet's parts and form controls, in the Texture look: the head, body and foot, a
// section, the two-column field grid and its controls. The item and course sheets use
// them now, Settings in 4b. The item card adds its rows (Props, Prop), its type buttons
// (Chips) and the folded parts' buttons (AddButton).

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { accent } from "@/components/views/bits"

/* ── the sheet's frame ── */

/** The head line: what it is, chips, whatever else, and ✕ at the end. */
export function SheetHead({ color, kind, children, onClose }: { color?: string; kind: string; children?: ReactNode; onClose: () => void }) {
    return (
        <div style={accent(color)} className="flex flex-wrap items-center gap-2 border-b border-line-2 px-4 pt-3.5 pb-3">
            <span className="text-[12.5px] font-[650] text-[color-mix(in_srgb,var(--c,var(--ink-2))_78%,var(--ink))]">{kind}</span>
            {children}
            <IconButton aria-label="Close" onClick={onClose} className="ml-auto">✕</IconButton>
        </div>
    )
}

export const SheetBody = ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={cn("flex flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pt-4 pb-[26px]", className)}>{children}</div>
)

/** The foot: a hint on the left, the buttons on the right. */
export const SheetFoot = ({ hint, children }: { hint: ReactNode; children: ReactNode }) => (
    <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-4 py-3 max-[700px]:pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
        <span role="status" className="mr-auto text-[11.5px] text-muted-foreground">{hint}</span>
        {children}
    </div>
)

/** A titled part of the body: Notes, Checklist, Classes. `note` sits at the end of the title. */
export const Section = ({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) => (
    <section className="flex flex-col gap-2">
        <h4 className="m-0 flex items-center gap-2 text-[12.5px] font-[650] text-ink-2">
            {title}
            {note != null && <em className="ml-auto text-[11px] font-medium text-muted-foreground not-italic">{note}</em>}
        </h4>
        {children}
    </section>
)

/* ── buttons ── */

const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border px-3.5 py-[7px] font-[inherit] text-[12.5px] leading-tight transition-[filter,color,border-color] disabled:cursor-default"

/** The sheet's buttons: the accent gradient, the study colour, the quiet ghost, or the crit colour. */
export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: "primary" | "study" | "ghost" | "danger" }) {
    return (
        <button
            type="button"
            {...props}
            className={cn(
                BUTTON,
                variant === "primary" && "border-[color-mix(in_srgb,var(--accent)_72%,#000)] bg-[linear-gradient(color-mix(in_srgb,var(--accent)_90%,#fff),color-mix(in_srgb,var(--accent)_92%,#000))] font-[650] text-primary-foreground shadow-[var(--shadow-1),inset_0_1px_0_rgba(255,255,255,.28)] hover:brightness-[1.07] active:brightness-[.94]",
                variant === "study" && "border-[color-mix(in_srgb,var(--study)_72%,#000)] bg-[linear-gradient(color-mix(in_srgb,var(--study)_90%,#fff),color-mix(in_srgb,var(--study)_92%,#000))] font-[650] text-primary-foreground shadow-[0_8px_20px_-8px_var(--study),inset_0_1px_0_rgba(255,255,255,.28)] hover:brightness-[1.07] active:brightness-[.94]",
                variant === "ghost" && "border-border bg-[linear-gradient(var(--panel),var(--panel-2))] font-[550] text-ink-2 shadow-[var(--shadow-1),inset_0_1px_0_var(--rim-hi)] hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))] hover:text-foreground",
                variant === "danger" && "border-[color-mix(in_srgb,var(--crit)_72%,#000)] bg-[linear-gradient(color-mix(in_srgb,var(--crit)_90%,#fff),color-mix(in_srgb,var(--crit)_92%,#000))] font-[650] text-[var(--on-crit)]",
                "disabled:border-transparent disabled:bg-[var(--disabled)] disabled:shadow-none disabled:brightness-100",
                className,
            )}
        />
    )
}

/** A small quiet button: ✕, "Edit course". */
export const IconButton = ({ className, ...props }: ComponentProps<"button">) => (
    <button
        type="button"
        {...props}
        className={cn(
            "cursor-pointer rounded-[9px] border border-border bg-[linear-gradient(var(--panel),var(--panel-2))] px-2 py-1 font-[inherit] text-[12px] leading-tight text-ink-2 shadow-[var(--shadow-1),inset_0_1px_0_var(--rim-hi)] hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))] hover:text-accent-foreground",
            className,
        )}
    />
)

/** ✕ beside a step, a link or a class. */
export const RemoveButton = ({ className, ...props }: ComponentProps<"button">) => (
    <button type="button" {...props} className={cn("cursor-pointer border-0 bg-transparent px-1 font-[inherit] text-[14px] leading-none text-muted-foreground hover:text-destructive", className)}>✕</button>
)

/* ── fields ── */

/** The two-column grid: labels on the left, controls on the right. */
export const Fields = ({ children }: { children: ReactNode }) => (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 text-[12.5px]">{children}</div>
)

export const Label = ({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) =>
    htmlFor
        ? <label htmlFor={htmlFor} className="text-[12px] font-[550] text-muted-foreground">{children}</label>
        : <span className="text-[12px] font-[550] text-muted-foreground">{children}</span>

/** The item card's property list, a line between rows. */
export const Props = ({ children }: { children: ReactNode }) => (
    <div className="flex flex-col border-t border-line-2 text-[13px]">{children}</div>
)

/** One property: an icon and its name on the left, the control on the right. `top` lines the
    name up with the first line of a tall control (Date, Repeat). */
export function Prop({ icon, label, htmlFor, top = false, children }: { icon: ReactNode; label: string; htmlFor?: string; top?: boolean; children: ReactNode }) {
    const name = cn("flex items-center gap-2 text-[13px] text-muted-foreground", top && "h-8")
    return (
        <div className={cn("grid min-h-12 grid-cols-[104px_minmax(0,1fr)] gap-x-2 border-b border-line-2", top ? "items-start py-2.5" : "items-center py-1.5")}>
            {htmlFor ? <label htmlFor={htmlFor} className={name}>{icon}{label}</label> : <span className={name}>{icon}{label}</span>}
            <div className="min-w-0">{children}</div>
        </div>
    )
}

/** Buttons in a row, one pressed, each with its colour: the item's type. */
export function Chips({ label, value, options, onChange }: {
    label: string; value: string; options: readonly { id: string; label: string; color: string }[]; onChange: (id: string) => void
}) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    style={accent(o.color)}
                    aria-pressed={o.id === value}
                    onClick={() => { if (o.id !== value) onChange(o.id) }}
                    className={cn(
                        "flex h-8 cursor-pointer items-center gap-[7px] rounded-full border border-border bg-card px-3 font-[inherit] text-[12.5px] text-foreground transition-colors hover:border-[var(--c)]",
                        o.id === value && "border-[var(--c)] bg-[color-mix(in_srgb,var(--c)_10%,var(--panel))] font-semibold",
                    )}
                >
                    <span aria-hidden="true" className="size-[7px] rounded-[2px] bg-[var(--c)]" />{o.label}
                </button>
            ))}
        </div>
    )
}

/** A dashed "+ Notes" that opens a folded part. Give it an aria-label that starts "Add". */
export const AddButton = ({ className, children, ...props }: ComponentProps<"button">) => (
    <button
        type="button"
        {...props}
        className={cn("flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--box-line)] bg-transparent px-3 font-[inherit] text-[12.5px] text-ink-2 hover:border-[var(--accent)] hover:text-foreground", className)}
    >
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        {children}
    </button>
)

/** What every text-like control looks like: a soft well, an accent ring on focus. */
export const CONTROL = cn(
    "w-full min-w-0 rounded-[10px] border border-transparent bg-muted px-2.5 py-1.5 font-[inherit] text-[12.5px] text-foreground outline-none",
    "hover:border-border focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_24%,transparent)]",
    "placeholder:text-muted-foreground aria-[invalid=true]:border-[var(--red-ink)]",
)

/** A control with no well until hovered or focused: the item card's rows. Put it after CONTROL in cn(). */
export const QUIET = "bg-transparent hover:bg-muted focus-visible:bg-card"

export const TextInput =({ className, ...props }: ComponentProps<"input">) => <input type="text" {...props} className={cn(CONTROL, className)} />
export const NumberInput = ({ className, ...props }: ComponentProps<"input">) => <input type="number" {...props} className={cn(CONTROL, className)} />
export const DateInput = ({ className, ...props }: ComponentProps<"input">) => <input type="date" {...props} className={cn(CONTROL, className)} />
export const Select = ({ className, ...props }: ComponentProps<"select">) => <select {...props} className={cn(CONTROL, "cursor-pointer", className)} />
export const TextArea = ({ className, ...props }: ComponentProps<"textarea">) => (
    <textarea {...props} className={cn(CONTROL, "min-h-[92px] resize-y border-border px-3 py-2.5 text-[13px] leading-[1.55]", className)} />
)

/** A textarea that grows with what is typed: the sheet's big title. Its bottom padding,
    part of the height it measures, keeps the descenders from being clipped. */
export function TitleArea({ className, value, ...props }: ComponentProps<"textarea"> & { value: string }) {
    const ref = useRef<HTMLTextAreaElement>(null)
    useLayoutEffect(() => {
        const t = ref.current
        if (!t) return
        t.style.height = "auto"
        t.style.height = t.scrollHeight + "px"
    }, [value])
    return (
        <textarea
            ref={ref}
            rows={1}
            value={value}
            {...props}
            className={cn("w-full resize-none overflow-hidden rounded-md border-0 bg-transparent px-0 pt-0 pb-1 font-[inherit] text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]", className)}
        />
    )
}

/** A row of buttons, one pressed: the item's status. */
export function Segmented<T extends string>({ value, options, onChange, label, id }: {
    value: T; options: readonly (readonly [T, string])[]; onChange: (v: T, el: HTMLButtonElement) => void; label: string; id?: string
}) {
    return (
        <div role="group" aria-label={label} id={id} className="flex flex-wrap gap-0.5 rounded-[10px] bg-muted p-0.5">
            {options.map(([v, text]) => (
                <button
                    key={v}
                    type="button"
                    aria-pressed={v === value}
                    onClick={(e) => { if (v !== value) onChange(v, e.currentTarget) }}
                    className={cn(
                        "flex-1 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1 font-[inherit] text-[12px] font-semibold whitespace-nowrap text-ink-2 hover:text-foreground",
                        v === value && "bg-card text-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,.1),inset_0_1px_0_var(--rim-hi)]",
                    )}
                >{text}</button>
            ))}
        </div>
    )
}

/** A checkbox with its words beside it. */
export const Checkbox = ({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) => (
    <span className="flex items-center gap-1.5">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
        <span className="text-[11px] text-muted-foreground">{children}</span>
    </span>
)

/** Colour swatches, the chosen one pressed, with its name. */
export function Swatches({ value, colors, onChange }: { value: string; colors: readonly { hex: string; name: string }[]; onChange: (hex: string) => void }) {
    return (
        <span className="flex flex-wrap gap-[7px]">
            {colors.map((p) => (
                <button
                    key={p.hex}
                    type="button"
                    style={accent(p.hex)}
                    aria-pressed={p.hex === value}
                    aria-label={p.name}
                    title={p.name}
                    onClick={() => onChange(p.hex)}
                    className={cn(
                        "size-[26px] cursor-pointer rounded-lg border-2 border-transparent bg-[var(--c)] p-0 shadow-[inset_0_0_0_1px_rgba(20,48,45,.1)]",
                        p.hex === value && "border-foreground shadow-[inset_0_0_0_2px_#fff]",
                    )}
                />
            ))}
        </span>
    )
}

/** A bar filling toward done: the checklist's (pink) and the grades'. */
export const Meter = ({ part, pink = false, full = false }: { part: number; pink?: boolean; full?: boolean }) => (
    <span className="block h-[7px] overflow-hidden rounded-full bg-line-2">
        <span
            className={cn(
                "block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                pink ? (full ? "bg-[linear-gradient(90deg,#DE7A9C,#C8517A)]" : "bg-[linear-gradient(90deg,#EFAEC3,#D9648C)]") : "bg-primary",
            )}
            style={{ width: Math.max(0, Math.min(100, Math.round(part * 100))) + "%" }}
        />
    </span>
)

/** A quiet note under a section, or a warning. */
export const Note = ({ tone, children }: { tone?: "ok" | "bad"; children: ReactNode }) => (
    <span className={cn("block text-[11.5px]", tone === "ok" ? "text-[var(--good)]" : tone === "bad" ? "text-destructive" : "text-muted-foreground")}>{children}</span>
)
export const Warning = ({ children }: { children: ReactNode }) => (
    <div className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-[7px] text-[11.5px] text-[var(--warn-ink)]">{children}</div>
)
