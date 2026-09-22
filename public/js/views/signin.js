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

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
}

/** Render Google's button into the sign-in card. `onCredential` gets the ID token. */
export async function mountGoogleButton(config, onCredential) {
  const host = $('gsi');
  if (!host || !config.googleClientId) return;
  try {
    await loadGoogleScript();
  } catch (e) {
    host.outerHTML = '<span class="note err">' + esc(e.message) + ' Check your connection and reload.</span>';
    return;
  }
  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: (response) => onCredential(response.credential),
    ux_mode: 'popup',
    auto_select: false,
  });
  const dark = document.documentElement.getAttribute('data-app') === 'dark';
  window.google.accounts.id.renderButton(host, {
    theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
  });
}
