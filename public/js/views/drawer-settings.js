import { setHTML } from '../dom.js';
import { data, conflicts } from '../store.js';
import { ui } from '../state.js';
import { PALETTE, colourName, DEFAULT_COAT } from '../model.js';
import { esc, $ } from '../dom.js';
import { showDrawer, resetDrawerState } from './drawer-base.js';
import { TUCK_SVG } from './bits.js';
import { status } from '../sync.js';
import { state as spotify } from '../spotify.js';
import { state as web } from '../web-player.js';
import { SPOTIFY_MARK } from './player.js';
import { spotifyRetryAt } from '../api.js';

export function openSettings(focus) {
  resetDrawerState();
  ui.settings = true;
  ui.focusField = focus || null;
  renderSettings();
}

function coatColour() {
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
  if (status.state === 'error') return 'Sync problem: ' + (status.message || 'unknown') + '.';
  if (status.state === 'syncing' || status.state === 'pending') return 'Syncing…';
  return status.lastPull ? 'Synced ' + Math.max(0, Math.round((Date.now() - status.lastPull) / 60000)) + ' min ago.' : 'Synced.';
}

function spotifyGroup() {
  const on = spotify.connected;
  let html = '<h4>Spotify<em>' + (!spotify.loaded ? 'Checking connection' : on ? 'Connected' : 'Not connected') + '</em></h4>'
    + '<div class="spotrow">' + SPOTIFY_MARK + '<div class="who">';
  if (!spotify.loaded) {
    html += '<b>Checking connection</b><span>' + (spotify.stale ? 'Connection status is unavailable. Try again when you are online.' : 'Checking your saved Spotify connection…') + '</span></div>';
  } else if (on) {
    html += '<b>Connected</b><span>' + (spotify.device ? 'Playing on <b data-layout="c75d1a93">' + esc(spotify.device) + '</b>.'
      : spotify.stale ? 'Playback status is temporarily unavailable.' : spotify.track ? 'Paused.' : 'Nothing playing right now.') + '</span></div>'
      + '<button class="btn ghost" type="button" data-act="spotify-disconnect">Disconnect</button>';
  } else {
    html += '<b>Not connected</b><span>Show what you are listening to at the bottom of the sidebar.</span></div>'
      + '<a class="btn" href="/api/spotify/connect">Connect</a>';
  }
  html += '</div>';
  if (on && spotifyRetryAt()) html += '<span class="note">Your account is connected. Spotify requests are paused until ' + esc(new Date(spotifyRetryAt()).toLocaleString()) + '.</span>';
  if (on && web.status === 'needs_reconnect') {
    html += '<span class="note err">Reconnect Spotify to play in this browser. <a href="/api/spotify/connect">Reconnect</a></span>';
  }
  if (on && web.status === 'ready') html += '<span class="note">This tab is a Spotify device called <b>Rounds</b>: press play here and it plays here.</span>';
  if (ui.spotifyNote === 'error') html += '<span class="note err">Spotify did not connect. Try again.</span>';
  if (ui.spotifyNote === 'connected') html += '<span class="note" data-layout="b282c623">Connected. The badge on the coat shows what is playing.</span>';
  html += '<span class="note">Controls need Spotify Premium; free accounts still see what is playing.'
    + (on ? '' : ' The owner of the Rounds app has to add your Spotify email to it first, so ask before connecting.') + '</span>';
  return html;
}

/** Redraw just the Spotify group, when the poller learns something while Settings is open. */
export function refreshSpotifyGroup() {
  const g = $('spotifyGrp');
  if (g) setHTML(g, spotifyGroup());
}

function savedValues(row = {}) {
  const labels = { title: 'Title', text: 'Quote', source: 'Source', name: 'Course', code: 'Code', instructor: 'Instructor', term: 'Term', date: 'Date', start: 'Start', end: 'End', where: 'Location', status: 'Status', grade: 'Grade', weight: 'Weight', notes: 'Notes', dept: 'Department', displayName: 'Name', theme: 'Theme', bg: 'Background', termStart: 'Term start' };
  let html = '<dl>';
  for (const [key, label] of Object.entries(labels)) if (row[key] !== undefined && row[key] !== null && row[key] !== '') html += '<dt>' + label + '</dt><dd>' + esc(row[key]) + '</dd>';
  for (const entry of row.checklist || []) html += '<dt>Checklist</dt><dd>' + (entry.done ? 'Done: ' : 'To do: ') + esc(entry.text) + '</dd>';
  for (const link of row.links || []) html += '<dt>Link</dt><dd>' + esc(link.label || link.url) + ' ' + esc(link.url) + '</dd>';
  for (const meeting of row.meetings || []) html += '<dt>Class</dt><dd>' + esc(meeting.kind) + ' ' + esc(meeting.start) + '-' + esc(meeting.end) + ' ' + esc(meeting.room) + '</dd>';
  if (row.coat) html += '<dt>Coat</dt><dd>' + esc(row.coat.name) + ' ' + esc(row.coat.role) + '</dd>';
  return html + '</dl>';
}

