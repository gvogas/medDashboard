// A four-card flip clock, MM:SS. Each card flips when its digit changes: the old top
// half falls, then the new bottom half lands. With reduced motion the digits just change.

const card = '<span class="flip" data-v=""><span class="half top"><span></span></span><span class="half bot"><span></span></span>'
  + '<span class="half ftop"><span></span></span><span class="half fbot"><span></span></span></span>';

/** The clock's markup; `size` is a class: 'big', 'mid' or 'mini'. */
export function clockHtml(size) {
  return '<span class="clock ' + size + '" role="timer" aria-live="off">'
    + '<span class="pair">' + card + card + '</span><span class="colon" aria-hidden="true"><i></i><i></i></span>'
    + '<span class="pair">' + card + card + '</span><span class="sr-only" data-clock-say></span></span>';
}

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function setCard(el, v, animate) {
  const old = el.dataset.v;
  if (old === v) return;
  const half = (s) => el.querySelector('.' + s + ' > span');
  el.dataset.v = v;
  if (!animate || old === '' || still()) {
    for (const s of ['top', 'bot', 'ftop', 'fbot']) half(s).textContent = v;
    return;
  }
  half('top').textContent = v; half('ftop').textContent = old;
  half('fbot').textContent = v; half('bot').textContent = old;
  el.classList.remove('flipping'); void el.offsetWidth; el.classList.add('flipping');
  clearTimeout(el.flipTimer);
  el.flipTimer = setTimeout(() => { half('bot').textContent = v; half('ftop').textContent = v; el.classList.remove('flipping'); }, 500);
}

/** Show `ms` (rounded up to the second) on every clock inside `root`. */
export function setClocks(root, ms, { animate = true, running = false } = {}) {
  const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.min(99, Math.floor(t / 60)), s = t % 60;
  const digits = String(m).padStart(2, '0') + String(s).padStart(2, '0');
  for (const clock of root.querySelectorAll('.clock')) {
    clock.classList.toggle('running', running);
    clock.querySelectorAll('.flip').forEach((f, i) => setCard(f, digits[i], animate));
    const say = clock.querySelector('[data-clock-say]');
    if (say) say.textContent = m + ' minutes ' + s + ' seconds left';
  }
  return digits.slice(0, 2) + ':' + digits.slice(2);
}
