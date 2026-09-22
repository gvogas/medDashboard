// The background biomolecule layer: two helices, a steroid, benzenes, a lipid.
// Drawn in the theme's teal; redrawn on resize and theme change.

import { $ } from './dom.js';

const canvas = $('orn'), ctx = canvas.getContext('2d'), hostEl = canvas.parentNode;

function hex(cx, cy, r, rot) { const p = []; for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; }
function poly(pts, close) { ctx.beginPath(); pts.forEach((p, i) => { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); if (close) ctx.closePath(); ctx.stroke(); }
function helix(x, y, len, amp, turns, angle) {
  const steps = 200, ca = Math.cos(angle), sa = Math.sin(angle);
  const pt = (t, ph) => { const al = t * len, off = amp * Math.sin(t * turns * Math.PI * 2 + ph); return [x + al * ca - off * sa, y + al * sa + off * ca]; };
  [0, Math.PI].forEach((ph) => {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) { const s = pt(i / steps, ph); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }
    ctx.stroke();
  });
  for (let i = 0; i <= 40; i++) { const a = pt(i / 40, 0), b = pt(i / 40, Math.PI); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
}
function steroid(x, y, r) {
  const d = r * Math.sqrt(3), p = [];
  poly(hex(x, y, r, Math.PI / 6), true); poly(hex(x + d, y - r * 0.5, r, Math.PI / 6), true); poly(hex(x + 2 * d, y - r, r, Math.PI / 6), true);
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; p.push([x + 2 * d + d * 0.92 + r * 0.86 * Math.cos(a), y - r * 1.4 + r * 0.86 * Math.sin(a)]); }
  poly(p, true);
}
function benzene(x, y, r) { poly(hex(x, y, r, Math.PI / 6), true); ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, Math.PI * 2); ctx.stroke(); }
function lipid(x, y, n, step) {
  const pts = []; for (let i = 0; i <= n; i++) pts.push([x + i * step, y + (i % 2 ? -step * 0.55 : step * 0.55)]);
  poly(pts, false); ctx.beginPath(); ctx.arc(x - step * 0.5, y + step * 0.2, step * 0.42, 0, Math.PI * 2); ctx.stroke();
}
function draw() {
  const w = hostEl.clientWidth, h = hostEl.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const stroke = getComputedStyle(document.documentElement).getPropertyValue('--orn-stroke').trim();
  ctx.strokeStyle = stroke || '#0E7C74'; ctx.lineWidth = 1.15; ctx.lineJoin = 'round';
  helix(-40, h * 0.14, Math.hypot(w + 120, h * 0.72), 26, 7, Math.atan2(h * 0.68, w + 120));
  helix(w * 0.30, h + 30, Math.hypot(w * 0.82, h * 0.95), 18, 6, Math.atan2(-h * 0.95, w * 0.82));
  steroid(w * 0.60, h * 0.16, 20);
  benzene(w * 0.14, h * 0.70, 22); benzene(w * 0.20, h * 0.77, 15);
  lipid(w * 0.72, h * 0.78, 9, 15);
  steroid(w * 0.05, h * 0.38, 13);
}
let raf = null;
export function schedule() { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
if (window.ResizeObserver) new ResizeObserver(schedule).observe(hostEl);
window.addEventListener('resize', schedule);