/* Med: the lab coat, with its colour and a preview of the pocket. */
function coatGroup(p, coat) {
  return '<div class="setgrp"><h4>Lab coat</h4>'
    + '<div class="fields">'
      + '<label for="o-name">Name</label><input id="o-name" type="text" data-of="name" value="' + esc(coat.name) + '" placeholder="' + esc(p.displayName || 'Your name') + '" maxlength="28">'
      + '<label for="o-role">Line under</label><input id="o-role" type="text" data-of="role" value="' + esc(coat.role) + '" placeholder="MS II · Cardio block" maxlength="34">'
      + '<label>Coat</label><span class="swatchrow">'
      + PALETTE.map((pal) =>
          '<button class="swatch" type="button" data-coatcolor="' + pal.hex + '" aria-pressed="' + (pal.hex === coatColour() ? 'true' : 'false')
            + '" data-accent="' + pal.hex + '" title="' + pal.name + '" aria-label="' + pal.name + ' coat"></button>').join('')
      + '</span>'
      + '<span class="swatchname">' + esc(colourName(coatColour())) + '</span>'
    + '</div>'
    + '<div class="coatpreview"><i class="pen" aria-hidden="true"></i>'
    + '<div class="embroidery" id="coatPrevName">' + esc(coat.name) + '</div>'
    + '<div class="role" id="coatPrevRole">' + esc(coat.role) + '</div>'
    + TUCK_SVG + '</div>'
    + '<span class="note">The coat colour tints the sidebar fabric, the pocket and the embroidery.</span></div>';
}

/* CS: the same name and line, printed on the ID badge. The coat colour is kept for Med. */
function badgeGroup(p, coat) {
  return '<div class="setgrp"><h4>ID badge</h4>'
    + '<div class="fields">'
      + '<label for="o-name">Name</label><input id="o-name" type="text" data-of="name" value="' + esc(coat.name) + '" placeholder="' + esc(p.displayName || 'Your name') + '" maxlength="28">'
      + '<label for="o-role">Line under</label><input id="o-role" type="text" data-of="role" value="' + esc(coat.role) + '" placeholder="CS · Year 2" maxlength="34">'
    + '</div>'
    + '<span class="note">The pattern and barcode on the badge are made from your username.</span></div>';
}

export function renderSettings() {
  const p = data.profile, coat = p.coat, qs = data.quotes || [];

  const head = '<div class="dhead"><span class="kind">Settings</span>'
    + '<span data-layout="f7add123">saved as you type</span>'
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
          + '<span class="sw"><i data-swatch="' + t[2] + '"></i><i data-swatch="' + t[3] + '"></i><i data-swatch="' + t[4] + '"></i></span>'
          + t[1] + '</button>').join('')
    + '</div></div>'

    + '<div class="setgrp"><h4>Background<em>' + (ui.bg === 'cs' ? 'computer science' : 'medicine') + '</em></h4><div class="bgseg">'
    + [['med', 'Med', 'Helices, rings and a lipid tail'], ['cs', 'CS', 'Circuits, trees and code']].map((b) =>
        '<button type="button" data-bgset="' + b[0] + '" aria-pressed="' + (ui.bg === b[0] ? 'true' : 'false') + '">'
          + '<span class="bgthumb" data-thumb="' + b[0] + '" aria-hidden="true"></span><b>' + b[1] + '</b><span>' + b[2] + '</span></button>').join('')
    + '</div><span class="note">CS swaps the lab coat for an ID badge and adds Projects to your item types.</span></div>'

    + (ui.bg === 'cs' ? badgeGroup(p, coat) : coatGroup(p, coat))

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
    + '<div class="addline" data-layout="4fb706c9">'
    + '<input type="text" id="qText" placeholder="Quote — press Enter to add" aria-label="Quote" maxlength="300">'
    + '<span data-layout="69374f35"><input type="text" id="qSrc" placeholder="Who said it (optional)" aria-label="Source" maxlength="80">'
    + '<button class="btn ghost" type="button" data-act="addquote">Add</button></span></div></div>';

  // ── Spotify ──
  body += '<div class="setgrp" id="spotifyGrp" tabindex="-1">' + spotifyGroup() + '</div>';

  // ── data: sync, import, account ──
  body += '<div class="setgrp"><h4>Data<em>' + data.items.length + ' items · ' + data.courses.length + ' courses</em></h4>'
    + '<span class="note" id="syncNote">' + esc(syncLine()) + '</span>'
    + '<button class="btn ghost" type="button" data-act="export-data">Export data and saved copies</button>';
  for (const copy of conflicts) {
    body += '<details class="saved-copy"><summary>Saved copy: ' + esc(copy.body?.title || copy.body?.name || copy.body?.text || copy.key) + '</summary>'
      + '<p>' + esc(copy.reason) + '</p>' + (copy.op === 'delete' ? '<p>Your saved action: delete this record.</p>' : '') + savedValues(copy.body)
      + '<button class="btn ghost" type="button" data-act="conflict-restore" data-conflict="' + esc(copy.id) + '">Restore my edit</button> '
      + '<button class="btn ghost" type="button" data-act="conflict-dismiss" data-conflict="' + esc(copy.id) + '">Discard saved copy</button></details>';
  }
  body += '<span class="note">Signed in as <b>' + esc(p.username) + '</b>.</span>'
    + '<span data-layout="ed524873"><button class="btn ghost" type="button" data-act="signout">Sign out</button>'
    + '<button class="btn ghost" type="button" data-act="signout-all" title="Every phone and laptop signed in as you will need the password again">Sign out everywhere</button></span></div>'
    + '</div>';

  const foot = '<div class="dfoot"><span class="hint">Rounds</span>'
    + '<button class="btn" type="button" data-act="close">Done</button></div>';

  showDrawer(head + body + foot);
  if (ui.focusField) {
    const f = $(ui.focusField);
    if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); }
    ui.focusField = null;
  }
}

export function refreshSyncNote() {
  const n = $('syncNote');
  if (n) n.textContent = syncLine();
}
