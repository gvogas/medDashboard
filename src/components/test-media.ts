// jsdom has no matchMedia; Framer Motion asks it for prefers-reduced-motion.
export function stubMatchMedia({ reducedMotion }: { reducedMotion: boolean }) {
    window.matchMedia = (query: string) => ({
        matches: reducedMotion && query.includes("reduce"),
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
    })
}
