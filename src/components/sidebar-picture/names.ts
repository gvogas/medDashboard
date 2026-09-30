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

/** The embroidery's font size: 12.5px, smaller for a long name, so it fits the pocket. */
export const coatSize = (name: string) => Math.min(12.5, Math.round(66 / (Math.max(1, name.length) * 0.47) * 10) / 10)
