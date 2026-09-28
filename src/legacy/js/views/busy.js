import { esc } from '../dom.js';
import { ui } from '../state.js';
import { ApiError } from '../api.js';
import { pdfText } from '../pdftext.js';
import { cover, drawer } from './drawer-base.js';

/* A full-screen wait card while a course outline or a school calendar is read: the AI
   step can take half a minute, and a button label alone is easy to miss. */
let el = null, timer = null, started = 0;

function showBusy(fileName, stage, title = 'Uploading your course') {
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
    + '<h3 id="busyTitle">' + esc(title) + '</h3>'
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

function hideBusy() {
  clearInterval(timer); timer = null;
  if (!el) return;
  cover(false);
  const had = el.contains(document.activeElement);
  el.remove(); el = null;
  /* the card held the keyboard: it goes back to the drawer the file was picked in */
  if (had) drawer.focus({ preventScroll: true });
}

/**
 * Read a file with AI behind the wait card. A PDF's text is pulled out here first: the
 * Worker's converter drops the text of many tables. `call(body)` asks the Worker and
 * its answer goes to `done`. While it runs ui[flag] is true; a problem is put in
 * ui[note] from `errors` (by the API's error code) and shown by `refresh`.
 */
export async function readWithAi(file, { what, title, stage, flag, note, errors, call, done, refresh }) {
  if (file.size > 5 * 1024 * 1024) { ui[note] = { text: 'That file is over 5 MB.', error: true }; refresh(); return; }
  ui[flag] = true; ui[note] = null; refresh();
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) showBusy(file.name, 'Pulling the text out of the PDF…', title);
    const body = isPdf ? new Blob([await pdfText(file)], { type: 'text/plain' }) : file;
    showBusy(file.name, stage, title);
    const answer = await call(body);
    ui[flag] = false; hideBusy();
    done(answer);
  } catch (err) {
    ui[flag] = false; hideBusy();
    const code = err instanceof ApiError ? err.body?.error : null;
    ui[note] = { text: errors[code] || AI_ERRORS[code] || (err instanceof ApiError ? 'The ' + what + ' could not be read (' + (code || err.status) + ').' : 'You seem to be offline. Reading ' + what + 's needs a connection.'), error: true };
    refresh();
  }
}

/* The Worker's answers shared by outlines and calendars. */
const AI_ERRORS = {
  outline_unsupported: 'That kind of file cannot be read. Try a PDF or Word document.',
  outline_unavailable: 'The reader is not available right now. Try again later.',
  outline_limit: 'That is the limit of 10 AI reads for today (outlines and calendars). Try again tomorrow.',
  outline_quota: 'The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).',
  too_large: 'That file is over 5 MB.',
};
