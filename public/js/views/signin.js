// The sign-in screen: the coat pocket, one button. Google's button appears once a
// client id is configured; on localhost a plain email box signs you in for development.

import { esc, $ } from '../dom.js';
import { TUCK_SVG } from './bits.js';

export function renderSignIn(config, { error = '' } = {}) {
  const el = $('signin');
  el.innerHTML = '<div class="signin-card">'
    + '<div class="brand"><span class="mark">R</span> Rounds</div>'
    + '<div class="pocket"><i class="pen" aria-hidden="true"></i>'
    + '<div class="embroidery">Sign in</div><div class="role">to open your ward board</div>' + TUCK_SVG + '</div>'
    + (config.googleClientId
        ? '<div id="gsi" class="gsi"></div>'
        : '<span class="note">Google sign-in is not configured yet.</span>')
    + (config.devLogin
        ? '<form class="devlogin" id="devLogin"><label for="devEmail" class="note">Development sign-in (localhost only)</label>'
          + '<span style="display:flex;gap:6px"><input id="devEmail" type="email" placeholder="you@example.com" required autocomplete="email">'
          + '<button class="btn" type="submit">Sign in</button></span></form>'
        : '')
    + (error ? '<span class="note err">' + esc(error) + '</span>' : '')
    + '</div>';
  el.hidden = false;
  $('app').hidden = true;
}

export function hideSignIn() {
  $('signin').hidden = true;
  $('app').hidden = false;
}
