import { cn } from "@/lib/utils"

export const SpotifyMark = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-3.5 flex-none text-[color:var(--spotify)]", className)}>
        <circle cx="12" cy="12" r="12" fill="currentColor" />
        <path d="M6.2 9.4c3.9-1.1 8.4-.8 11.7 1.2M6.9 12.5c3.2-.9 6.9-.6 9.7 1M7.5 15.4c2.5-.7 5.3-.5 7.6.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
)
