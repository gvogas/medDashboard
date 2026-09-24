// The text of a PDF, read in the browser. Cloudflare's document conversion drops the
// text of many tables — which is where outlines keep their schedules and due dates —
// so PDFs are read here and sent to the Worker as plain text.
//
// vendor/pdfjs.mjs is Mozilla PDF.js (Apache-2.0), the single-file serverless build
// shipped by unpdf 1.8.1 (MIT). It is loaded only when an outline PDF is chosen.

let pdfjs = null;

/** Every page's text, lines kept, pages marked, e.g. "### Page 3\n29-Sep Term test 1\n…" */
export async function pdfText(file) {
  pdfjs ||= await import('./vendor/pdfjs.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const text = content.items.filter((i) => i.str != null).map((i) => i.str + (i.hasEOL ? '\n' : '')).join('');
      pages.push('### Page ' + n + '\n' + text.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n'));
    }
    return pages.join('\n\n').trim();
  } finally {
    await task.destroy();
  }
}
