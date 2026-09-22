import { data } from '../store.js';
import { ui } from '../state.js';
import { PALETTE, colourName, DEFAULT_COAT } from '../model.js';
import { esc, $ } from '../dom.js';
import { showDrawer, resetDrawerState } from './drawer-base.js';
import { TUCK_SVG } from './bits.js';
import { status } from '../sync.js';
import { localPrototypeData } from '../import.js';

export function openSettings(focus) {
  resetDrawerState();
  ui.settings = true;
  ui.focusField = focus || null;
  renderSettings();
}

export function coatColour() {
  return data.profile?.coat?.color || DEFAULT_COAT;
}

export function applyCoat() {
  document.documentElement.style.setProperty('--coat', coatColour());
}

function themeLabel() {
  if (ui.theme === 'system') {
    const dark = document.documentElement.getAttribute('data-app') === 'dark';
    return 'following your device — currently ' + (dark ? 'dark' : 'light');
  }
  return ui.theme === 'dark' ? 'always dark' : 'always light';
}

function syncLine() {
  const n = status.pending;
  if (status.state === 'offline') return 'Offline — ' + (n ? n + ' change' + (n === 1 ? '' : 's') + ' waiting to sync.' : 'everything is saved on this device.');
  if (status.state === 'error') return 'Sync problem: ' + esc(status.message || 'unknown') + '.';
  if (status.state === 'syncing' || status.state === 'pending') return 'Syncing…';
  return status.lastPull ? 'Synced ' + Math.max(0, Math.round((Date.now() - status.lastPull) / 60000)) + ' min ago.' : 'Synced.';
}

export function renderSettings() {
  const p = data.profile, coat = p.coat, qs = data.quotes || [];

  const head = '<div class="dhead"><span class="kind">Settings</span>'
    + '<span style="margin-left:auto;font-size:11px;color:var(--ink-3)">saved as you type</span>'
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>';

  const themes = [
    ['light', 'Light', '#EEF4F3', '#FFFFFF', '#0E7C74'],
    ['dark', 'Dark', '#0A1214', '#111D1E', '#3FBFB2'],
    ['system', 'System', '#EEF4F3', '#0A1214', '#3FBFB2'],
  ];
  let body = '<div class="dbody">'
    + '<div class="setgrp"><h4>Appearance<em>' + esc(themeLabel()) + '</em></h4><div class="themeseg">'
    + themes.map((t) =>
        '<button type="button" data-themeset="' + t[0] + '" aria-pressed="' + (ui.theme === t[0] ? 'true' : 'false') + '">'
          + '<span class="sw"><i style="background:' + t[2] + '"></i><i style="background:' + t[3] + '"></i><i style="background:' + t[4] + '"></i></span>'
          + t[1] + '</button>').join('')
    + '</div></div>'

    + '<div class="setgrp"><h4>Lab coat</h4>'
    + '<div class="fields">'
      + '<label for="o-name">Name</label><input id="o-name" type="text" data-of="name" value="' + esc(coat.name) + '" placeholder="' + esc(p.displayName || 'Your name') + '" maxlength="28">'
      + '<label for="o-role">Line under</label><input id="o-role" type="text" data-of="role" value="' + esc(coat.role) + '" placeholder="MS II · Cardio block" maxlength="34">'
      + '<label>Coat</label><span class="swatchrow">'
      + PALETTE.map((pal) =>
          '<button class="swatch" type="button" data-coatcolor="' + pal.hex + '" aria-pressed="' + (pal.hex === coatColour() ? 'true' : 'false')
            + '" style="--c:' + pal.hex + '" title="' + pal.name + '" aria-label="' + pal.name + ' coat"></button>').join('')
      + '</span>'
      + '<span class="swatchname">' + esc(colourName(coatColour())) + '</span>'
    + '</div>'
    + '<div class="coatpreview"><i class="pen" aria-hidden="true"></i>'
    + '<div class="embroidery" id="coatPrevName">' + esc(coat.name) + '</div>'
    + '<div class="role" id="coatPrevRole">' + esc(coat.role) + '</div>'
    + TUCK_SVG + '</div>'
    + '<span class="note">The coat colour tints the sidebar fabric, the pocket and the embroidery.</span></div>'

    + '<div class="setgrp"><h4>Quotes<em>' + qs.length + ' saved</em></h4>'
    + '<span class="note">One sits in the tile beside your stats. Click it there for the next one.</span>'
    + '<div class="qlist">';
  if (!qs.length) body += '<span class="note">No quotes yet — the tile stays clear.</span>';
  qs.forEach((q) => {
    body += '<div class="qrow"><div><div class="qtext">“' + esc(q.text) + '”</div>'
      + (q.source ? '<div class="qsrc">— ' + esc(q.source) + '</div>' : '')
      + '</div><button class="x" type="button" data-qx="' + esc(q.id) + '" aria-label="Remove quote">✕</button></div>';
  });
  body += '</div>'
    + '<div class="addline" style="flex-direction:column;gap:6px">'
    + '<input type="text" id="qText" placeholder="Quote — press Enter to add" aria-label="Quote" maxlength="300">'
    + '<span style="display:flex;gap:6px"><input type="text" id="qSrc" placeholder="Who said it (optional)" aria-label="Source" maxlength="80">'
    + '<button class="btn ghost" type="button" data-act="addquote">Add</button></span></div></div>';

  // ── data: sync, import, account ──
  body += '<div class="setgrp"><h4>Data<em>' + data.items.length + ' items · ' + data.courses.length + ' courses</em></h4>'
    + '<span class="note" id="syncNote">' + syncLine() + '</span>';
  if (!p.importedAt) {
    const local = localPrototypeData();
    body += '<div class="importbox">'
      + '<span class="note">Bring your prototype data across. In the prototype, open <b>Prototype</b> in the top bar and press <b>Copy data</b>, then paste it here.'
      + (local ? ' This browser also has a copy saved by the prototype, already filled in below.' : '') + '</span>'
      + '<textarea id="importText" rows="3" placeholder="{&quot;data&quot;:{…}}" spellcheck="false">' + esc(local ? JSON.stringify(local) : ui.importText || '') + '</textarea>'
      + '<span style="display:flex;gap:6px;align-items:center"><button class="btn ghost" type="button" data-act="import">Import</button>'
      + '<span class="note" id="importNote"></span></span></div>';
  } else {
    body += '<span class="note">Prototype data imported ' + new Date(p.importedAt).toLocaleDateString() + '.</span>';
  }
  body += '<span class="note">Signed in as <b>' + esc(p.username) + '</b>.</span>'
    + '<button class="btn ghost" type="button" data-act="signout" style="align-self:flex-start">Sign out</button></div>'
    + '</div>';

  const foot = '<div class="dfoot"><span class="hint">Rounds</span>'
    + '<button class="btn" type="button" data-act="close">Done</button></div>';

  showDrawer(head + body + foot);
  if (ui.focusField) { const f = $(ui.focusField); if (f) f.focus(); ui.focusField = null; }
}

export function refreshSyncNote() {
  const n = $('syncNote');
  if (n) n.innerHTML = syncLine();
}
