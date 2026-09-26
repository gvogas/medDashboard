// A picture made into a sticker: cut to a circle with a white die-cut edge, drawn from
// where it was dragged and how far it was zoomed, and kept small enough to sync as a
// data: URL (WebP when the browser can write it, else PNG, smaller until it fits).

export const STICKER_MAX = 90_000;          /* characters; worker/validate.js holds the same line */
const EDGE = 0.07;                          /* the white edge, as a share of the size */

/** The picture in a file, upright; null when the browser cannot read it (HEIC on most). */
export async function readPicture(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) return null;
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
}

/**
 * Draw the sticker on `canvas` (square): `crop` is {x, y, zoom}, where zoom 1 fills the
 * circle with the picture's short side and x, y (-1 to 1) slide it within what is left.
 */
export function drawSticker(canvas, pic, { x = 0, y = 0, zoom = 1 } = {}) {
  const size = canvas.width, ctx = canvas.getContext('2d');
  const r = size / 2, inner = r * (1 - EDGE);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(r, r, r - 0.5, 0, Math.PI * 2); ctx.fill();
  const scale = (inner * 2 / Math.min(pic.width, pic.height)) * zoom;
  const w = pic.width * scale, h = pic.height * scale;
  const spareX = Math.max(0, (w - inner * 2) / 2), spareY = Math.max(0, (h - inner * 2) / 2);
  ctx.save();
  ctx.beginPath(); ctx.arc(r, r, inner, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pic, r - w / 2 - x * spareX, r - h / 2 - y * spareY, w, h);
  ctx.restore();
}

/** How far a drag of (dx, dy) pixels on a `shown`-pixel preview moves the crop. */
export function dragCrop(crop, pic, dx, dy, shown) {
  const inner = shown / 2 * (1 - EDGE);
  const scale = (inner * 2 / Math.min(pic.width, pic.height)) * crop.zoom;
  const spareX = Math.max(1, (pic.width * scale - inner * 2) / 2), spareY = Math.max(1, (pic.height * scale - inner * 2) / 2);
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return { ...crop, x: clamp(crop.x - dx / spareX), y: clamp(crop.y - dy / spareY) };
}

/** The finished sticker as a data: URL under STICKER_MAX, or null if it will not fit. */
export function stickerData(pic, crop) {
  for (const size of [256, 208, 160]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    drawSticker(canvas, pic, crop);
    for (const q of [0.86, 0.72, 0.58]) {
      const url = canvas.toDataURL('image/webp', q);
      if (!url.startsWith('data:image/webp')) break;       /* this browser writes PNG instead */
      if (url.length <= STICKER_MAX) return url;
    }
    const png = canvas.toDataURL('image/png');
    if (png.length <= STICKER_MAX) return png;
  }
  return null;
}
