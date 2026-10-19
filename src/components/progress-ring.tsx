// A small progress ring (spec §15): a project's tasks done, in its colour.

export function ProgressRing({ frac, color, label, size = 14 }: { frac: number; color: string | null; label: string; size?: number }) {
    const r = 5.5, c = 2 * Math.PI * r
    return (
        <svg role="img" aria-label={label} viewBox="0 0 14 14" width={size} height={size} className="shrink-0 -rotate-90">
            <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
            <circle cx="7" cy="7" r={r} fill="none" stroke={color ?? "var(--accent)"} strokeWidth="2" strokeLinecap="round"
                strokeDasharray={`${c * Math.min(1, Math.max(0, frac))} ${c}`} />
        </svg>
    )
}
