// One message at a time at the foot of the screen: a delete that can still be undone,
// an error that used to be a blocking alert, or an achievement just earned. Screen
// readers hear it as it appears.
import { esc } from '../dom.js';

let box = null, timer = null, onUndo = null;

function host() {
  if (!box) {
    box = document.createElement('div');
    box.className = 'toast';
    box.id = 'toast';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-toast-undo]')) { const fn = onUndo; hideToast(); fn?.(); }
      else if (e.target.closest('[data-toast-x]')) hideToast();
    });
    document.body.append(box);
  }
  return box;
}

/** Show `text`; with `undo`, a button (Undo, or `label`) that calls it; `badge` is
 * trusted markup put in front. It goes after `ms`. */
export function toast(text, { undo = null, label = 'Undo', badge = '', error = false, ms = 6000 } = {}) {
  const el = host();
  clearTimeout(timer);
  onUndo = undo;
  el.classList.toggle('error', error);
  el.innerHTML = badge + '<span>' + esc(text) + '</span>'
    + (undo ? '<button type="button" data-toast-undo>' + esc(label) + '</button>' : '')
    + '<button type="button" class="tx" data-toast-x aria-label="Dismiss">✕</button>';
  el.classList.add('on');
  timer = setTimeout(hideToast, ms);
}

export function hideToast() {
  clearTimeout(timer);
  onUndo = null;
  if (box) { box.classList.remove('on'); box.replaceChildren(); }
}
