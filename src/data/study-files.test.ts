import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { FILE_ERRORS, readStudyFile } from "./study-ai"

// Real files, written by the programs people use: PowerPoint files from python-pptx (the Office
// format as PowerPoint writes it) and from LibreOffice Impress; PDFs from reportlab and from
// LibreOffice, and a scan with no text. Made by test/fixtures/study/README.md's commands.
const fixture = (name: string, type = "") => new File([readFileSync(new URL("../../test/fixtures/study/" + name, import.meta.url))], name, { type })

describe("reading study files", () => {
    it("reads a PowerPoint deck slide by slide, with its speaker notes", async () => {
        const r = await readStudyFile(fixture("lecture.pptx"))
        expect(r).toEqual({ text: "### Slide 1\nBeta blockers\nBlock β1 and β2 receptors\nNames end in -olol\nNotes: Ask about asthma & COPD\n\n### Slide 2\nSide effects\nBradycardia, fatigue, cold hands" })
    })

    it("reads the same deck saved by LibreOffice Impress", async () => {
        const r = await readStudyFile(fixture("lecture-libreoffice.pptx")) as { text: string }
        expect(r.text).toContain("### Slide 1\nBeta blockers")
        expect(r.text).toContain("Names end in -olol")
        expect(r.text).toContain("### Slide 2\nSide effects")
    })

    it("reads PDFs page by page, from reportlab and from LibreOffice", async () => {
        const a = await readStudyFile(fixture("notes.pdf", "application/pdf")) as { text: string }
        expect(a.text).toMatch(/### Page 1\nPharmacology week 3\s+Beta blockers end in -olol\./)
        expect(a.text).toMatch(/### Page 2\nACE inhibitors end in -pril\./)
        const b = await readStudyFile(fixture("lecture-libreoffice.pdf", "application/pdf")) as { text: string }
        expect(b.text).toContain("Beta blockers")
        expect(b.text).toContain("### Page 2")
    })

    it("says a scanned PDF has no text, rather than sending nothing", async () => {
        expect(await readStudyFile(fixture("scanned.pdf", "application/pdf"))).toEqual({ error: FILE_ERRORS.empty })
    })
})
