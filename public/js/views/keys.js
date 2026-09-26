// The keyboard shortcuts panel, opened with ? and closed with Esc, ? or a click outside.

import { setHTML } from '../dom.js';
import { cover } from './drawer-base.js';

/* [keys, what they do]; two keys are a pair ('[' and ']') or a range ('1' to '5') */
const SHORTCUTS = [
  [['n'], 'New item'],
  [['t'], 'Go to today'],
  [['[', ']'], 'Previous / next week or month'],
  [['1', '5'], 'Week, Month, Table, Spotify, Study'],
  [['/'], 'Search'],
  [['?'], 'Show this list'],
  [['Esc'], 'Close a drawer or leave the focus screen'],
];

let panel = null, back = null;

export function keysOpen() {
  return !!panel;
}

export function openKeys() {
  if (panel) return;
  back = document.activeElement;
  panel = document.createElement('div');
  panel.className = 'keys';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'keysTitle');
  setHTML(panel, '<div class="keys-card"><div class="keys-head"><h2 id="keysTitle">Keyboard shortcuts</h2>'
    + '<button class="icon-btn" type="button" data-keys-close aria-label="Close">✕</button></div><dl>'
    + SHORTCUTS.map(([ks, what]) => '<dt>' + ks.map((x) => '<kbd>' + x + '</kbd>').join(ks[0] === '1' ? ' – ' : ' ') + '</dt><dd>' + what + '</dd>').join('')
    + '</dl><p>Shortcuts are off while you type in a field.</p></div>');
  panel.addEventListener('click', (e) => { if (e.target === panel || e.target.closest('[data-keys-close]')) closeKeys(); });
  document.body.append(panel);
  /* aria-modal alone does not keep Tab inside: the page behind is made inert */
  cover(true);
  panel.querySelector('[data-keys-close]').focus();
}

export function closeKeys() {
  if (!panel) return;
  panel.remove();
  panel = null;
  cover(false);
  if (back && back.isConnected) back.focus();
  back = null;
}
