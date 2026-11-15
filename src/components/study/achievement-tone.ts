// The achievement groups' colours, on their own so the unlock toast (toaster.tsx, on every page)
// does not pull the whole Achievements card into the first load.

/* Each group's colour, as --g (the ring and tick), --g-soft (the medal) and --g-ink (its
   words). The unlock toast's medal (toaster.tsx) takes it too. */
export const TONE: Record<string, string> = {
    hours: "[--g:var(--study)] [--g-soft:var(--study-soft)] [--g-ink:var(--study-ink)]",
    streak: "[--g:#E08A3C] [--g-soft:var(--amber-bg)] [--g-ink:var(--amber-ink)] dark:[--g:#E9A25E]",
    days: "[--g:var(--accent)] [--g-soft:var(--accent-soft)] [--g-ink:var(--accent-ink)]",
    tasks: "[--g:var(--good)] [--g-soft:color-mix(in_srgb,var(--good)_16%,var(--panel))] [--g-ink:var(--good)]",
    exams: "[--g:var(--break)] [--g-soft:var(--break-soft)] [--g-ink:var(--break-ink)]",
    grades: "[--g:#D9A21E] [--g-soft:color-mix(in_srgb,#E8B33A_20%,var(--panel))] [--g-ink:#855D00] dark:[--g-ink:#F0C96A]",
    own: "[--g:var(--mine)] [--g-soft:color-mix(in_srgb,var(--mine)_16%,var(--panel))] [--g-ink:color-mix(in_srgb,var(--mine)_70%,var(--ink))]",
}
