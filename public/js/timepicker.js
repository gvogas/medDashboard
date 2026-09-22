// A time field you can type into or pick from: `<input class="tp">` holding HH:MM.
// Typing "830", "8:30", "8pm" all land on a valid time; a popover lists quarter
// hours; ↑/↓ nudge by fifteen minutes. Sets the input's value and fires `input`,
// so the drawers' existing handlers see it like any other field.

const STEP = 15;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** "8", "830", "8:30", "8pm" → "08:30" etc. '' for blank, null for nonsense. */
export function parseTime(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})(?:[:.h]\s*(\d{1,2})|(\d{2}))?\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] != null ? +m[2] : m[3] != null ? +m[3] : 0;
  if (m[4] === 'p' && h < 12) h += 12;
  if (m[4] === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return pad(h) + ':' + pad(min);
}

/** Nudge by a quarter hour, snapping to the grid, clamped to the day. */
export function stepTime(value, dir) {
  const v = parseTime(value);
  if (!v) return '09:00';
  const [h, m] = v.split(':').map(Number);
  let total = h * 60 + m;
  total = dir > 0 ? Math.floor(total / STEP) * STEP + STEP : Math.ceil(total / STEP) * STEP - STEP;
  total = Math.max(0, Math.min(23 * 60 + 45, total));
  return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
}

// ── DOM wiring: one popover, delegated events ─────────────────────────────

const SLOTS = [];
for (let t = 0; t < 24 * 60; t += STEP) SLOTS.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60));

let pop = null;
let active = null;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'tp-pop';
  pop.setAttribute('role', 'listbox');
  pop.innerHTML = SLOTS.map((t) => '<button type="button" role="option" data-tp="' + t + '">' + t + '</button>').join('');
  pop.addEventListener('mousedown', (e) => e.preventDefault());   /* keep the input focused */
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tp]');
    if (b && active) { commit(active, b.dataset.tp); active.blur(); }
  });
  document.body.appendChild(pop);
  return pop;
}

function commit(input, value) {
  if (input.value === value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function place(input) {
  const r = input.getBoundingClientRect();
  const p = ensurePop();
  p.style.left = r.left + 'px';
  p.style.top = (r.bottom + 4) + 'px';
  p.style.minWidth = Math.max(96, r.width) + 'px';
  const below = window.innerHeight - r.bottom - 8;
  p.style.maxHeight = Math.max(120, Math.min(240, below)) + 'px';
}

function highlight(input) {
  const v = parseTime(input.value) || '09:00';
  const [h, m] = v.split(':').map(Number);
  const nearest = pad(h) + ':' + pad(Math.floor(m / STEP) * STEP);
  pop.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
  const hit = pop.querySelector('[data-tp="' + nearest + '"]');
  if (hit) { hit.classList.add('on'); hit.scrollIntoView({ block: 'center' }); }
}

function open(input) {
  active = input;
  ensurePop();
  place(input);
  pop.classList.add('on');
  highlight(input);
}

function close() {
  if (pop) pop.classList.remove('on');
  active = null;
}

function normalize(input) {
  const v = parseTime(input.value);
  if (v === null) { input.classList.add('bad'); return; }
  input.classList.remove('bad');
  if (v !== input.value) commit(input, v);
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => { if (e.target.classList?.contains('tp')) open(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('tp')) { normalize(e.target); close(); } });
  document.addEventListener('input', (e) => { if (e.target === active && pop) { e.target.classList.remove('bad'); highlight(e.target); } });
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el.classList?.contains('tp')) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); commit(el, stepTime(el.value, e.key === 'ArrowUp' ? 1 : -1)); if (pop) highlight(el); }
    else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); normalize(el); el.blur(); }
  });
  window.addEventListener('resize', () => { if (active) place(active); });
  document.addEventListener('scroll', () => { if (active) place(active); }, true);
}
