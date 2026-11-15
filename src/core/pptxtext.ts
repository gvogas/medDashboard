// A PowerPoint file's words, read in the browser (spec §8): a .pptx is a zip, so this reads its
// directory, inflates each slide (ppt/slides/slideN.xml) and its speaker notes
// (ppt/notesSlides/notesSlideN.xml) with DecompressionStream('deflate-raw'), and keeps the
// text runs (<a:t>). No library: only the file's words leave it, as "### Slide N" blocks.

interface Entry { name: string; method: number; size: number; offset: number }

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

/** The zip's central directory: each file's name, how it is stored, and where. */
export function zipEntries(b: Uint8Array): Entry[] {
    /* the end-of-directory record is in the last 64 KB (its comment is at most 65,535 bytes) */
    let end = -1
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (u32(b, i) === 0x06054b50) { end = i; break }
    if (end < 0) throw new Error("not a zip")
    const count = u16(b, end + 10)
    let at = u32(b, end + 16)
    const out: Entry[] = []
    const names = new TextDecoder()
    for (let i = 0; i < count && at + 46 <= b.length; i++) {
        if (u32(b, at) !== 0x02014b50) break
        const method = u16(b, at + 10), size = u32(b, at + 20), nameLen = u16(b, at + 28), extra = u16(b, at + 30), comment = u16(b, at + 32)
        out.push({ name: names.decode(b.subarray(at + 46, at + 46 + nameLen)), method, size, offset: u32(b, at + 42) })
        at += 46 + nameLen + extra + comment
    }
    return out
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** One file's bytes from the zip, stored (0) or deflated (8). */
async function read(b: Uint8Array, e: Entry): Promise<Uint8Array> {
    if (u32(b, e.offset) !== 0x04034b50) throw new Error("bad zip entry")
    const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28)
    const raw = b.subarray(start, start + e.size)
    if (e.method === 0) return raw
    if (e.method === 8) return inflate(raw)
    throw new Error("unsupported zip method")
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e.toLowerCase()] ?? "")

/** A slide's text: each paragraph (<a:p>) on its own line, its runs (<a:t>) joined. */
export function slideText(xml: string): string {
    return xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => unescape(m[1])).join(""))
        .map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
}

/** Whether the bytes are a PowerPoint file: a zip holding ppt/presentation.xml. */
export function isPptx(b: Uint8Array): boolean {
    if (u32(b, 0) !== 0x04034b50) return false
    try { return zipEntries(b).some((e) => e.name === "ppt/presentation.xml") } catch { return false }
}

/* A .rels file's relationships: [id, type's last word, target] for each. */
const relationships = (xml: string): [string, string, string][] => [...xml.matchAll(/<Relationship\b[^>]*>/g)].flatMap((m) => {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[0])?.[1] ?? ""
    const id = attr("Id"), target = attr("Target"), kind = attr("Type").split("/").pop() ?? ""
    return id && target ? [[id, kind, unescape(target)] as [string, string, string]] : []
})
/* the number in a slide's or a notes page's file name, wherever the target points from */
const fileNumber = (target: string, stem: string) => Number(new RegExp(stem + "(\\d+)\\.xml$").exec(target)?.[1] ?? NaN)

/**
 * The deck's words, slide by slide in the deck's own order, each slide's speaker notes after it.
 * The order is the presentation's slide list and each slide's notes are the ones its .rels file
 * names: file numbers say neither (PowerPoint numbers a notes page as it is made, so the only
 * notes of a deck are notesSlide1.xml whichever slide they are on, and a moved slide keeps its
 * file). A file without those parts is read by file number, as before.
 */
export async function pptxText(file: Blob): Promise<string> {
    const b = new Uint8Array(await file.arrayBuffer())
    const entries = zipEntries(b), byName = new Map(entries.map((e) => [e.name, e] as const))
    const numbered = (re: RegExp) => new Map(entries.flatMap((e) => { const m = re.exec(e.name); return m ? [[Number(m[1]), e] as const] : [] }))
    const slides = numbered(/^ppt\/slides\/slide(\d+)\.xml$/), notes = numbered(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)
    const xml = new TextDecoder()
    const textOf = async (name: string) => (byName.has(name) ? xml.decode(await read(b, byName.get(name)!)) : null)

    /* the deck's order: the slide list's r:ids, through the presentation's relationships, to slide files */
    const rels = new Map(relationships(await textOf("ppt/_rels/presentation.xml.rels") ?? "").filter(([, kind]) => kind === "slide").map(([id, , target]) => [id, fileNumber(target, "slide")] as const))
    const listed = [...(await textOf("ppt/presentation.xml") ?? "").matchAll(/<p:sldId\b[^>]*\br:id="([^"]*)"/g)].map((m) => rels.get(m[1])).filter((n): n is number => n !== undefined && slides.has(n))
    const byFile = [...slides.keys()].sort((a, c) => a - c)
    /* numbered by place in the deck when the deck says its order; a slide file the list leaves out comes after */
    const order: [number, number][] = listed.length ? [...new Set([...listed, ...byFile])].map((n, i) => [n, i + 1]) : byFile.map((n) => [n, n])

    const out: string[] = []
    for (const [n, label] of order) {
        const text = slideText(xml.decode(await read(b, slides.get(n)!)))
        /* the slide's own relationships name its notes; with no .rels file, the notes page of the same number */
        const own = await textOf(`ppt/slides/_rels/slide${n}.xml.rels`)
        const page = own === null ? n : fileNumber(relationships(own).find(([, kind]) => kind === "notesSlide")?.[2] ?? "", "notesSlide")
        const said = notes.has(page) ? slideText(xml.decode(await read(b, notes.get(page)!))).replace(/^\d+$/m, "").trim() : ""
        if (text || said) out.push(`### Slide ${label}\n${text}${said ? "\nNotes: " + said : ""}`)
    }
    return out.join("\n\n")
}
