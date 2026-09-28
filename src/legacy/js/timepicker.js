// A time field you can type into or pick from: `<input class="tp">` holding HH:MM.
// Typing "830", "8:30", "8pm" all land on a valid time; a popover lists quarter
// hours; ↑/↓ nudge by fifteen minutes. Sets the input's value and fires `input`,
// so the drawers' existing handlers see it like any other field. Only the legacy session
// drawer still uses it; the React drawers have components/sheet/time-field.tsx.

import { setHTML } from './dom.js';
import { parseTime, stepTime, SLOTS, nearestSlot } from '../../lib/time.ts';
export { parseTime, stepTime };

// ── DOM wiring: one popover, delegated events ─────────────────────────────

let pop = null;
let active = null;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'tp-pop';
  pop.setAttribute('role', 'listbox');
  setHTML(pop, SLOTS.map((t) => '<button type="button" role="option" data-tp="' + t + '">' + t + '</button>').join(''));
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
  const nearest = nearestSlot(input.value);
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
