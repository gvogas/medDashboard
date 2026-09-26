import { esc } from '../dom.js';
import { cover } from './drawer-base.js';

/* A full-screen wait card while a course outline is read: the AI step can take
   half a minute, and a button label alone is easy to miss. */
let el = null, timer = null, started = 0;

export function showBusy(fileName, stage) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'busy-screen';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'busyTitle');
    document.body.appendChild(el);
    cover(true);
    started = Date.now();
    timer = setInterval(tick, 1000);
  }
  el.innerHTML = '<div class="busy-card">'
    + '<div class="busy-spin" aria-hidden="true"></div>'
    + '<h3 id="busyTitle">Uploading your course</h3>'
    + '<p class="busy-file">' + esc(fileName) + '</p>'
    + '<p class="busy-stage" aria-live="polite">' + esc(stage) + '</p>'
    + '<p class="busy-note">Please wait and keep this tab open. It usually takes 10 to 30 seconds.</p>'
    + '<p class="busy-time"></p>'
    + '</div>';
  el.querySelector('.busy-card').tabIndex = -1;
  if (!el.contains(document.activeElement)) el.querySelector('.busy-card').focus();
  tick();
}

function tick() {
  const t = el?.querySelector('.busy-time'); if (!t) return;
  const s = Math.floor((Date.now() - started) / 1000);
  t.textContent = s < 1 ? '' : s + 's';
}

export function hideBusy() {
  clearInterval(timer); timer = null;
  if (el) cover(false);
  el?.remove(); el = null;
}
