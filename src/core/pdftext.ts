// The text of a PDF, read in the browser. Cloudflare's document conversion drops the
// text of many tables — which is where outlines keep their schedules and due dates —
// so PDFs are read here and sent to the Worker as plain text.
//
// vendor/pdfjs.mjs is Mozilla PDF.js (Apache-2.0), the single-file serverless build
// shipped by unpdf 1.8.1 (MIT). It is loaded only when an outline PDF is chosen.

import { readGrid, type PdfBox, type PdfItem } from './timetable-grid';

/* The part of PDF.js read here; the vendored build is plain JavaScript with no types. */
interface PdfPage {
  getTextContent(): Promise<{ items: { str?: string | null; hasEOL?: boolean; transform?: number[]; width?: number; height?: number }[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}
interface PdfJs {
  getDocument(src: { data: Uint8Array; useSystemFonts: boolean; isEvalSupported: boolean; disableFontFace: boolean }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPage> }>;
    destroy(): Promise<void>;
  };
  OPS: Record<string, number>;
}
let pdfjs: PdfJs | null = null;

/** Each page of the PDF given to `read`, the pages' text marked "### Page 3". */
async function eachPage(file: Blob, read: (page: PdfPage) => Promise<string>): Promise<string> {
  pdfjs ||= await import('./vendor/pdfjs.mjs') as PdfJs;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  try {
    const doc = await task.promise;   /* a damaged or locked PDF fails here: the task still ends */
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push('### Page ' + n + '\n' + await read(await doc.getPage(n)));
    return pages.join('\n\n').trim();
  } finally {
    await task.destroy();
  }
}

/** Text items as PDF.js reads them, lines kept, spaces tidied. */
const joined = (items: { str?: string | null; hasEOL?: boolean }[]) =>
  items.filter((i) => i.str != null).map((i) => i.str + (i.hasEOL ? '\n' : '')).join('')
    .replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');

/** Every page's text, lines kept, pages marked, e.g. "### Page 3\n29-Sep Term test 1\n…" */
export async function pdfText(file: Blob): Promise<string> {
  return eachPage(file, async (page) => joined((await page.getTextContent()).items));
}

type Matrix = [number, number, number, number, number, number];
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const point = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The boxes drawn on a page, in PDF points: each path's bounds, through the transforms in force. */
async function boxesOf(page: PdfPage, ops: Record<string, number>): Promise<PdfBox[]> {
  const { fnArray, argsArray } = await page.getOperatorList();
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [], boxes: PdfBox[] = [];
  fnArray.forEach((fn, k) => {
    const args = argsArray[k];
    if (fn === ops.save) saved.push(ctm);
    else if (fn === ops.restore) ctm = saved.pop() ?? ctm;
    else if (fn === ops.transform) ctm = times(ctm, args as Matrix);
    else if (fn === ops.constructPath) {
      /* [op, path, [minX, minY, maxX, maxY]] */
      const b = args?.[2] as ArrayLike<number> | null | undefined;
      if (!b || b.length < 4) return;
      const [xa, ya] = point(ctm, b[0], b[1]), [xb, yb] = point(ctm, b[2], b[3]);
      boxes.push({ x1: Math.min(xa, xb), y1: Math.min(ya, yb), x2: Math.max(xa, xb), y2: Math.max(ya, yb) });
    }
  });
  return boxes;
}

/**
 * A timetable PDF's text for the model: on a page with a weekday grid, its classes one per
 * line with the weekday and times their cells give (timetable-grid.ts), then the page's other
 * text; any other page as pdfText reads it.
 */
export async function pdfTimetable(file: Blob): Promise<string> {
  return eachPage(file, async (page) => {
    const raw = (await page.getTextContent()).items;
    const items: PdfItem[] = raw.map((i) => ({ str: i.str ?? '', x: i.transform?.[4] ?? 0, y: i.transform?.[5] ?? 0, w: i.width ?? 0, h: i.height ?? 0 }));
    /* a drawing PDF.js cannot read leaves the text alone */
    const grid = await readGrid(items, () => boxesOf(page, pdfjs!.OPS)).catch(() => null);
    if (!grid) return joined(raw);
    const rest = joined(raw.filter((_, i) => !grid.used.has(i)));
    return 'Timetable grid (each line is one class: its weekday and its start and end times, read from the page layout):\n'
      + grid.lines.join('\n') + '\n\nOther text on the page:\n' + rest;
  });
}
