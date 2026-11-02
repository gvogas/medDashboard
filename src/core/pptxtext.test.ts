import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { isPptx, pptxText, slideText } from './pptxtext.ts'

/* a small zip, one entry per [name, text, deflate?] */
function zip(files: [string, string, boolean][]): Uint8Array {
  const enc = new TextEncoder(), locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, text, deflate] of files) {
    const n = enc.encode(name), raw = enc.encode(text), data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const local = new Uint8Array(30 + n.length + data.length), lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true)
    local.set(n, 30); local.set(data, 30 + n.length)
    const central = new Uint8Array(46 + n.length), cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true)
    central.set(n, 46)
    locals.push(local); centrals.push(central); offset += local.length
  }
  const dirSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22), ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true)
  const all = new Uint8Array(offset + dirSize + 22)
  let at = 0
  for (const p of [...locals, ...centrals, end]) { all.set(p, at); at += p.length }
  return all
}
const slide = (...paras: string[][]) => `<p:sld><p:txBody>${paras.map((runs) => `<a:p>${runs.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('')}</a:p>`).join('')}</p:txBody></p:sld>`

describe('PowerPoint text', () => {
  it('reads each slide in order with its notes, deflated or stored', async () => {
    const deck = zip([
      ['ppt/presentation.xml', '<p:presentation/>', false],
      ['ppt/slides/slide2.xml', slide(['Beta ', 'blockers']), true],
      ['ppt/slides/slide1.xml', slide(['Autonomic drugs'], ['Week 3 &amp; 4']), true],
      ['ppt/slides/slide10.xml', slide(['Summary']), false],
      ['ppt/notesSlides/notesSlide2.xml', slide(['Ask about asthma']), true],
    ])
    expect(isPptx(deck)).toBe(true)
    expect(await pptxText(new Blob([deck as BlobPart]))).toBe('### Slide 1\nAutonomic drugs\nWeek 3 & 4\n\n### Slide 2\nBeta blockers\nNotes: Ask about asthma\n\n### Slide 10\nSummary')
  })
  it('knows a pptx from another zip or a non-zip', () => {
    expect(isPptx(zip([['word/document.xml', '<w:document/>', false]]))).toBe(false)
    expect(isPptx(new TextEncoder().encode('%PDF-1.7'))).toBe(false)
    expect(slideText('<a:p><a:t>x &lt; y</a:t></a:p><a:p></a:p>')).toBe('x < y')
  })
})
