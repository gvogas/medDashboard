// How each picture prints a name: the coat embroiders it whole, the badge in two lines
// with initials, the others "A. RIVERA" or "RIVERA". From the prototype's renderVals.

export function nameParts(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const first = words[0] || "", last = words.length > 1 ? words[words.length - 1] : ""
    return {
        first, last,
        initials: (first[0] || "") + (last[0] || ""),
        capsShort: ((last && first[0] ? first[0] + ". " : "") + (last || first)).toUpperCase(),
        capsLast: (last || first).toUpperCase(),
    }
}

/**
 * The largest font size, at most basePx, at which `text` fits in maxPx: each character is
 * about charEm of the size wide (~0.6 mono and capitals, ~0.47 the coat's italic serif),
 * plus trackPx of letter-spacing. Rounded to 0.1, never below 4px.
 */
export const fitSize = (text: string, maxPx: number, basePx: number, charEm: number, trackPx = 0) =>
    Math.max(4, Math.min(basePx, Math.round((maxPx / Math.max(1, text.length) - trackPx) / charEm * 10) / 10))

/**
 * The font size and letter-spacing for `text` in maxPx: fitSize, and at the 4px floor the
 * spacing shrinks too, so even a long name stays on its plate.
 */
export function fitStyle(text: string, maxPx: number, basePx: number, charEm: number, trackPx = 0) {
    const fontSize = fitSize(text, maxPx, basePx, charEm, trackPx), n = Math.max(1, text.length)
    const letterSpacing = n * (fontSize * charEm + trackPx) > maxPx ? Math.max(0, Math.floor((maxPx / n - fontSize * charEm) * 10) / 10) : trackPx
    return { fontSize, letterSpacing }
}

/** The embroidery's font size: 12.5px, smaller for a long name, so it fits the pocket. */
export const coatSize = (name: string) => fitSize(name, 66, 12.5, 0.47)
