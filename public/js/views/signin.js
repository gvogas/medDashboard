import { setHTML } from '../dom.js';
// The sign-in screen: the coat pocket, a username and a password.

import { esc, $ } from '../dom.js';
import { TUCK_SVG } from './bits.js';

export function renderSignIn({ error = '', username = '' } = {}) {
  const el = $('signin');
  setHTML(el, '<div class="signin-card">'
    + '<div class="brand"><span class="mark">R</span> Rounds</div>'
    + '<div class="pocket"><i class="pen" aria-hidden="true"></i>'
    + '<div class="embroidery">Sign in</div><div class="role">to open your ward board</div>' + TUCK_SVG + '</div>'
    + '<form class="login" id="loginForm" autocomplete="on">'
      + '<label for="loginUser">Username</label>'
      + '<input id="loginUser" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="32" value="' + esc(username) + '">'
      + '<label for="loginPass">Password</label>'
      + '<input id="loginPass" name="password" type="password" autocomplete="current-password" required>'
      + (error ? '<span class="note err" role="alert">' + esc(error) + '</span>' : '')
      + '<button class="btn" type="submit" id="loginBtn">Sign in</button>'
    + '</form>'
    + '</div>');
  el.hidden = false;
  $('app').hidden = true;
  const focus = username ? $('loginPass') : $('loginUser');
  if (focus) focus.focus();
}

export function hideSignIn() {
  $('signin').hidden = true;
  $('app').hidden = false;
}
