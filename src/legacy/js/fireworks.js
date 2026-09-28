// Fireworks from a point on the page. A fixed canvas over everything that only
// exists, and only draws, while sparks are alive: idle cost is zero.

import { HEXES } from '../../core/model.ts';

let canvas = null, ctx = null, raf = null, last = 0;
const rockets = [], sparks = [];
const GRAVITY = 260;              // px/s²

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  size();
  window.addEventListener('resize', size);
}

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function teardown() {
  cancelAnimationFrame(raf);
  raf = null;
  window.removeEventListener('resize', size);
  canvas.remove();
  canvas = ctx = null;
}

function burst(x, y, colour) {
  const n = 46 + Math.floor(Math.random() * 20);
  const speed = 170 + Math.random() * 110;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.12;
    const v = speed * (0.55 + Math.random() * 0.45);
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9 + Math.random() * 0.7, age: 0, colour, r: 1.6 + Math.random() * 1.6, trail: [] });
  }
  // a few bright white pops in the middle
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 40;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, age: 0, colour: '#FFFFFF', r: 2, trail: [] });
  }
}

function step(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
  last = now;
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.age += dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.vy += GRAVITY * 0.35 * dt;
    ctx.strokeStyle = r.colour;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - r.vx * 0.06, r.y - r.vy * 0.06);
    ctx.stroke();
    if (r.age >= r.fuse) { rockets.splice(i, 1); burst(r.x, r.y, r.colour); }
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt;
    if (s.age >= s.life) { sparks.splice(i, 1); continue; }
    s.trail.push([s.x, s.y]);
    if (s.trail.length > 6) s.trail.shift();
    s.vy += GRAVITY * dt;
    s.vx *= 0.985;
    s.vy *= 0.985;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const t = s.age / s.life, alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = s.colour;
    ctx.lineWidth = s.r;
    ctx.beginPath();
    s.trail.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = t > 0.8 && Math.random() < 0.3 ? '#FFFFFF' : s.colour;   /* twinkle at the end */
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (rockets.length || sparks.length) raf = requestAnimationFrame(step);
  else teardown();
}

/** Launch a small show from (x, y) in viewport pixels. */
export function launch(x, y, { rockets: count = 3 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  ensureCanvas();
  const colours = [...HEXES, '#F5C542'];
  for (let i = 0; i < count; i++) {
    const colour = colours[Math.floor(Math.random() * colours.length)];
    rockets.push({
      x: x + (Math.random() - 0.5) * 40, y,
      vx: (Math.random() - 0.5) * 120, vy: -(300 + Math.random() * 160),
      age: -i * 0.18, fuse: 0.55 + Math.random() * 0.35, colour,
    });
  }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
}
